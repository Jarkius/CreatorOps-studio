/**
 * The job state machine (D-045). Every status change goes through this table, and every update
 * also names the status it expects to replace, so two workers (or a worker and a cancel request)
 * can never both move the same job.
 */
export const JOB_STATUS = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatusValue = (typeof JOB_STATUS)[number];

const TRANSITIONS: Readonly<Record<JobStatusValue, readonly JobStatusValue[]>> = {
  // A queued job is claimed (running), cancelled by a user, or failed by the reconciler when it
  // can no longer run (for example its campaign is gone).
  queued: ['running', 'cancelled', 'failed'],
  // A running job finishes, fails, is cancelled, or goes back to the queue for a retry.
  running: ['succeeded', 'failed', 'cancelled', 'queued'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: JobStatusValue, to: JobStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: JobStatusValue): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses that count against a workspace's active-job cap. */
export const ACTIVE_STATUSES = ['queued', 'running'] as const;

/** At most this many jobs may be queued or running in one workspace (D-053). */
export const MAX_ACTIVE_JOBS_PER_WORKSPACE = 5;
