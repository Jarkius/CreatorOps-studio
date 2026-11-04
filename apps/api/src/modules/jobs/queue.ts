/**
 * Hands a job id to the worker (D-045). The queue carries only the id: the database row is the
 * truth, so a lost or duplicated message can never lose or double-run a job. The reconciler
 * re-queues any queued row whose message went missing.
 */
export interface JobQueue {
  enqueue(jobId: string, options?: { readonly delayMs?: number }): Promise<void>;
}

/** Does nothing. Used until a real queue is wired (S3.5); the reconciler still picks jobs up. */
export class NullJobQueue implements JobQueue {
  enqueue(): Promise<void> {
    return Promise.resolve();
  }
}
