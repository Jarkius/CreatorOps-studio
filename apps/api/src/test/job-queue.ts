import type { JobQueue } from '../modules/jobs/queue.js';

/** Test queue: remembers what was enqueued and can be told to fail. */
export class RecordingJobQueue implements JobQueue {
  readonly enqueued: { jobId: string; delayMs: number | undefined }[] = [];
  failWith: Error | null = null;

  enqueue(jobId: string, options?: { readonly delayMs?: number }): Promise<void> {
    if (this.failWith !== null) return Promise.reject(this.failWith);
    this.enqueued.push({ jobId, delayMs: options?.delayMs });
    return Promise.resolve();
  }
}
