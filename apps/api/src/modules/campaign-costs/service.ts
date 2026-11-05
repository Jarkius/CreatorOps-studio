import {
  CAMPAIGN_COST_LIMITS,
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
  aiTextTotals,
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
