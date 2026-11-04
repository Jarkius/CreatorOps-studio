import { and, asc, eq, lt, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
import type { JobRow } from './repo.js';

/**
 * Database operations of the worker (D-045). Every time comparison uses the database clock, so a
 * worker host with a wrong clock cannot extend or steal a lease. Every update names the status
 * (and, for a running job, the attempt) it expects to replace, so a job that was taken over,
 * cancelled or finished in the meantime is never overwritten.
 */
const nowMs = sql`date_trunc('milliseconds', now())`;
const afterSeconds = (seconds: number) =>
  sql`date_trunc('milliseconds', now()) + make_interval(secs => ${seconds}::double precision)`;

/** A queued job that has been waiting this long past its run time is offered to the queue again. */
export const STALE_QUEUED_SECONDS = 60;

/**
 * Moves a queued job that is due to running and starts its lease. Returns null when the job is
 * not claimable (already taken, not due yet, out of attempts), which is how a duplicate message
 * does nothing.
 */
export async function claimJob(
  db: DbOrTx,
  jobId: string,
  leaseSeconds: number,
): Promise<JobRow | null> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'running',
      attempts: sql`${jobs.attempts} + 1`,
      startedAt: sql`coalesce(${jobs.startedAt}, ${nowMs})`,
      lockedUntil: afterSeconds(leaseSeconds),
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, 'queued'),
        sql`${jobs.runAfter} <= now()`,
        sql`${jobs.attempts} < ${jobs.maxAttempts}`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export interface HeartbeatResult {
  /** False when this worker no longer owns the job (taken over, finished or cancelled). */
  readonly owned: boolean;
  readonly cancelRequested: boolean;
}

/** Extends the lease while this attempt still owns the job, and reports a cancel request. */
export async function heartbeat(
  db: DbOrTx,
  jobId: string,
  attempt: number,
  leaseSeconds: number,
): Promise<HeartbeatResult> {
  const rows = await db
    .update(jobs)
    .set({ lockedUntil: afterSeconds(leaseSeconds), updatedAt: nowMs })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.attempts, attempt)))
    .returning({ cancelRequestedAt: jobs.cancelRequestedAt });
  const row = rows[0];
  return { owned: row !== undefined, cancelRequested: row?.cancelRequestedAt != null };
}

/**
 * Locks the row of a running job if this attempt still owns it. Call inside a transaction, then
 * change the row through one of the functions below before the transaction ends.
 */
export async function lockOwnedJob(
  tx: DbOrTx,
  jobId: string,
  attempt: number,
): Promise<JobRow | null> {
  const rows = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.attempts, attempt)))
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

export async function markSucceeded(
  tx: DbOrTx,
  jobId: string,
  result: { readonly output: Record<string, unknown>; readonly provider: string },
): Promise<void> {
  await tx
    .update(jobs)
    .set({
      status: 'succeeded',
      output: result.output,
      provider: result.provider,
      lockedUntil: null,
      finishedAt: nowMs,
      updatedAt: nowMs,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
}

export async function markFailed(
  tx: DbOrTx,
  jobId: string,
  failure: { readonly code: JobRow['errorCode']; readonly message: string },
): Promise<void> {
  await tx
    .update(jobs)
    .set({
      status: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message,
      lockedUntil: null,
      finishedAt: nowMs,
      updatedAt: nowMs,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
}

export async function markCancelled(tx: DbOrTx, jobId: string): Promise<void> {
  await tx
    .update(jobs)
    .set({
      status: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled by a user.',
      lockedUntil: null,
      finishedAt: nowMs,
      updatedAt: nowMs,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
}

/** Puts a running job back in the queue to run again after `delayMs`. */
export async function markRequeued(tx: DbOrTx, jobId: string, delayMs: number): Promise<void> {
  await tx
    .update(jobs)
    .set({
      status: 'queued',
      lockedUntil: null,
      runAfter: afterSeconds(delayMs / 1000),
      updatedAt: nowMs,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
}

/** Running jobs whose lease ran out, oldest first, locked so two reconcilers cannot share them. */
export async function lockExpiredLeases(tx: DbOrTx, limit: number): Promise<JobRow[]> {
  return tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedUntil, sql`now()`)))
    .orderBy(asc(jobs.lockedUntil))
    .limit(limit)
    .for('update', { skipLocked: true });
}

/** Queued jobs that can no longer run because they used every attempt. */
export async function lockExhaustedQueued(tx: DbOrTx, limit: number): Promise<JobRow[]> {
  return tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'queued'), sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
    .limit(limit)
    .for('update', { skipLocked: true });
}

/** Marks a queued job failed (only the reconciler does this, for a job that cannot run). */
export async function failQueued(
  tx: DbOrTx,
  jobId: string,
  failure: { readonly code: JobRow['errorCode']; readonly message: string },
): Promise<void> {
  await tx
    .update(jobs)
    .set({
      status: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message,
      finishedAt: nowMs,
      updatedAt: nowMs,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')));
}

/** Queued jobs overdue by more than STALE_QUEUED_SECONDS whose queue message may be missing. */
export async function findStaleQueued(
  db: DbOrTx,
  limit: number,
): Promise<{ id: string; attempts: number }[]> {
  return db
    .select({ id: jobs.id, attempts: jobs.attempts })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'queued'),
        sql`${jobs.attempts} < ${jobs.maxAttempts}`,
        sql`${jobs.runAfter} < now() - make_interval(secs => ${STALE_QUEUED_SECONDS}::double precision)`,
      ),
    )
    .orderBy(asc(jobs.runAfter))
    .limit(limit);
}
