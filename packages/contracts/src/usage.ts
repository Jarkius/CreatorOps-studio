import { z } from 'zod';

/** GET /api/v1/workspaces/:workspaceId/usage: this calendar month (UTC), real-provider calls only. */
export const UsageSummarySchema = z.object({
  /** `2026-11` */
  month: z.string(),
  /** Calls made and settled this month. */
  calls: z.number().int(),
  inputUnits: z.number().int(),
  outputUnits: z.number().int(),
  /** Settled cost this month, in USD. */
  spentUsd: z.number(),
  /** Worst-case amount set aside for calls that have not settled yet. */
  reservedUsd: z.number(),
  /** The monthly limit, or null for none. */
  capUsd: z.number().nullable(),
  /** `spentUsd + reservedUsd`, the number the limit is checked against. */
  countedUsd: z.number(),
  /** Calls whose reported cost was far above what the entered prices predict. */
  anomalies: z.number().int(),
  byModel: z.array(
    z.object({
      provider: z.string(),
      model: z.string(),
      calls: z.number().int(),
      costUsd: z.number(),
    }),
  ),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
