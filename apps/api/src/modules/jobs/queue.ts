/**
 * Hands a job id to the worker (D-045). The queue carries only the id: the database row is the
 * truth, so a lost or duplicated message can never lose or double-run a job. The reconciler
 * re-queues any queued row whose message went missing.
 */
export interface EnqueueOptions {
  /** Wait this long before the job may run (retry backoff). */
  readonly delayMs?: number;
  /**
   * The attempt this message is for (1 for the first run). A real queue builds its message id
   * from the job id and the attempt, so the same attempt is never queued twice, while the next
   * attempt can be queued from inside the current one.
   */
  readonly attempt?: number;
}

export interface JobQueue {
  enqueue(jobId: string, options?: EnqueueOptions): Promise<void>;
}

/** Does nothing. Used when no Redis is configured; jobs then wait in the database. */
export class NullJobQueue implements JobQueue {
  enqueue(): Promise<void> {
    return Promise.resolve();
  }
}
