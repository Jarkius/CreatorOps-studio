import { describe, expect, it } from 'vitest';

import {
  ACTIVE_STATUSES,
  canTransition,
  isTerminal,
  JOB_STATUS,
  MAX_ACTIVE_JOBS_PER_WORKSPACE,
  type JobStatusValue,
} from './transitions.js';

const ALLOWED: readonly [JobStatusValue, JobStatusValue][] = [
  ['queued', 'running'],
  ['queued', 'cancelled'],
  ['queued', 'failed'],
  ['running', 'succeeded'],
  ['running', 'failed'],
  ['running', 'cancelled'],
  ['running', 'queued'],
];

describe('job transitions', () => {
  it('allows exactly the listed transitions and no others', () => {
    for (const from of JOB_STATUS) {
      for (const to of JOB_STATUS) {
        const expected = ALLOWED.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('never leaves a finished state', () => {
    for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
      expect(isTerminal(status)).toBe(true);
      for (const to of JOB_STATUS) expect(canTransition(status, to)).toBe(false);
    }
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);
  });

  it('counts only queued and running jobs as active, with a cap of five', () => {
    expect([...ACTIVE_STATUSES]).toEqual(['queued', 'running']);
    expect(MAX_ACTIVE_JOBS_PER_WORKSPACE).toBe(5);
  });
});
