import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { requireRedisUrl, SKIP_REDIS_TESTS } from '../../test/redis-url.js';
import { BullMqJobQueue, messageId, QUEUE_NAME, startQueueWorker } from './bullmq-queue.js';
import type { WorkerLog } from './process.js';

/**
 * Smoke tests against a real Redis (D-054): the adapter, the message ids and the worker loop.
 * The job rules themselves are tested without Redis in worker.test.ts.
 */
const redisUrl = requireRedisUrl();
const describeRedis = SKIP_REDIS_TESTS ? describe.skip : describe;

const silent: WorkerLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

let admin: Redis;
let inspect: Queue;
const closers: (() => Promise<void>)[] = [];

async function waitFor(condition: () => boolean, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function newQueue(): BullMqJobQueue {
  const queue = new BullMqJobQueue(redisUrl);
  closers.push(() => queue.close());
  return queue;
}

function newWorker(run: (jobId: string) => Promise<unknown>) {
  const worker = startQueueWorker({ redisUrl, concurrency: 2, log: silent, run });
  closers.push(() => worker.close());
  return worker;
}

describeRedis('BullMQ adapter', () => {
  beforeAll(async () => {
    admin = new Redis(redisUrl, { maxRetriesPerRequest: null });
    inspect = new Queue(QUEUE_NAME, { connection: admin });
    await inspect.obliterate({ force: true });
  });

  afterEach(async () => {
    while (closers.length > 0) await closers.pop()?.();
    await inspect.obliterate({ force: true });
  });

  afterAll(async () => {
    await inspect.close();
    admin.disconnect();
  });

  it('builds the message id from the job id and the attempt', () => {
    expect(messageId('abc', 1)).toBe('abc_1');
    expect(messageId('abc', 2)).not.toBe(messageId('abc', 1));
  });

  it('carries only the job id to the worker', async () => {
    const seen: string[] = [];
    newWorker((jobId) => {
      seen.push(jobId);
      return Promise.resolve();
    });
    await newQueue().enqueue('11111111-1111-4111-8111-111111111111', { attempt: 1 });
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual(['11111111-1111-4111-8111-111111111111']);
  });

  it('queues the same attempt of the same job only once', async () => {
    const seen: string[] = [];
    const queue = newQueue();
    // Queue three copies before any worker exists, then start one.
    await queue.enqueue('22222222-2222-4222-8222-222222222222', { attempt: 1 });
    await queue.enqueue('22222222-2222-4222-8222-222222222222', { attempt: 1 });
    await queue.enqueue('22222222-2222-4222-8222-222222222222', { attempt: 1 });
    expect(await inspect.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
    newWorker((jobId) => {
      seen.push(jobId);
      return Promise.resolve();
    });
    await waitFor(() => seen.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toHaveLength(1);
  });

  it('accepts the next attempt while the current one is still running', async () => {
    const seen: string[] = [];
    const queue = newQueue();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const id = '33333333-3333-4333-8333-333333333333';
    newWorker(async (jobId) => {
      seen.push(jobId);
      if (seen.length === 1) {
        await queue.enqueue(id, { attempt: 2 }); // what a retry does from inside attempt 1
        await gate;
      }
    });
    await queue.enqueue(id, { attempt: 1 });
    await waitFor(() => seen.length === 2);
    release();
    expect(seen).toEqual([id, id]);
  });

  it('delays a message', async () => {
    const seen: number[] = [];
    const start = Date.now();
    newWorker(() => {
      seen.push(Date.now() - start);
      return Promise.resolve();
    });
    await newQueue().enqueue('44444444-4444-4444-8444-444444444444', { delayMs: 400, attempt: 2 });
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toBeGreaterThanOrEqual(350);
  });

  it('removes finished and failed messages so the same id can be queued again', async () => {
    const queue = newQueue();
    const id = '55555555-5555-4555-8555-555555555555';
    let calls = 0;
    newWorker(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
    });
    await queue.enqueue(id, { attempt: 1 });
    await waitFor(() => calls === 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await inspect.getJobCounts('failed', 'completed')).toEqual({ failed: 0, completed: 0 });
    await queue.enqueue(id, { attempt: 1 });
    await waitFor(() => calls === 2);
  });

  it('does not retry a message on its own: the job rules decide', async () => {
    let calls = 0;
    newWorker(() => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    });
    await newQueue().enqueue('66666666-6666-4666-8666-666666666666', { attempt: 1 });
    await waitFor(() => calls >= 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls).toBe(1);
  });

  it('runs messages in parallel up to the concurrency', async () => {
    let running = 0;
    let peak = 0;
    newWorker(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 150));
      running -= 1;
    });
    const queue = newQueue();
    for (const n of [1, 2, 3, 4]) {
      await queue.enqueue(`7777777${n}-7777-4777-8777-777777777777`, { attempt: 1 });
    }
    await waitFor(() => running === 0 && peak > 0, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(peak).toBe(2);
  });

  it('fails fast when Redis is not reachable instead of hanging the caller', async () => {
    const queue = new BullMqJobQueue('redis://127.0.0.1:1');
    const started = Date.now();
    await expect(queue.enqueue('88888888-8888-4888-8888-888888888888')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4_000);
    await queue.close();
  });
});
