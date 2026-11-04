import type { EnqueueOptions, JobQueue } from '../modules/jobs/queue.js';

/** Test queue: remembers what was enqueued and can be told to fail. */
export class RecordingJobQueue implements JobQueue {
  readonly enqueued: { jobId: string; delayMs: number | undefined; attempt: number | undefined }[] =
    [];
  failWith: Error | null = null;

  enqueue(jobId: string, options?: EnqueueOptions): Promise<void> {
    if (this.failWith !== null) return Promise.reject(this.failWith);
    this.enqueued.push({ jobId, delayMs: options?.delayMs, attempt: options?.attempt });
    return Promise.resolve();
  }
}
