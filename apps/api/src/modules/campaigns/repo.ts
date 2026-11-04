import type { CampaignStatus, Language, Platform } from '@creatorops/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { campaigns, workspaces } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';

export type CampaignRow = typeof campaigns.$inferSelect;

/** Values chosen at creation, after normalisation and defaults. */
export interface CampaignValues {
  readonly productId: string;
  readonly name: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly language: Language;
  readonly tone: string | null;
  readonly platform: Platform;
  readonly durationSeconds: number;
  readonly variants: number;
}

/** Editable campaign fields after normalisation. Null clears an optional field. */
export interface CampaignPatch {
  readonly name?: string;
  readonly tone?: string | null;
  readonly status?: CampaignStatus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowMs = sql`date_trunc('milliseconds', now())`;

/** Locks the workspace row for the rest of the transaction and returns its default language. */
export async function lockWorkspaceDefaults(
  db: DbOrTx,
  ctx: RequestContext,
): Promise<{ readonly defaultLanguage: Language }> {
  const rows = await db
    .select({ defaultLanguage: workspaces.defaultLanguage })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .for('update');
  const row = rows[0];
  if (row === undefined) throw new Error('Workspace not found');
  return { defaultLanguage: row.defaultLanguage === 'en' ? 'en' : 'th' };
}

export async function countCampaigns(db: DbOrTx, ctx: RequestContext): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(eq(campaigns.workspaceId, ctx.workspaceId));
  return rows[0]?.count ?? 0;
}

/** Every function takes the resolved context, so every query is scoped to its workspace. */
export async function insertCampaign(
  db: DbOrTx,
  ctx: RequestContext,
  values: CampaignValues,
): Promise<CampaignRow> {
  const rows = await db
    .insert(campaigns)
    .values({ ...values, workspaceId: ctx.workspaceId, createdBy: ctx.userId })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to insert the campaign');
  return row;
}

export async function findCampaign(
  db: DbOrTx,
  ctx: RequestContext,
  campaignId: string,
): Promise<CampaignRow | null> {
  if (!UUID.test(campaignId)) return null;
  const rows = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, ctx.workspaceId), eq(campaigns.id, campaignId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ListOptions {
  readonly status?: CampaignStatus | undefined;
  readonly limit: number;
  /** Exclusive position: rows strictly older than this (created_at, id) pair. */
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

/** Newest first, ties broken by id so the order is total and pages never repeat or skip. */
export async function listCampaigns(
  db: DbOrTx,
  ctx: RequestContext,
  options: ListOptions,
): Promise<CampaignRow[]> {
  const after = options.after;
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.workspaceId, ctx.workspaceId),
        options.status === undefined ? undefined : eq(campaigns.status, options.status),
        after === undefined
          ? undefined
          : sql`(${campaigns.createdAt}, ${campaigns.id}) < (${after.createdAt}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(campaigns.createdAt), desc(campaigns.id))
    .limit(options.limit);
}

/** Applies the patch only if the stored version still equals `version`; null otherwise. */
export async function updateCampaignVersioned(
  db: DbOrTx,
  ctx: RequestContext,
  campaignId: string,
  version: number,
  patch: CampaignPatch,
): Promise<CampaignRow | null> {
  if (!UUID.test(campaignId)) return null;
  const rows = await db
    .update(campaigns)
    .set({ ...patch, version: sql`${campaigns.version} + 1`, updatedAt: nowMs })
    .where(
      and(
        eq(campaigns.workspaceId, ctx.workspaceId),
        eq(campaigns.id, campaignId),
        eq(campaigns.version, version),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
