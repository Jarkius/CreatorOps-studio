import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { createAssetDeps } from './modules/assets/deps.js';
import { DELETED_RETENTION_SECONDS } from './modules/assets/limits.js';
import { purgeDeletedAssets, sweepUploads } from './modules/assets/service.js';
import { createExportSigner } from './modules/export/export-urls.js';
import { sweepExports } from './modules/export/service.js';
import { BullMqJobQueue } from './modules/jobs/bullmq-queue.js';
import { NullJobQueue } from './modules/jobs/queue.js';
import { sweepRetention } from './modules/retention/retention.js';
import { LocalFsStorage } from './storage/local-fs.js';
import { prepare } from './startup.js';

const prepared = await prepare(process.env, {
  stdout: process.stdout,
  stderr: process.stderr,
});

if (!prepared.ok) {
  process.exitCode = prepared.exitCode;
} else {
  const { config, logger, pool } = prepared;
  const db = createDb(pool);
  const storage = new LocalFsStorage(config.DATA_DIR);
  logger.info({ event: 'storage.dir', dataDir: config.DATA_DIR }, 'media directory');
  // With Redis, new jobs are handed to the worker at once. Without it they wait in the database.
  const bullQueue = config.REDIS_URL === undefined ? null : new BullMqJobQueue(config.REDIS_URL);
  if (bullQueue === null) {
    logger.warn({ event: 'queue.disabled' }, 'REDIS_URL is not set: jobs will not run');
  }
  const app = await buildApp({
    config,
    logger,
    db,
    storage,
    jobQueue: bullQueue ?? new NullJobQueue(),
    rateLimitMax: config.RATE_LIMIT_MAX,
  });

  // Now and every ten minutes: remove unfinished uploads and purge long-deleted files.
  const assetDeps = createAssetDeps({ db, storage, sessionSecret: config.SESSION_SECRET });
  const exportDeps = { db, storage, exports: createExportSigner(config.SESSION_SECRET) };
  const sweep = (): void => {
    sweepUploads(assetDeps).then(
      (removed) => {
        if (removed > 0) logger.info({ event: 'uploads.swept', removed }, 'removed stale uploads');
      },
      (error: unknown) =>
        logger.error({ event: 'uploads.sweep_failed', err: error }, 'sweep failed'),
    );
    // Permanently remove files that were deleted more than the retention period ago.
    purgeDeletedAssets(assetDeps, new Date(Date.now() - DELETED_RETENTION_SECONDS * 1000)).then(
      (purged) => {
        if (purged > 0) logger.info({ event: 'assets.purged', purged }, 'purged deleted files');
      },
      (error: unknown) =>
        logger.error({ event: 'assets.purge_failed', err: error }, 'purge failed'),
    );
    // Expire old packages and remove files left by failed export jobs.
    sweepExports(exportDeps).then(
      (removed) => {
        if (removed > 0) logger.info({ event: 'exports.swept', removed }, 'removed export files');
      },
      (error: unknown) =>
        logger.error({ event: 'exports.sweep_failed', err: error }, 'export sweep failed'),
    );
  };
  sweep();
  const sweeper = setInterval(sweep, 10 * 60 * 1000);
  sweeper.unref();

  // Retention (D-088): once an hour at most, never two runs at once.
  let retentionRunning = false;
  const retain = (): void => {
    if (retentionRunning) return;
    retentionRunning = true;
    sweepRetention(db, {
      auditDays: config.AUDIT_RETENTION_DAYS,
      jobDays: config.JOB_RETENTION_DAYS,
      exportRowDays: config.EXPORT_ROW_RETENTION_DAYS,
      intentDays: config.INTENT_RETENTION_DAYS,
    })
      .then(
        (result) => {
          if (Object.values(result).some((n) => n > 0)) {
            logger.info({ event: 'retention.swept', ...result }, 'removed old rows');
          }
        },
        (error: unknown) =>
          logger.error({ event: 'retention.failed', err: error }, 'retention run failed'),
      )
      .finally(() => {
        retentionRunning = false;
      });
  };
  retain();
  const retainer = setInterval(retain, 60 * 60 * 1000);
  retainer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'server.stopping', signal }, 'shutting down');
    clearInterval(sweeper);
    await app.close();
    await bullQueue?.close();
    await pool.end();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ event: 'server.started', port: config.PORT, host: config.HOST }, 'listening');
}
