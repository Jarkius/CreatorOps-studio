import { z } from 'zod';

import { DraftSceneSchema } from './export.js';

/** Baht per 1 USD used when the workspace has not entered a rate (a market-style default). */
export const DEFAULT_THB_PER_USD = 35;

export const CAMPAIGN_COST_LIMITS = {
  label: 80,
  maxAmountThb: 1_000_000,
  /** Manual cost lines per campaign. */
  maxItems: 50,
} as const;

const idString = z.string().min(1).max(64);

export const CampaignCostParamsSchema = z.object({ campaignId: idString });
export const CampaignCostItemParamsSchema = z.object({ campaignId: idString, costId: idString });

/** One cost the owner typed in by hand, for example a paid image tool, in Thai baht. */
export const ManualCostSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  /** The storyboard scene it belongs to, or null for the whole campaign. */
  scene: DraftSceneSchema.nullable(),
  label: z.string(),
  amountThb: z.number(),
  createdAt: z.string(),
});
export type ManualCost = z.infer<typeof ManualCostSchema>;

/** POST /api/v1/workspaces/:workspaceId/campaigns/:campaignId/costs */
export const CreateManualCostRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(CAMPAIGN_COST_LIMITS.label),
    scene: DraftSceneSchema.nullish(),
    /** Baht with at most two decimals. */
    amountThb: z
      .number()
      .min(0.01)
      .max(CAMPAIGN_COST_LIMITS.maxAmountThb)
      .refine((value) => Math.round(value * 100) / 100 === value, {
        message: 'at most two decimals',
      }),
  })
  .strict();
export type CreateManualCostRequest = z.input<typeof CreateManualCostRequestSchema>;

/**
 * GET /api/v1/workspaces/:workspaceId/campaigns/:campaignId/cost: what one campaign cost, in Thai
 * baht. AI text cost comes from the usage ledger (settled calls of this campaign's jobs); the
 * scene and tool costs are typed in by hand. The baht figure converts at the rate saved in the
 * provider settings today.
 */
export const CampaignCostSchema = z.object({
  currency: z.literal('THB'),
  /** Baht per 1 USD of the provider's billed cost. */
  thbPerUsd: z.number(),
  /** `settings` when the owner entered it, `default` otherwise. */
  rateSource: z.enum(['settings', 'default']),
  /** Baht per real US dollar, for the US$ shown beside baht. Not a billing rate. */
  marketThbPerUsd: z.number(),
  aiText: z.object({
    calls: z.number().int(),
    costUsd: z.number(),
    costThb: z.number(),
    /** Calls whose reported cost was far above the entered prices. */
    anomalies: z.number().int(),
  }),
  manual: z.object({
    items: z.array(ManualCostSchema),
    totalThb: z.number(),
  }),
  totalThb: z.number(),
});
export type CampaignCost = z.infer<typeof CampaignCostSchema>;
