import {
  CAMPAIGN_COST_LIMITS,
  COST_REPORT_MAX_CAMPAIGNS,
  type CostReport,
  type CostReportQuery,
  DEFAULT_THB_PER_USD,
  DRAFT_SCENE_VALUES,
  type CampaignCost,
  type CreateManualCostRequest,
  type ManualCost,
} from '@creatorops/contracts';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import { recordAuditEvent } from '../audit/repo.js';
import { findCampaign } from '../campaigns/repo.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanWrite } from '../identity/permissions.js';
import { findCredential } from '../provider-settings/repo.js';
import { pricingOf } from '../provider-settings/service.js';
import {
  aiByCampaign,
  aiTextTotals,
  campaignNames,
  manualByCampaign,
  countManualCosts,
  deleteManualCost,
  insertManualCost,
  listManualCosts,
  type ManualCostRow,
} from './repo.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new AppError('NOT_FOUND', 'Campaign not found.');

/** Money is kept in cents of baht so sums never drift. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

function toManualCost(row: ManualCostRow): ManualCost {
  return {
    id: row.id,
    campaignId: row.campaignId,
    scene: DRAFT_SCENE_VALUES.find((scene) => scene === row.scene) ?? null,
    label: row.label,
    amountThb: Number(row.amountThb),
    createdAt: row.createdAt.toISOString(),
  };
}

/** What one campaign cost, in baht. Any member of the workspace may read. */
export async function getCampaignCost(
  db: Db,
  ctx: RequestContext,
  campaignId: string,
): Promise<CampaignCost> {
  const campaign = await findCampaign(db, ctx, campaignId);
  if (campaign === null) throw notFound();
  const [ai, manualRows, credential] = await Promise.all([
    aiTextTotals(db, ctx.workspaceId, campaign.id),
    listManualCosts(db, ctx.workspaceId, campaign.id),
    findCredential(db, ctx),
  ]);
  const pricing = credential === null ? null : pricingOf(credential);
  const entered = pricing?.thbPerUsd;
  const thbPerUsd = entered ?? DEFAULT_THB_PER_USD;
  const items = manualRows.map(toManualCost);
  const manualTotal = round2(items.reduce((sum, item) => sum + item.amountThb, 0));
  const aiThb = round2(ai.costUsd * thbPerUsd);
  return {
    currency: 'THB',
    thbPerUsd,
    rateSource: entered === undefined ? 'default' : 'settings',
    marketThbPerUsd: pricing?.marketThbPerUsd ?? DEFAULT_THB_PER_USD,
    aiText: { calls: ai.calls, costUsd: ai.costUsd, costThb: aiThb, anomalies: ai.anomalies },
    manual: { items, totalThb: manualTotal },
    totalThb: round2(aiThb + manualTotal),
  };
}

/** Adds a hand-typed cost line. Owner, admin and editor only. */
export async function addManualCost(
  db: Db,
  ctx: RequestContext,
  campaignId: string,
  input: CreateManualCostRequest,
): Promise<ManualCost> {
  assertCanWrite(ctx);
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, ctx, campaignId);
    if (campaign === null) throw notFound();
    if (
      (await countManualCosts(tx, ctx.workspaceId, campaign.id)) >= CAMPAIGN_COST_LIMITS.maxItems
    ) {
      throw new AppError('CONFLICT', 'This campaign has too many cost lines. Remove some first.');
    }
    const row = await insertManualCost(tx, ctx.workspaceId, ctx.userId, {
      campaignId: campaign.id,
      scene: input.scene ?? null,
      label: input.label,
      amountThb: input.amountThb.toFixed(2),
    });
    // Counts and the amount only: the label is free text and stays out of the audit log.
    await recordAuditEvent(tx, ctx, {
      action: 'campaign.cost.added',
      resourceType: 'campaign',
      resourceId: campaign.id,
      metadata: { costId: row.id, amountThb: input.amountThb, scene: input.scene ?? null },
    });
    return toManualCost(row);
  });
}

