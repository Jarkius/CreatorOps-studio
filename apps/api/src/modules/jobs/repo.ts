import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { jobs, workspaces } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';
import { ACTIVE_STATUSES } from './transitions.js';

export type JobRow = typeof jobs.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowMs = sql`date_trunc('milliseconds', now())`;

/** Serialises job creation inside one workspace until the transaction ends. */
export async function lockWorkspace(db: DbOrTx, ctx: RequestContext): Promise<void> {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .for('update');
  if (rows[0] === undefined) throw new Error('Workspace not found');
}

export async function findJobByKey(
  db: DbOrTx,
  ctx: RequestContext,
  idempotencyKey: string,
): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, ctx.workspaceId),
        eq(jobs.createdBy, ctx.userId),
        eq(jobs.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function countActiveJobs(db: DbOrTx, ctx: RequestContext): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, ctx.workspaceId), inArray(jobs.status, [...ACTIVE_STATUSES])));
  return rows[0]?.count ?? 0;
}

export interface NewJob {
  readonly type: 'generate_brief' | 'regenerate_section' | 'export_package';
  readonly input: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly campaignId: string | null;
  readonly draftId: string | null;
}

export async function insertJob(db: DbOrTx, ctx: RequestContext, job: NewJob): Promise<JobRow> {
  const rows = await db
    .insert(jobs)
    .values({ ...job, workspaceId: ctx.workspaceId, createdBy: ctx.userId })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to insert the job');
  return row;
}

export async function findJob(
  db: DbOrTx,
  ctx: RequestContext,
  jobId: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<JobRow | null> {
  if (!UUID.test(jobId)) return null;
  const query = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, ctx.workspaceId), eq(jobs.id, jobId)))
    .limit(1);
  const rows = await (options.forUpdate === true ? query.for('update') : query);
  return rows[0] ?? null;
}

export interface ListOptions {
  readonly status?: JobRow['status'] | undefined;
  readonly type?: JobRow['type'] | undefined;
  readonly campaignId?: string | undefined;
  readonly draftId?: string | undefined;
  readonly limit: number;
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

export async function listJobs(
  db: DbOrTx,
  ctx: RequestContext,
  options: ListOptions,
): Promise<JobRow[]> {
  const after = options.after;
  // An id that is not a UUID cannot match any row (and must not reach a uuid column).
  for (const id of [options.campaignId, options.draftId]) {
    if (id !== undefined && !UUID.test(id)) return [];
  }
  return db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, ctx.workspaceId),
        options.status === undefined ? undefined : eq(jobs.status, options.status),
        options.type === undefined ? undefined : eq(jobs.type, options.type),
        options.campaignId === undefined ? undefined : eq(jobs.campaignId, options.campaignId),
        options.draftId === undefined ? undefined : eq(jobs.draftId, options.draftId),
        after === undefined
          ? undefined
          : sql`(${jobs.createdAt}, ${jobs.id}) < (${after.createdAt}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(options.limit);
}

/** Cancels a job that is still queued. Returns null if it is no longer queued. */
export async function cancelQueuedJob(
  db: DbOrTx,
  ctx: RequestContext,
  jobId: string,
): Promise<JobRow | null> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled by a user.',
      finishedAt: nowMs,
      updatedAt: nowMs,
    })
    .where(
      and(eq(jobs.workspaceId, ctx.workspaceId), eq(jobs.id, jobId), eq(jobs.status, 'queued')),
    )
    .returning();
  return rows[0] ?? null;
}

/** Asks a running job to stop; the worker checks the flag between steps. */
export async function requestCancelRunningJob(
  db: DbOrTx,
  ctx: RequestContext,
  jobId: string,
): Promise<JobRow | null> {
  const rows = await db
    .update(jobs)
    .set({
      cancelRequestedAt: sql`coalesce(${jobs.cancelRequestedAt}, ${nowMs})`,
      updatedAt: nowMs,
    })
    .where(
      and(eq(jobs.workspaceId, ctx.workspaceId), eq(jobs.id, jobId), eq(jobs.status, 'running')),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * The newest generate job of each listed campaign, in one query. Always scoped to the workspace;
 * a campaign id from another workspace never matches.
 */
export async function latestGenerateJobsFor(
  db: DbOrTx,
  ctx: RequestContext,
  campaignIds: readonly string[],
): Promise<JobRow[]> {
  const ids = campaignIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  return db
    .selectDistinctOn([jobs.campaignId])
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, ctx.workspaceId),
        eq(jobs.type, 'generate_brief'),
        inArray(jobs.campaignId, [...ids]),
      ),
    )
    .orderBy(jobs.campaignId, desc(jobs.createdAt), desc(jobs.id));
}
