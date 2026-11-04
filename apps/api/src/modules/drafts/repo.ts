import type { DraftStatus } from '@creatorops/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { contentDrafts } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';

export type DraftRow = typeof contentDrafts.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowMs = sql`date_trunc('milliseconds', now())`;

/**
 * Finds a draft by workspace id. The worker has no request context, only the workspace of its
 * job; the API goes through `findDraft`. Either way the workspace is part of the query.
 */
export async function findDraftIn(
  db: DbOrTx,
  workspaceId: string,
  draftId: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<DraftRow | null> {
  if (!UUID.test(draftId)) return null;
  const query = db
    .select()
    .from(contentDrafts)
    .where(and(eq(contentDrafts.workspaceId, workspaceId), eq(contentDrafts.id, draftId)))
    .limit(1);
  const rows = await (options.forUpdate === true ? query.for('update') : query);
  return rows[0] ?? null;
}

export function findDraft(
  db: DbOrTx,
  ctx: RequestContext,
  draftId: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<DraftRow | null> {
  return findDraftIn(db, ctx.workspaceId, draftId, options);
}

export interface ListOptions {
  readonly campaignId?: string | undefined;
  readonly limit: number;
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

/** Newest first, ties broken by id so pages never repeat or skip. */
export async function listDrafts(
  db: DbOrTx,
  ctx: RequestContext,
  options: ListOptions,
): Promise<DraftRow[]> {
  const after = options.after;
  // A campaign id that is not a UUID can match nothing (and must not reach the uuid column).
  if (options.campaignId !== undefined && !UUID.test(options.campaignId)) return [];
  return db
    .select()
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.workspaceId, ctx.workspaceId),
        options.campaignId === undefined
          ? undefined
          : eq(contentDrafts.campaignId, options.campaignId),
        after === undefined
          ? undefined
          : sql`(${contentDrafts.createdAt}, ${contentDrafts.id}) < (${after.createdAt}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(contentDrafts.createdAt), desc(contentDrafts.id))
    .limit(options.limit);
}

export interface DraftUpdate {
  readonly sections: Record<string, unknown>;
  readonly sectionState: Record<string, unknown>;
  readonly claimWarnings: readonly unknown[];
  readonly needsReview: boolean;
  readonly status: DraftStatus;
}

/**
 * Stores a new state and raises the version by one. Call it inside a transaction that holds the
 * row lock (`findDraft(..., { forUpdate: true })`); the version in the where clause is a second
 * line of defence, never the only one.
 */
export async function updateDraftRow(
  tx: DbOrTx,
  workspaceId: string,
  draftId: string,
  expectedVersion: number,
  update: DraftUpdate,
): Promise<DraftRow | null> {
  const rows = await tx
    .update(contentDrafts)
    .set({
      sections: update.sections,
      sectionState: update.sectionState,
      claimWarnings: [...update.claimWarnings],
      needsReview: update.needsReview,
      status: update.status,
      version: sql`${contentDrafts.version} + 1`,
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(contentDrafts.workspaceId, workspaceId),
        eq(contentDrafts.id, draftId),
        eq(contentDrafts.version, expectedVersion),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
