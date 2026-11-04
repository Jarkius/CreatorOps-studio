import { MockTextProvider } from '@creatorops/provider-core';

import { createDb } from './db/client.js';
import { LocalFsStorage } from './storage/local-fs.js';
import { BullMqJobQueue, startQueueWorker } from './modules/jobs/bullmq-queue.js';
import { processJob } from './modules/jobs/process.js';
import { RECONCILE_INTERVAL_MS, reconcile } from './modules/jobs/reconcile.js';
import { prepare } from './startup.js';

/** Jobs one worker process runs at the same time. */
const CONCURRENCY = 2;

const prepared = await prepare(process.env, {
  stdout: process.stdout,
  stderr: process.stderr,
});

if (!prepared.ok) {
  process.exitCode = prepared.exitCode;
} else if (prepared.config.REDIS_URL === undefined) {
  process.stderr.write(
    'REDIS_URL is not set. Start Redis (pnpm dev:redis) and export REDIS_URL.\n',
  );
  await prepared.pool.end();
  process.exitCode = 1;
} else {
  const { logger, pool } = prepared;
  const redisUrl = prepared.config.REDIS_URL;
  const db = createDb(pool);
  const queue = new BullMqJobQueue(redisUrl);
  // The mock provider is the only one until Q-001 is answered (D-052).
  const storage = new LocalFsStorage(prepared.config.DATA_DIR);
  const deps = { db, provider: new MockTextProvider(), queue, log: logger, storage };

  const worker = startQueueWorker({
    redisUrl,
    concurrency: CONCURRENCY,
    log: logger,
    run: (jobId) => processJob(deps, jobId),
  });

  // Now and every 30 s: repair jobs that a lost message or a dead worker left behind.
  const repair = (): void => {
    reconcile(deps).catch((error: unknown) =>
      logger.error({ event: 'reconcile.failed', err: error }, 'reconcile failed'),
    );
  };
  repair();
  const reconciler = setInterval(repair, RECONCILE_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'worker.stopping', signal }, 'worker shutting down');
    clearInterval(reconciler);
    await worker.close(); // lets running jobs finish
    await queue.close();
    await pool.end();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info({ event: 'worker.started', concurrency: CONCURRENCY }, 'worker started');
}
