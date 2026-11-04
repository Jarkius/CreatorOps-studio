import type { Db } from '../../db/client.js';
import type { WorkerLog } from './process.js';
import type { JobQueue } from './queue.js';
import {
  failQueued,
  findStaleQueued,
  lockExhaustedQueued,
  lockExpiredLeases,
  markCancelled,
  markFailed,
  markRequeued,
} from './worker-repo.js';

/** The most rows one pass handles; the next pass (30 s later) takes the rest. */
const BATCH = 100;

/** How often the worker process runs the reconciler (D-045). */
export const RECONCILE_INTERVAL_MS = 30_000;

export interface ReconcileSummary {
  /** Running jobs whose worker vanished and that go back in the queue. */
  readonly requeued: number;
  /** Jobs that used every attempt, or whose worker vanished on the last one. */
  readonly failed: number;
  /** Running jobs with a cancel request whose worker vanished. */
  readonly cancelled: number;
  /** Messages offered to the queue (new for re-queued jobs, repeated for overdue ones). */
  readonly enqueued: number;
}

export interface ReconcileDeps {
  readonly db: Db;
  readonly queue: JobQueue;
  readonly log: WorkerLog;
}

const STOPPED = 'The job stopped responding.';

/**
 * Repairs jobs the queue and the workers lost (D-045). Redis can lose a message and a worker can
 * die mid-job; the database row says what should still happen.
 * 1. A running job whose lease ran out goes back to the queue, fails when it has no attempts
 *    left, or is cancelled when a user had asked for that.
 * 2. A queued job that used every attempt is failed.
 * 3. A queued job overdue by a minute is offered to the queue again. The message id includes the
 *    attempt, so a message that is merely slow is not duplicated.
 */
export async function reconcile(deps: ReconcileDeps): Promise<ReconcileSummary> {
  let requeued = 0;
  let failed = 0;
  let cancelled = 0;
  const toEnqueue = new Map<string, number>();

  await deps.db.transaction(async (tx) => {
    for (const job of await lockExpiredLeases(tx, BATCH)) {
      if (job.cancelRequestedAt !== null) {
        await markCancelled(tx, job.id);
        cancelled += 1;
      } else if (job.attempts >= job.maxAttempts) {
        await markFailed(tx, job.id, { code: 'INTERNAL', message: STOPPED });
        failed += 1;
      } else {
        await markRequeued(tx, job.id, 0);
        requeued += 1;
        toEnqueue.set(job.id, job.attempts + 1);
      }
    }
    for (const job of await lockExhaustedQueued(tx, BATCH)) {
      await failQueued(tx, job.id, { code: 'INTERNAL', message: STOPPED });
      failed += 1;
    }
  });

  for (const job of await findStaleQueued(deps.db, BATCH)) {
    toEnqueue.set(job.id, job.attempts + 1);
  }

  let enqueued = 0;
  for (const [jobId, attempt] of toEnqueue) {
    try {
      await deps.queue.enqueue(jobId, { attempt });
      enqueued += 1;
    } catch (error) {
      deps.log.warn(
        {
          event: 'reconcile.enqueue_failed',
          jobId,
          error: error instanceof Error ? error.name : 'Error',
        },
        'could not hand the job to the queue; the next pass tries again',
      );
    }
  }

  const summary = { requeued, failed, cancelled, enqueued };
  if (requeued + failed + cancelled + enqueued > 0) {
    deps.log.info({ event: 'reconcile.repaired', ...summary }, 'repaired jobs');
  }
  return summary;
}
