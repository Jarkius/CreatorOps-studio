import {
  CAMPAIGN_STATUS_VALUES,
  LANGUAGE_VALUES,
  PLATFORM_VALUES,
  type Campaign,
  type CampaignListQueryParsed,
  type CampaignListResponse,
  type CreateCampaignRequest,
  type TemplateListResponse,
  type UpdateCampaignRequest,
} from '@creatorops/contracts';
import { getTemplate, listTemplates } from '@creatorops/provider-core';

import type { Db } from '../../db/client.js';
import { decodeCursor, encodeCursor } from '../../platform/cursor.js';
import { AppError } from '../../platform/errors.js';
import { recordAuditEvent } from '../audit/repo.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanWrite } from '../identity/permissions.js';
import { latestGenerateJobsFor } from '../jobs/repo.js';
import { toJob } from '../jobs/service.js';
import { findProduct } from '../products/repo.js';
import { normalizeText } from '../products/service.js';
import {
  countCampaigns,
  findCampaign,
  insertCampaign,
  listCampaigns as listCampaignRows,
  lockWorkspaceDefaults,
  updateCampaignVersioned,
  type CampaignPatch,
  type CampaignRow,
} from './repo.js';

/** A workspace may hold this many campaigns, whatever their status. */
export const MAX_CAMPAIGNS_PER_WORKSPACE = 500;

const NAME_LIMIT = 120;

/** Keeps a value only if it is one of the allowed wire values; the database already enforces this. */
function pick<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

export function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    productId: row.productId,
    name: row.name,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    language: pick(LANGUAGE_VALUES, row.language, 'th'),
    tone: row.tone,
    platform: pick(PLATFORM_VALUES, row.platform, 'generic'),
    durationSeconds: row.durationSeconds,
    variants: row.variants,
    status: pick(CAMPAIGN_STATUS_VALUES, row.status, 'draft'),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const notFound = () => new AppError('NOT_FOUND', 'Campaign not found.');

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_ERROR', 'The request is not valid.', [{ path, message }]);
}

/** An empty tone after normalisation means "no tone". */
function toneOrNull(value: string | null): string | null {
  if (value === null) return null;
  const text = normalizeText(value);
  return text === '' ? null : text;
}

/**
 * The product name, cut to at most 120 characters (code points, and UTF-16 units for the contract)
 * at a whole grapheme cluster, so a Thai base letter is never separated from its marks.
 */
export function defaultCampaignName(productName: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let out = '';
  for (const { segment } of segmenter.segment(productName)) {
    const candidate = out + segment;
    if ([...candidate].length > NAME_LIMIT || candidate.length > NAME_LIMIT) break;
    out = candidate;
  }
  return normalizeText(out);
}

export function listTemplateItems(): TemplateListResponse {
  return {
    items: listTemplates().map((template) => ({
      id: template.id,
      version: template.version,
      name: { th: template.name.th, en: template.name.en },
      description: { th: template.description.th, en: template.description.en },
      defaultDurationSeconds: template.defaultDurationSeconds,
    })),
  };
}

export async function createCampaign(
  db: Db,
  ctx: RequestContext,
  input: CreateCampaignRequest,
): Promise<Campaign> {
  assertCanWrite(ctx);

  const product = await findProduct(db, ctx, input.productId);
  if (product === null) throw invalid('productId', 'Product not found');
  if (product.status === 'archived') {
    throw new AppError('CONFLICT', 'Archived products cannot get new campaigns.');
  }

  const template = getTemplate(input.templateId, input.templateVersion);
  if (template === undefined) throw invalid('templateId', 'Template not found');

  const name =
    input.name === undefined
      ? defaultCampaignName(product.name) || 'Campaign'
      : normalizeText(input.name);
  if (name === '') throw invalid('name', 'must not be empty');

  const tone = toneOrNull(input.tone ?? null);
  const platform = input.platform ?? 'generic';
  const variants = input.variants ?? 1;

  const row = await db.transaction(async (tx) => {
    // The workspace row lock serialises concurrent creates, so the cap cannot be overshot.
    const { defaultLanguage } = await lockWorkspaceDefaults(tx, ctx);
    if ((await countCampaigns(tx, ctx)) >= MAX_CAMPAIGNS_PER_WORKSPACE) {
      throw new AppError('CONFLICT', 'Campaign limit reached.');
    }
    const created = await insertCampaign(tx, ctx, {
      productId: product.id,
      name,
      templateId: template.id,
      templateVersion: template.version,
      language: input.language ?? defaultLanguage,
      tone,
      platform,
      durationSeconds: input.durationSeconds ?? template.defaultDurationSeconds,
      variants,
    });
    await recordAuditEvent(tx, ctx, {
      action: 'campaign.create',
      resourceType: 'campaign',
      resourceId: created.id,
      metadata: { name: created.name },
    });
    return created;
  });
  return toCampaign(row);
}

export async function getCampaign(
  db: Db,
  ctx: RequestContext,
  campaignId: string,
): Promise<Campaign> {
  const row = await findCampaign(db, ctx, campaignId);
  if (row === null) throw notFound();
  return toCampaign(row);
}

export async function listCampaigns(
  db: Db,
  ctx: RequestContext,
  query: CampaignListQueryParsed,
): Promise<CampaignListResponse> {
  const rows = await listCampaignRows(db, ctx, {
    status: query.status,
    limit: query.limit + 1,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const latest = new Map(
    (
      await latestGenerateJobsFor(
        db,
        ctx,
        page.map((row) => row.id),
      )
    ).map((job) => [job.campaignId, toJob(job)]),
  );
  return {
    items: page.map((row) => ({
      ...toCampaign(row),
      latestGenerateJob: latest.get(row.id) ?? null,
    })),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  };
}

export async function updateCampaign(
  db: Db,
  ctx: RequestContext,
  campaignId: string,
  input: UpdateCampaignRequest,
): Promise<Campaign> {
  assertCanWrite(ctx);

  const patch: { -readonly [K in keyof CampaignPatch]?: CampaignPatch[K] } = {};
  if (input.name !== undefined) {
    const name = normalizeText(input.name);
    if (name === '') throw invalid('name', 'must not be empty');
    patch.name = name;
  }
  if (input.tone !== undefined) patch.tone = toneOrNull(input.tone);
  if (input.status !== undefined) patch.status = input.status;

  const row = await db.transaction(async (tx) => {
    const updated = await updateCampaignVersioned(tx, ctx, campaignId, input.version, patch);
    if (updated === null) return null;
    await recordAuditEvent(tx, ctx, {
      action: 'campaign.update',
      resourceType: 'campaign',
      resourceId: updated.id,
      // Field names only: values may be long or sensitive.
      metadata: { fields: Object.keys(patch), version: updated.version },
    });
    return updated;
  });
  if (row !== null) return toCampaign(row);

  // Nothing was updated: the campaign is missing, or its version moved on.
  const current = await findCampaign(db, ctx, campaignId);
  if (current === null) throw notFound();
  throw new AppError(
    'CONFLICT',
    'This campaign was changed by someone else. Reload it and try again.',
    undefined,
    { currentVersion: current.version },
  );
}
