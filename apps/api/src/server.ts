import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { createAssetDeps } from './modules/assets/deps.js';
import { sweepUploads } from './modules/assets/service.js';
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
  const app = await buildApp({ config, logger, db, storage, rateLimitMax: config.RATE_LIMIT_MAX });

  // Remove uploads that never finished (and their files) now and every ten minutes.
  const assetDeps = createAssetDeps({ db, storage, sessionSecret: config.SESSION_SECRET });
  const sweep = (): void => {
    sweepUploads(assetDeps).then(
      (removed) => {
        if (removed > 0) logger.info({ event: 'uploads.swept', removed }, 'removed stale uploads');
      },
      (error: unknown) =>
        logger.error({ event: 'uploads.sweep_failed', err: error }, 'sweep failed'),
    );
  };
  sweep();
  const sweeper = setInterval(sweep, 10 * 60 * 1000);
  sweeper.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'server.stopping', signal }, 'shutting down');
    clearInterval(sweeper);
    await app.close();
    await pool.end();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ event: 'server.started', port: config.PORT, host: config.HOST }, 'listening');
}
