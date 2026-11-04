import { describe, expect, it } from 'vitest';

import { pollDelayMs } from './jobQueries.js';

describe('pollDelayMs', () => {
  it('backs off 2 s, 3 s, 5 s, 8 s, then stays at 10 s', () => {
    const steps = [0, 1, 2, 3, 4, 5, 9];
    expect(steps.map(pollDelayMs)).toEqual([2000, 3000, 5000, 8000, 10000, 10000, 10000]);
  });

  it('treats a negative step as the first step', () => {
    expect(pollDelayMs(-1)).toBe(2000);
  });
});
