import {
  SECTION_NAMES,
  validateSectionValue,
  type ProductFacts,
  type SectionName,
  type SectionValue,
  type TextProvider,
} from '@creatorops/provider-core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { DbOrTx } from '../../db/client.js';
import { campaigns, products } from '../../db/schema.js';
import { findDraftIn } from '../drafts/repo.js';
import { readDraftContent } from '../drafts/state.js';
import { FAILURE_MESSAGES } from './retry.js';
import { PermanentJobFailure, toFacts } from './generate-brief.js';

/** The settings snapshot taken when the job was created (service.ts), read back strictly. */
const InputSchema = z.object({
  draftId: z.string().min(1),
  section: z.enum(SECTION_NAMES),
  expectedRev: z.number().int().min(1),
  templateId: z.string().min(1),
  templateVersion: z.number().int().min(1),
  language: z.enum(['th', 'en']),
  tone: z.string().nullable(),
  platform: z.enum(['tiktok', 'facebook', 'shopee', 'generic']),
  durationSeconds: z.number().int().min(1),
  variantIndex: z.number().int().min(0).max(2),
});

export interface RegenerationResult {
  readonly draftId: string;
  readonly section: SectionName;
  /** The revision the section had when the job was created; the settle step checks it again. */
  readonly expectedRev: number;
  readonly value: SectionValue;
  /** Needed to run the claim guard again over the whole draft when the value is stored. */
  readonly facts: ProductFacts;
  readonly provider: string;
  readonly model: string;
}

/**
 * Asks the provider for a new value of one section and validates it. Nothing is written: the
 * caller stores the value in one transaction with the job's success, after checking the section
 * revision once more under a row lock (D-050).
 */
export async function regenerateSection(
  db: DbOrTx,
  provider: TextProvider,
  job: { readonly workspaceId: string; readonly input: unknown },
  signal: AbortSignal,
): Promise<RegenerationResult> {
  const parsed = InputSchema.safeParse(job.input);
  if (!parsed.success) {
    throw new PermanentJobFailure('INTERNAL', 'The job settings are not valid.');
  }
  const input = parsed.data;

  const draft = await findDraftIn(db, job.workspaceId, input.draftId);
  if (draft === null) {
    throw new PermanentJobFailure('INTERNAL', 'The draft is no longer available.');
  }
  const content = readDraftContent(draft);
  if (content === null) {
    throw new PermanentJobFailure('INTERNAL', 'The draft is no longer available.');
  }
  if (content.sectionState[input.section]?.rev !== input.expectedRev) {
    throw new PermanentJobFailure('SECTION_CHANGED', FAILURE_MESSAGES.SECTION_CHANGED);
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
  const facts = toFacts(product);

  signal.throwIfAborted();
  const result = await provider.regenerateSection(
    {
      template: { id: input.templateId, version: input.templateVersion },
      language: input.language,
      tone: input.tone,
      platform: input.platform,
      durationSeconds: input.durationSeconds,
      variantIndex: input.variantIndex,
      product: facts,
      section: input.section,
      current: content.sections,
    },
    { signal },
  );
  // A provider's output is never trusted: validate it again whatever the adapter promises, and
  // never accept a value for a section other than the one that was asked for.
  if (result.section !== input.section) {
    throw new PermanentJobFailure('INTERNAL', 'The job failed unexpectedly.');
  }
  const value = validateSectionValue(input.section, result.value);

  return {
    draftId: draft.id,
    section: input.section,
    expectedRev: input.expectedRev,
    value,
    facts,
    provider: provider.id,
    model: result.model,
  };
}
