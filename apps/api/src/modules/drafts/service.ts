import {
  DRAFT_STATUS_VALUES,
  SECTION_NAMES,
  type Draft,
  type DraftListQueryParsed,
  type DraftListResponse,
  type UpdateDraftRequest,
} from '@creatorops/contracts';
import { isProviderError, validateSectionValue } from '@creatorops/provider-core';

import type { Db } from '../../db/client.js';
import { decodeCursor, encodeCursor } from '../../platform/cursor.js';
import { AppError } from '../../platform/errors.js';
import { recordAuditEvent } from '../audit/repo.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanWrite } from '../identity/permissions.js';
import { toFacts } from '../jobs/generate-brief.js';
import { findProduct } from '../products/repo.js';
import { findDraft, listDrafts as listDraftRows, updateDraftRow, type DraftRow } from './repo.js';
import { applySectionChanges, readDraftContent } from './state.js';

const notFound = () => new AppError('NOT_FOUND', 'Draft not found.');

export function toDraft(row: DraftRow): Draft {
  const content = readDraftContent(row);
  // A damaged row is a bug or a bad manual edit, never something a client can fix: answer 500.
  if (content === null) throw new Error(`Draft ${row.id} does not match the content contract`);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    productId: row.productId,
    variantIndex: row.variantIndex,
    sections: content.sections,
    sectionState: content.sectionState,
    claimWarnings: content.claimWarnings,
    needsReview: row.needsReview,
    status: DRAFT_STATUS_VALUES.find((item) => item === row.status) ?? 'draft',
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getDraft(db: Db, ctx: RequestContext, draftId: string): Promise<Draft> {
  const row = await findDraft(db, ctx, draftId);
  if (row === null) throw notFound();
  return toDraft(row);
}

export async function listDrafts(
  db: Db,
  ctx: RequestContext,
  query: DraftListQueryParsed,
): Promise<DraftListResponse> {
  const rows = await listDraftRows(db, ctx, {
    campaignId: query.campaignId,
    limit: query.limit + 1,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toDraft),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  };
}

/**
 * Edits sections by hand (D-050, D-058). The client sends the version it last saw; a stale
 * version answers 409 with the current one. Every section whose value really changes gets the
 * next revision with origin `edited`, which is what makes a regenerate job that was started
 * earlier fail with SECTION_CHANGED instead of overwriting the edit. The claim guard runs again
 * over the whole draft. Changed content sends an approved or reviewed draft back to `draft`
 * unless the request names a status.
 */
export async function updateDraft(
  db: Db,
  ctx: RequestContext,
  draftId: string,
  input: UpdateDraftRequest,
): Promise<Draft> {
  assertCanWrite(ctx);

  // The same normalisation and limits as generated output (NFC, graphemes, hashtag rules).
  const values: Record<string, unknown> = {};
  for (const name of SECTION_NAMES) {
    const value = input.sections[name];
    if (value === undefined) continue;
    try {
      values[name] = validateSectionValue(name, value);
    } catch (error) {
      if (!isProviderError(error)) throw error;
      throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
        { path: `sections.${name}`, message: 'is not valid' },
      ]);
    }
  }

  const row = await db.transaction(async (tx) => {
    // The row lock orders this edit against a regenerate job settling the same draft.
    const current = await findDraft(tx, ctx, draftId, { forUpdate: true });
    if (current === null) throw notFound();
    if (current.version !== input.version) {
      throw new AppError(
        'CONFLICT',
        'This draft was changed by someone else. Reload it and try again.',
        undefined,
        { currentVersion: current.version },
      );
    }
    const content = readDraftContent(current);
    if (content === null)
      throw new Error(`Draft ${current.id} does not match the content contract`);

    const product = await findProduct(tx, ctx, current.productId);
    if (product === null) throw new Error(`Product of draft ${current.id} is missing`);

    const next = applySectionChanges(
      content,
      values,
      { origin: 'edited', jobId: null },
      toFacts(product),
    );
    const status = input.status ?? (next.changed.length > 0 ? 'draft' : current.status);
    if (next.changed.length === 0 && status === current.status) return current;

    const updated = await updateDraftRow(tx, ctx.workspaceId, current.id, current.version, {
      sections: next.sections,
      sectionState: next.sectionState,
      claimWarnings: next.claimWarnings,
      needsReview: next.needsReview,
      status: DRAFT_STATUS_VALUES.find((item) => item === status) ?? 'draft',
    });
    if (updated === null) throw new Error('Draft update lost its row lock');
    await recordAuditEvent(tx, ctx, {
      action: 'draft.update',
      resourceType: 'draft',
      resourceId: updated.id,
      // Section names only: the text may be long or sensitive.
      metadata: { sections: next.changed, status, version: updated.version },
    });
    return updated;
  });
  return toDraft(row);
}
