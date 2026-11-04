import { describe, expect, it } from 'vitest';

import { isTerminalJobStatus, pollDelayMs } from './jobPolling.js';

describe('pollDelayMs', () => {
  it('backs off 2, 3, 5, 8 then 10 seconds, and stays at 10', () => {
    const steps = [0, 1, 2, 3, 4, 5, 6];
    expect(steps.map(pollDelayMs)).toEqual([2000, 3000, 5000, 8000, 10000, 10000, 10000]);
  });

  it('treats a negative or fractional step safely', () => {
    expect(pollDelayMs(-1)).toBe(2000);
    expect(pollDelayMs(1.9)).toBe(3000);
  });
});

describe('isTerminalJobStatus', () => {
  it('is true only for succeeded, failed and cancelled', () => {
    expect(isTerminalJobStatus('succeeded')).toBe(true);
    expect(isTerminalJobStatus('failed')).toBe(true);
    expect(isTerminalJobStatus('cancelled')).toBe(true);
    expect(isTerminalJobStatus('queued')).toBe(false);
    expect(isTerminalJobStatus('running')).toBe(false);
  });
});
