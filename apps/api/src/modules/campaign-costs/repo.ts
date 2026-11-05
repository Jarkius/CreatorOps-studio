import { and, asc, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { campaignCosts, jobs, usageEvents } from '../../db/schema.js';

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
 * Settled AI text calls of the jobs that belong to this campaign (its generate jobs and the
 * regenerate and export jobs of its drafts). Unsettled reservations are not costs yet.
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
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        eq(usageEvents.status, 'settled'),
        eq(jobs.campaignId, campaignId),
      ),
    );
  const row = rows[0];
  return {
    calls: row?.calls ?? 0,
    costUsd: Number(row?.cost ?? 0),
    anomalies: row?.anomalies ?? 0,
  };
}
