import {
  guardDraft,
  validateDraftSections,
  type ClaimWarning,
  type DraftSections,
  type ProductFacts,
  type TextProvider,
} from '@creatorops/provider-core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { DbOrTx } from '../../db/client.js';
import { campaigns, products } from '../../db/schema.js';

/**
 * The settings snapshot taken when the job was created (service.ts). Read back with the same
 * strictness as any other input: a row that does not match fails the job, it is never guessed at.
 */
const InputSchema = z.object({
  campaignId: z.string().min(1),
  productId: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.number().int().min(1),
  language: z.enum(['th', 'en']),
  tone: z.string().nullable(),
  platform: z.enum(['tiktok', 'facebook', 'shopee', 'generic']),
  durationSeconds: z.number().int().min(1),
  variants: z.number().int().min(1).max(3),
});

/** A failure that no retry can fix, with a message that is safe to show to a user. */
export class PermanentJobFailure extends Error {
  constructor(
    readonly code: 'INTERNAL' | 'SECTION_CHANGED',
    message: string,
  ) {
    super(message);
    this.name = 'PermanentJobFailure';
  }
}

export interface GeneratedVariant {
  readonly variantIndex: number;
  readonly sections: DraftSections;
  readonly claimWarnings: ClaimWarning[];
  readonly needsReview: boolean;
}

export interface GenerationResult {
  readonly campaignId: string;
  readonly productId: string;
  readonly provider: string;
  readonly model: string;
  readonly variants: GeneratedVariant[];
}

export function toFacts(row: typeof products.$inferSelect): ProductFacts {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    name: row.name,
    description: row.description,
    priceAmount: row.priceAmount,
    currency: row.currency,
    sellingPoints: strings(row.sellingPoints),
    targetAudience: row.targetAudience,
    brandTone: row.brandTone,
    restrictedClaims: strings(row.restrictedClaims),
  };
}

/**
 * Builds every variant of a campaign with the provider, validates it and runs the claim guard
 * (D-051). Nothing is written: the caller stores the result in one transaction together with the
 * job's success, so a retry or a lost lease can never leave half a result behind.
 */
export async function generateBrief(
  db: DbOrTx,
  provider: TextProvider,
  job: { readonly workspaceId: string; readonly input: unknown },
  signal: AbortSignal,
): Promise<GenerationResult> {
  const parsed = InputSchema.safeParse(job.input);
  if (!parsed.success) {
    throw new PermanentJobFailure('INTERNAL', 'The job settings are not valid.');
  }
  const input = parsed.data;

  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, job.workspaceId), eq(campaigns.id, input.campaignId)))
    .limit(1);
  const campaign = campaignRows[0];
  if (campaign === undefined || campaign.status === 'archived') {
    throw new PermanentJobFailure('INTERNAL', 'The campaign is no longer available.');
  }
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, job.workspaceId), eq(products.id, campaign.productId)))
    .limit(1);
  const product = productRows[0];
  if (product === undefined || product.status === 'archived') {
    throw new PermanentJobFailure('INTERNAL', 'The product is no longer available.');
  }
  const facts = toFacts(product);

  const variants: GeneratedVariant[] = [];
  let model = '';
  for (let variantIndex = 0; variantIndex < input.variants; variantIndex += 1) {
    signal.throwIfAborted();
    const result = await provider.generateBrief(
      {
        template: { id: input.templateId, version: input.templateVersion },
        language: input.language,
        tone: input.tone,
        platform: input.platform,
        durationSeconds: input.durationSeconds,
        variantIndex,
        product: facts,
      },
      { signal },
    );
    // A provider's output is never trusted: validate it again whatever the adapter promises.
    const sections = validateDraftSections(result.output);
    const guard = guardDraft(sections, facts);
    variants.push({
      variantIndex,
      sections,
      claimWarnings: guard.claimWarnings,
      needsReview: guard.needsReview,
    });
    model = result.model;
  }
  return {
    campaignId: campaign.id,
    productId: campaign.productId,
    provider: provider.id,
    model,
    variants,
  };
}
