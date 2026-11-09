import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { draftExports, jobs, workspaceMembers } from '../../db/schema.js';
import type { PageCursor } from '../../platform/cursor.js';
import type { RequestContext } from '../identity/context.js';

export type ExportRow = typeof draftExports.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Packages of this workspace that can still be downloaded. */
export async function countLiveExports(db: DbOrTx, ctx: RequestContext): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(draftExports)
    .where(
      and(
        eq(draftExports.workspaceId, ctx.workspaceId),
        eq(draftExports.status, 'ready'),
        gt(draftExports.expiresAt, sql`now()`),
      ),
    );
  return rows[0]?.count ?? 0;
}

export async function listExports(
  db: DbOrTx,
  ctx: RequestContext,
  options: { draftId?: string | undefined; limit: number; after?: PageCursor | undefined },
): Promise<ExportRow[]> {
  // An id that is not a UUID can match nothing.
  if (options.draftId !== undefined && !UUID.test(options.draftId)) return [];
  const after = options.after;
  return db
    .select()
    .from(draftExports)
    .where(
      and(
        eq(draftExports.workspaceId, ctx.workspaceId),
        options.draftId === undefined ? undefined : eq(draftExports.draftId, options.draftId),
        after === undefined
          ? undefined
          : sql`(${draftExports.createdAt}, ${draftExports.id}) < (${after.createdAt}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(draftExports.createdAt), desc(draftExports.id))
    .limit(options.limit);
}

export async function findExport(
  db: DbOrTx,
  ctx: RequestContext,
  exportId: string,
): Promise<ExportRow | null> {
  if (!UUID.test(exportId)) return null;
  const rows = await db
    .select()
    .from(draftExports)
    .where(and(eq(draftExports.workspaceId, ctx.workspaceId), eq(draftExports.id, exportId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * For a signed download only: the link carries no workspace, so the row is found by id and the
 * signature, which covers the workspace, is what authorises it.
 */
export async function findExportForSignedRead(
  db: DbOrTx,
  exportId: string,
): Promise<ExportRow | null> {
  if (!UUID.test(exportId)) return null;
  const rows = await db.select().from(draftExports).where(eq(draftExports.id, exportId)).limit(1);
  return rows[0] ?? null;
}

/** True while the person is still a member of the workspace. */
export async function isMember(db: DbOrTx, workspaceId: string, userId: string): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** ready -> expired for rows past their expiry; returns them so the files can be deleted. */
export async function markExpired(db: DbOrTx, limit: number): Promise<ExportRow[]> {
  const due = await db
    .select({ id: draftExports.id })
    .from(draftExports)
    .where(and(eq(draftExports.status, 'ready'), lt(draftExports.expiresAt, sql`now()`)))
    .limit(limit);
  if (due.length === 0) return [];
  return db
    .update(draftExports)
    .set({ status: 'expired' })
    .where(
      and(
        inArray(
          draftExports.id,
          due.map((row) => row.id),
        ),
        eq(draftExports.status, 'ready'),
        lt(draftExports.expiresAt, sql`now()`),
      ),
    )
    .returning();
}

/**
 * Export jobs that ended without a package row (failed, cancelled, or a crash between the file
 * write and the settle), finished between `since` and `before`. Their file key is deterministic.
 */
export async function listFinishedJobsWithoutPackage(
  db: DbOrTx,
  since: Date,
  before: Date,
  limit: number,
): Promise<{ id: string; workspaceId: string }[]> {
  return db
    .select({ id: jobs.id, workspaceId: jobs.workspaceId })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, 'export_package'),
        inArray(jobs.status, ['failed', 'cancelled']),
        gt(jobs.finishedAt, since),
        lt(jobs.finishedAt, before),
      ),
    )
    .limit(limit);
}
