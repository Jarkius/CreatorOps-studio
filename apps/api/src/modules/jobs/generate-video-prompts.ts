import {
  validateVideoPrompts,
  type ProductFacts,
  type TextProvider,
  type VideoPromptScene,
} from '@creatorops/provider-core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { DbOrTx } from '../../db/client.js';
import { campaigns, products } from '../../db/schema.js';
import { findDraftIn } from '../drafts/repo.js';
import { PermanentJobFailure, toFacts } from './generate-brief.js';

/** The snapshot taken when the job was created (service.ts), read back strictly. */
const InputSchema = z.object({
  draftId: z.string().min(1),
  draftVersion: z.number().int().min(1),
  language: z.enum(['th', 'en']),
  tone: z.string().nullable(),
  platform: z.enum(['tiktok', 'facebook', 'shopee', 'generic']),
  clipSeconds: z.number().int().min(3).max(15),
});

export interface VideoPromptsResult {
  readonly draftId: string;
  readonly draftVersion: number;
  readonly scenes: readonly VideoPromptScene[];
  readonly provider: string;
  readonly model: string;
}

/**
 * Asks the provider for four video prompts for the draft's product and validates them. Nothing is
 * written here: the caller stores the result with the job's success in one transaction.
 */
export async function generateVideoPrompts(
  db: DbOrTx,
  provider: TextProvider,
  job: { readonly workspaceId: string; readonly input: unknown },
  signal: AbortSignal,
): Promise<VideoPromptsResult> {
  const parsed = InputSchema.safeParse(job.input);
  if (!parsed.success) {
    throw new PermanentJobFailure('INTERNAL', 'The job settings are not valid.');
  }
  const input = parsed.data;

  const draft = await findDraftIn(db, job.workspaceId, input.draftId);
  if (draft === null) {
    throw new PermanentJobFailure('INTERNAL', 'The draft is no longer available.');
  }
  const campaignRows = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, job.workspaceId), eq(campaigns.id, draft.campaignId)))
    .limit(1);
  if (campaignRows[0] === undefined || campaignRows[0].status === 'archived') {
    throw new PermanentJobFailure('INTERNAL', 'The campaign is no longer available.');
  }
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, job.workspaceId), eq(products.id, draft.productId)))
    .limit(1);
  const product = productRows[0];
  if (product === undefined || product.status === 'archived') {
    throw new PermanentJobFailure('INTERNAL', 'The product is no longer available.');
  }
  const facts: ProductFacts = toFacts(product);

  signal.throwIfAborted();
  const result = await provider.generateVideoPrompts(
    {
      language: input.language,
      platform: input.platform,
      tone: input.tone,
      product: facts,
      clipSeconds: input.clipSeconds,
    },
    { signal },
  );
  // A provider's output is never trusted: validate it again whatever the adapter promises.
  const scenes = validateVideoPrompts({ scenes: result.scenes }, facts);
  return {
    draftId: draft.id,
    draftVersion: input.draftVersion,
    scenes,
    provider: provider.id,
    model: result.model,
  };
}
