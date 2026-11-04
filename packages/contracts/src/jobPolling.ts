import type { JobStatus } from './content.js';

/** Wait between polls: 2 s, 3 s, 5 s, 8 s, then 10 s for every later poll (D-053). */
const POLL_STEPS_MS = [2000, 3000, 5000, 8000, 10000] as const;

/** The delay before poll number `step` (0 is the first poll after the first fetch). */
export function pollDelayMs(step: number): number {
  const index = Math.min(Math.max(0, Math.floor(step)), POLL_STEPS_MS.length - 1);
  return POLL_STEPS_MS[index] ?? 10000;
}

/** True once a job can no longer change (succeeded, failed or cancelled). */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}
