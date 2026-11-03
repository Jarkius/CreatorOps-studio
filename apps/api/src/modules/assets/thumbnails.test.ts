import { describe, expect, it } from 'vitest';

import { createLimiter } from './thumbnails.js';

describe('createLimiter', () => {
  it('never runs more tasks at once than allowed, and finishes them all in order', async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (id: number) =>
      limit(async () => {
        started.push(id);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 15));
        running -= 1;
        return id;
      });
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(task));
    expect(results).toEqual([1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(2);
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps going after a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
