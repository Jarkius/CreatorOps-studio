import { Queue, Worker, type Job as BullJob } from 'bullmq';
import { Redis } from 'ioredis';

import type { WorkerLog } from './process.js';
import type { EnqueueOptions, JobQueue } from './queue.js';

/** Name of the Redis queue. One queue: the job type lives in the database row, not here. */
export const QUEUE_NAME = 'creatorops-jobs';

/** How long enqueue waits for Redis before giving up, so a Redis outage cannot stall a request. */
const ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * The queue message id: the same attempt of the same job is never queued twice (D-045). BullMQ
 * refuses a colon in a custom id, so the attempt follows an underscore (a job id is a UUID, which
 * has no underscore, so the pair stays unambiguous).
 */
export function messageId(jobId: string, attempt: number): string {
  return `${jobId}_${attempt}`;
}

interface Message {
  readonly jobId: string;
}

function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { jobId?: unknown }).jobId === 'string'
  );
}

/**
 * Hands job ids to BullMQ. BullMQ carries `{ jobId }` only and never retries on its own
 * (`attempts: 1`): the retry rules live in decideRetry and the database row (D-045, D-048).
 * Finished and failed messages are removed, so the same id can be queued again later.
 */
export class BullMqJobQueue implements JobQueue {
  private readonly connection: Redis;
  private readonly queue: Queue<Message>;

  constructor(redisUrl: string) {
    // With the offline queue off, a command fails at once while Redis is down instead of waiting.
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.connection.on('error', () => undefined); // surfaced through enqueue() failures
    this.queue = new Queue<Message>(QUEUE_NAME, { connection: this.connection });
    this.queue.on('error', () => undefined);
  }

  async enqueue(jobId: string, options: EnqueueOptions = {}): Promise<void> {
    const attempt = options.attempt ?? 1;
    const add = this.queue.add(
      'run',
      { jobId },
      {
        jobId: messageId(jobId, attempt),
        attempts: 1,
        delay: options.delayMs ?? 0,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Redis did not answer in time')),
        ENQUEUE_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([add, timeout]);
    } finally {
      clearTimeout(timer);
      add.catch(() => undefined); // the race already reported a failure; avoid an unhandled one
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}

export interface QueueWorker {
  /** Stops taking jobs and waits for the running ones to finish. */
  close(): Promise<void>;
}

export interface StartWorkerOptions {
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly log: WorkerLog;
  /** Runs one job. Receives only the job id from the message. */
  readonly run: (jobId: string) => Promise<unknown>;
}

/** Consumes the queue and runs each message through `run`. */
export function startQueueWorker(options: StartWorkerOptions): QueueWorker {
  // BullMQ requires maxRetriesPerRequest: null on a worker's connection.
  const connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => undefined);
  const worker = new Worker<Message>(
    QUEUE_NAME,
    async (message: BullJob<Message>) => {
      if (!isMessage(message.data)) throw new Error('Malformed queue message');
      await options.run(message.data.jobId);
    },
    { connection, concurrency: options.concurrency },
  );
  worker.on('error', (error) => {
    options.log.error({ event: 'queue.worker_error', error: error.name }, 'queue worker error');
  });
  worker.on('failed', (message, error) => {
    options.log.error(
      { event: 'queue.message_failed', messageId: message?.id, error: error.name },
      'a queue message failed; the reconciler will repair the job',
    );
  });
  return {
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
