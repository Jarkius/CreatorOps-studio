import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { campaignCosts, campaigns, contentDrafts, jobs, usageEvents } from '../../db/schema.js';

export type ManualCostRow = typeof campaignCosts.$inferSelect;

/** Manual lines of one campaign, oldest first. Always scoped by the workspace. */
export async function listManualCosts(
  db: DbOrTx,
  workspaceId: string,
  campaignId: string,
): Promise<ManualCostRow[]> {
  return db
    .select()
    .from(campaignCosts)
    .where(
      and(eq(campaignCosts.workspaceId, workspaceId), eq(campaignCosts.campaignId, campaignId)),
    )
    .orderBy(asc(campaignCosts.createdAt), asc(campaignCosts.id));
}

export async function countManualCosts(
  db: DbOrTx,
  workspaceId: string,
  campaignId: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignCosts)
    .where(
      and(eq(campaignCosts.workspaceId, workspaceId), eq(campaignCosts.campaignId, campaignId)),
    );
  return rows[0]?.n ?? 0;
}

export interface ManualCostValues {
  readonly campaignId: string;
  readonly scene: string | null;
  readonly label: string;
  readonly amountThb: string;
}

export async function insertManualCost(
  db: DbOrTx,
  workspaceId: string,
  userId: string,
  values: ManualCostValues,
): Promise<ManualCostRow> {
  const rows = await db
    .insert(campaignCosts)
    .values({ ...values, workspaceId, createdBy: userId })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to insert the cost line');
  return row;
}

export async function deleteManualCost(
  db: DbOrTx,
  workspaceId: string,
  campaignId: string,
  costId: string,
): Promise<boolean> {
  const rows = await db
    .delete(campaignCosts)
    .where(
      and(
        eq(campaignCosts.workspaceId, workspaceId),
        eq(campaignCosts.campaignId, campaignId),
        eq(campaignCosts.id, costId),
      ),
    )
    .returning({ id: campaignCosts.id });
  return rows.length > 0;
}

export interface AiTextTotals {
  readonly calls: number;
  readonly costUsd: number;
  readonly anomalies: number;
}

/**
 * The campaign a job belongs to: a generate job names it directly; a regenerate job only names a
 * draft, so the campaign comes from that draft. (Export jobs make no model call.)
 */
export const jobCampaignId = sql<
  string | null
>`coalesce(${jobs.campaignId}, ${contentDrafts.campaignId})`;

/**
 * Settled AI text calls of the jobs that belong to this campaign (its generate jobs and the
 * regenerate jobs of its drafts). Unsettled reservations are not costs yet.
 */
export async function aiTextTotals(
  db: DbOrTx,
  workspaceId: string,
  campaignId: string,
): Promise<AiTextTotals> {
  const rows = await db
    .select({
      calls: sql<number>`count(*)::int`,
      cost: sql<string>`coalesce(sum(coalesce(${usageEvents.costUsd}, 0)), 0)`,
      anomalies: sql<number>`count(*) filter (where ${usageEvents.anomaly})::int`,
    })
    .from(usageEvents)
    .innerJoin(
      jobs,
      and(eq(jobs.workspaceId, usageEvents.workspaceId), eq(jobs.id, usageEvents.jobId)),
    )
    .leftJoin(
      contentDrafts,
      and(eq(contentDrafts.workspaceId, jobs.workspaceId), eq(contentDrafts.id, jobs.draftId)),
    )
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        eq(usageEvents.status, 'settled'),
        sql`${jobCampaignId} = ${campaignId}`,
      ),
    );
  const row = rows[0];
  return {
    calls: row?.calls ?? 0,
    costUsd: Number(row?.cost ?? 0),
    anomalies: row?.anomalies ?? 0,
  };
}

export interface MonthRange {
  readonly start: Date;
  readonly end: Date;
}

export interface CampaignAiRow {
  readonly campaignId: string;
  readonly calls: number;
  readonly costUsd: number;
}

/** Settled AI calls created in the month, grouped by the campaign they belong to. */
export async function aiByCampaign(
  db: DbOrTx,
  workspaceId: string,
  range: MonthRange,
): Promise<CampaignAiRow[]> {
  const rows = await db
    .select({
      campaignId: sql<string>`${jobCampaignId}`,
      calls: sql<number>`count(*)::int`,
      cost: sql<string>`coalesce(sum(coalesce(${usageEvents.costUsd}, 0)), 0)`,
    })
    .from(usageEvents)
    .innerJoin(
      jobs,
      and(eq(jobs.workspaceId, usageEvents.workspaceId), eq(jobs.id, usageEvents.jobId)),
    )
    .leftJoin(
      contentDrafts,
      and(eq(contentDrafts.workspaceId, jobs.workspaceId), eq(contentDrafts.id, jobs.draftId)),
    )
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        eq(usageEvents.status, 'settled'),
        sql`${usageEvents.createdAt} >= ${range.start} and ${usageEvents.createdAt} < ${range.end}`,
        sql`${jobCampaignId} is not null`,
      ),
    )
    .groupBy(jobCampaignId);
  return rows.map((row) => ({
    campaignId: row.campaignId,
    calls: row.calls,
    costUsd: Number(row.cost),
  }));
}

export interface CampaignManualRow {
  readonly campaignId: string;
  readonly amountThb: number;
}

/** Typed-in lines added in the month, summed per campaign. */
export async function manualByCampaign(
  db: DbOrTx,
  workspaceId: string,
  range: MonthRange,
): Promise<CampaignManualRow[]> {
  const rows = await db
    .select({
      campaignId: campaignCosts.campaignId,
      amount: sql<string>`coalesce(sum(${campaignCosts.amountThb}), 0)`,
    })
    .from(campaignCosts)
    .where(
      and(
        eq(campaignCosts.workspaceId, workspaceId),
        sql`${campaignCosts.createdAt} >= ${range.start} and ${campaignCosts.createdAt} < ${range.end}`,
      ),
    )
    .groupBy(campaignCosts.campaignId);
  return rows.map((row) => ({ campaignId: row.campaignId, amountThb: Number(row.amount) }));
}

/** Names of the given campaigns in this workspace. */
export async function campaignNames(
  db: DbOrTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, workspaceId), inArray(campaigns.id, [...ids])));
  return new Map(rows.map((row) => [row.id, row.name]));
}