/** Removes a cost line. Owner, admin and editor only. */
export async function removeManualCost(
  db: Db,
  ctx: RequestContext,
  campaignId: string,
  costId: string,
): Promise<void> {
  assertCanWrite(ctx);
  if (!UUID.test(campaignId) || !UUID.test(costId)) throw notFound();
  await db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, ctx, campaignId);
    if (campaign === null) throw notFound();
    if (!(await deleteManualCost(tx, ctx.workspaceId, campaign.id, costId.toLowerCase()))) {
      throw new AppError('NOT_FOUND', 'Cost line not found.');
    }
    await recordAuditEvent(tx, ctx, {
      action: 'campaign.cost.removed',
      resourceType: 'campaign',
      resourceId: campaign.id,
      metadata: { costId },
    });
  });
}

/** The UTC month as a half-open range; `undefined` means the current month. */
export function monthRange(
  month: string | undefined,
  now: Date,
): { label: string; start: Date; end: Date } {
  const match = month === undefined ? null : /^(\d{4})-(\d{2})$/.exec(month);
  const year = match === null ? now.getUTCFullYear() : Number(match[1]);
  const index = match === null ? now.getUTCMonth() : Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, index, 1));
  const end = new Date(Date.UTC(year, index + 1, 1));
  return { label: `${String(year)}-${String(index + 1).padStart(2, '0')}`, start, end };
}

/** What the workspace spent in one month, per campaign, in baht. Any member may read. */
export async function getCostReport(
  db: Db,
  ctx: RequestContext,
  query: CostReportQuery,
  now: Date = new Date(),
): Promise<CostReport> {
  const range = monthRange(query.month, now);
  const [ai, manual, credential] = await Promise.all([
    aiByCampaign(db, ctx.workspaceId, range),
    manualByCampaign(db, ctx.workspaceId, range),
    findCredential(db, ctx),
  ]);
  const pricing = credential === null ? null : pricingOf(credential);
  const entered = pricing?.thbPerUsd;
  const thbPerUsd = entered ?? DEFAULT_THB_PER_USD;

  const byCampaign = new Map<string, { aiCalls: number; aiThb: number; manualThb: number }>();
  const row = (id: string) => {
    const existing = byCampaign.get(id);
    if (existing !== undefined) return existing;
    const created = { aiCalls: 0, aiThb: 0, manualThb: 0 };
    byCampaign.set(id, created);
    return created;
  };
  for (const item of ai) {
    const target = row(item.campaignId);
    target.aiCalls += item.calls;
    target.aiThb = round2(item.costUsd * thbPerUsd);
  }
  for (const item of manual) row(item.campaignId).manualThb = round2(item.amountThb);

  const names = await campaignNames(db, ctx.workspaceId, [...byCampaign.keys()]);
  const all = [...byCampaign.entries()]
    .map(([campaignId, value]) => ({
      campaignId,
      name: names.get(campaignId) ?? 'Unknown campaign',
      aiCalls: value.aiCalls,
      aiThb: value.aiThb,
      manualThb: value.manualThb,
      totalThb: round2(value.aiThb + value.manualThb),
    }))
    .sort(
      (a, b) =>
        b.totalThb - a.totalThb ||
        a.name.localeCompare(b.name) ||
        a.campaignId.localeCompare(b.campaignId),
    );

  const sum = (pick: (item: (typeof all)[number]) => number) =>
    round2(all.reduce((total, item) => total + pick(item), 0));
  return {
    month: range.label,
    currency: 'THB',
    thbPerUsd,
    rateSource: entered === undefined ? 'default' : 'settings',
    marketThbPerUsd: pricing?.marketThbPerUsd ?? DEFAULT_THB_PER_USD,
    totals: {
      aiCalls: all.reduce((total, item) => total + item.aiCalls, 0),
      aiThb: sum((item) => item.aiThb),
      manualThb: sum((item) => item.manualThb),
      totalThb: sum((item) => item.totalThb),
    },
    campaigns: all.slice(0, COST_REPORT_MAX_CAMPAIGNS),
    truncated: all.length > COST_REPORT_MAX_CAMPAIGNS,
  };
}
