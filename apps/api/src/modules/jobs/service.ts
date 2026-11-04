import { createHash } from 'node:crypto';

import {
  IdempotencyKeySchema,
  JOB_ERROR_CODES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  DRAFT_SCENE_VALUES,
  EXPORT_LIMITS,
  type CreateExportRequest,
  type GenerateBriefJobRequest,
  type RegenerateSectionJobRequest,
  type Job,
  type JobListQueryParsed,
  type JobListResponse,
} from '@creatorops/contracts';

import type { Db, DbOrTx } from '../../db/client.js';
import { decodeCursor, encodeCursor } from '../../platform/cursor.js';
import { AppError } from '../../platform/errors.js';
import { recordAuditEvent } from '../audit/repo.js';
import { findCampaign } from '../campaigns/repo.js';
import { findDraft } from '../drafts/repo.js';
import { readDraftContent } from '../drafts/state.js';
import { listLinked } from '../draft-assets/repo.js';
import { countLiveExports } from '../export/repo.js';
import type { ExportInput } from '../export/input.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanWrite } from '../identity/permissions.js';
import type { JobQueue } from './queue.js';
import {
  cancelQueuedJob,
  countActiveJobs,
  findJob,
  findJobByKey,
  insertJob,
  listJobs as listJobRows,
  lockWorkspace,
  requestCancelRunningJob,
  type JobRow,
} from './repo.js';
import { canTransition, MAX_ACTIVE_JOBS_PER_WORKSPACE } from './transitions.js';

/** The part of a logger the service needs. */
export interface JobLog {
  warn(object: Record<string, unknown>, message: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: JOB_TYPE_VALUES.find((item) => item === row.type) ?? 'generate_brief',
    status: JOB_STATUS_VALUES.find((item) => item === row.status) ?? 'failed',
    input: isRecord(row.input) ? row.input : {},
    output: isRecord(row.output) ? row.output : null,
    errorCode: JOB_ERROR_CODES.find((item) => item === row.errorCode) ?? null,
    errorMessage: row.errorMessage,
    provider: row.provider,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    campaignId: row.campaignId,
    draftId: row.draftId,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
  };
}

const notFound = () => new AppError('NOT_FOUND', 'Job not found.');
const SCENE_VALUES = DRAFT_SCENE_VALUES;

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_ERROR', 'The request is not valid.', [{ path, message }]);
}

/** The Idempotency-Key header, checked against the contract (D-047). */
function parseIdempotencyKey(value: string | string[] | undefined): string {
  const parsed = IdempotencyKeySchema.safeParse(Array.isArray(value) ? undefined : value);
  if (!parsed.success) {
    throw invalid(
      'Idempotency-Key',
      'is required: 8 to 128 letters, digits, underscores or hyphens',
    );
  }
  return parsed.data;
}

/** Same request, same hash: the type and the target, never the key itself. */
function requestHash(type: string, targetId: string): string {
  return createHash('sha256').update(JSON.stringify({ type, targetId })).digest('hex');
}

export interface CreateJobResult {
  readonly job: Job;
  /** True for a new job (HTTP 202); false for a replay of an earlier request (HTTP 200). */
  readonly created: boolean;
}

/** What a job type decides itself; everything else about creating a job is shared. */
interface JobSpec {
  readonly type: 'generate_brief' | 'regenerate_section' | 'export_package';
  /** Identifies the request: the type plus its target, never the key itself. */
  readonly hashTarget: string;
  /** Runs inside the creation transaction, after the replay check; throws to refuse the job. */
  readonly prepare: (tx: DbOrTx) => Promise<{
    readonly input: Record<string, unknown>;
    readonly campaignId: string | null;
    readonly draftId: string | null;
    readonly audit: Record<string, unknown>;
  }>;
}

async function createJob(
  db: Db,
  queue: JobQueue,
  log: JobLog,
  ctx: RequestContext,
  spec: JobSpec,
  idempotencyKeyHeader: string | string[] | undefined,
): Promise<CreateJobResult> {
  assertCanWrite(ctx);
  const idempotencyKey = parseIdempotencyKey(idempotencyKeyHeader);
  const hash = requestHash(spec.type, spec.hashTarget);

  const outcome = await db.transaction(async (tx) => {
    // One job creation at a time per workspace: the replay check, the cap and the insert below
    // cannot interleave with another request, so neither a duplicate nor an extra job can appear.
    await lockWorkspace(tx, ctx);

    const existing = await findJobByKey(tx, ctx, idempotencyKey);
    if (existing !== null) {
      if (existing.requestHash !== hash) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'This Idempotency-Key was already used for a different request.',
        );
      }
      return { row: existing, created: false };
    }

    const prepared = await spec.prepare(tx);
    if ((await countActiveJobs(tx, ctx)) >= MAX_ACTIVE_JOBS_PER_WORKSPACE) {
      throw new AppError('RATE_LIMITED', 'Too many jobs are running. Wait for one to finish.');
    }

    const row = await insertJob(tx, ctx, {
      type: spec.type,
      input: prepared.input,
      idempotencyKey,
      requestHash: hash,
      campaignId: prepared.campaignId,
      draftId: prepared.draftId,
    });
    await recordAuditEvent(tx, ctx, {
      action: 'job.create',
      resourceType: 'job',
      resourceId: row.id,
      metadata: { type: spec.type, ...prepared.audit },
    });
    return { row, created: true };
  });

  if (outcome.created) {
    // After the commit. If the hand-off fails the job stays queued and the reconciler picks it up.
    try {
      await queue.enqueue(outcome.row.id, { attempt: 1 });
    } catch (error) {
      log.warn(
        { event: 'job.enqueue_failed', jobId: outcome.row.id, error: errorName(error) },
        'could not hand the job to the queue; the reconciler will pick it up',
      );
    }
  }
  return { job: toJob(outcome.row), created: outcome.created };
}

export function createGenerateBriefJob(
  db: Db,
  queue: JobQueue,
  log: JobLog,
  ctx: RequestContext,
  body: GenerateBriefJobRequest,
  idempotencyKeyHeader: string | string[] | undefined,
): Promise<CreateJobResult> {
  const campaignId = body.campaignId.toLowerCase();
  return createJob(
    db,
    queue,
    log,
    ctx,
    {
      type: 'generate_brief',
      hashTarget: campaignId,
      prepare: async (tx) => {
        const campaign = await findCampaign(tx, ctx, campaignId);
        if (campaign === null) throw invalid('campaignId', 'Campaign not found');
        if (campaign.status === 'archived') {
          throw new AppError('CONFLICT', 'Archived campaigns cannot be generated.');
        }
        return {
          // A snapshot of the campaign's settings, so later edits cannot change a queued job.
          input: {
            campaignId: campaign.id,
            productId: campaign.productId,
            templateId: campaign.templateId,
            templateVersion: campaign.templateVersion,
            language: campaign.language,
            tone: campaign.tone,
            platform: campaign.platform,
            durationSeconds: campaign.durationSeconds,
            variants: campaign.variants,
          },
          campaignId: campaign.id,
          draftId: null,
          audit: { campaignId: campaign.id },
        };
      },
    },
    idempotencyKeyHeader,
  );
}

/**
 * Starts regenerating one section of a draft (D-050, D-058). `expectedRev` is the revision of
 * that section the client was looking at. It is checked here for a fast answer and again by the
 * worker when it stores the result, so an edit made in between always wins.
 */
export function createRegenerateSectionJob(
  db: Db,
  queue: JobQueue,
  log: JobLog,
  ctx: RequestContext,
  body: RegenerateSectionJobRequest,
  idempotencyKeyHeader: string | string[] | undefined,
): Promise<CreateJobResult> {
  const draftId = body.draftId.toLowerCase();
  return createJob(
    db,
    queue,
    log,
    ctx,
    {
      type: 'regenerate_section',
      hashTarget: `${draftId}:${body.section}:${body.expectedRev}`,
      prepare: async (tx) => {
        const draft = await findDraft(tx, ctx, draftId);
        if (draft === null) throw invalid('draftId', 'Draft not found');
        const content = readDraftContent(draft);
        if (content === null)
          throw new Error(`Draft ${draft.id} does not match the content contract`);
        if (content.sectionState[body.section]?.rev !== body.expectedRev) {
          throw new AppError(
            'CONFLICT',
            'This section was changed since you loaded it. Reload the draft and try again.',
          );
        }
        const campaign = await findCampaign(tx, ctx, draft.campaignId);
        if (campaign === null) throw new Error(`Campaign of draft ${draft.id} is missing`);
        if (campaign.status === 'archived') {
          throw new AppError('CONFLICT', 'Archived campaigns cannot be generated.');
        }
        return {
          // A snapshot of the campaign's settings, as for generate_brief.
          input: {
            draftId: draft.id,
            campaignId: campaign.id,
            section: body.section,
            expectedRev: body.expectedRev,
            templateId: campaign.templateId,
            templateVersion: campaign.templateVersion,
            language: campaign.language,
            tone: campaign.tone,
            platform: campaign.platform,
            durationSeconds: campaign.durationSeconds,
            variantIndex: draft.variantIndex,
          },
          campaignId: null,
          draftId: draft.id,
          audit: { draftId: draft.id, section: body.section },
        };
      },
    },
    idempotencyKeyHeader,
  );
}

/**
 * Starts building the export package of a draft (D-067). The job carries a snapshot of the text and
 * of the attached files (with their hashes), so a retry builds the same package and a later edit
 * cannot race it. `draftVersion` is the version the user is looking at: a newer one is refused.
 */
export function createExportPackageJob(
  db: Db,
  queue: JobQueue,
  log: JobLog,
  ctx: RequestContext,
  body: CreateExportRequest,
  idempotencyKeyHeader: string | string[] | undefined,
): Promise<CreateJobResult> {
  const draftId = body.draftId.toLowerCase();
  return createJob(
    db,
    queue,
    log,
    ctx,
    {
      type: 'export_package',
      hashTarget: `${draftId}:${body.draftVersion}`,
      prepare: async (tx) => {
        const draft = await findDraft(tx, ctx, draftId);
        if (draft === null) throw invalid('draftId', 'Draft not found');
        if (draft.version !== body.draftVersion) {
          throw new AppError(
            'CONFLICT',
            'This draft was changed since you loaded it. Reload the draft and try again.',
          );
        }
        const content = readDraftContent(draft);
        if (content === null)
          throw new Error(`Draft ${draft.id} does not match the content contract`);
        const linked = await listLinked(tx, ctx.workspaceId, draft.id);
        const total = linked.reduce((sum, item) => sum + item.asset.sizeBytes, 0);
        if (linked.length > EXPORT_LIMITS.maxMediaFiles || total > EXPORT_LIMITS.maxPackageBytes) {
          throw new AppError(
            'CONFLICT',
            'The attached files are too large to export. Remove some and try again.',
          );
        }
        if ((await countLiveExports(tx, ctx)) >= EXPORT_LIMITS.maxLivePerWorkspace) {
          throw new AppError(
            'RATE_LIMITED',
            'This workspace has too many packages. Wait for older ones to expire.',
          );
        }
        const snapshot: ExportInput = {
          draftId: draft.id,
          draftVersion: draft.version,
          status:
            draft.status === 'approved' || draft.status === 'in_review' ? draft.status : 'draft',
          needsReview: draft.needsReview,
          claimWarningCount: content.claimWarnings.length,
          sections: content.sections,
          media: linked.map(({ link, asset }) => ({
            assetId: asset.id,
            role: link.role === 'cover' ? 'cover' : 'media',
            scene: SCENE_VALUES.find((scene) => scene === link.scene) ?? null,
            aiGenerated: link.aiGenerated,
            generator: link.generator,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
          })),
        };
        return {
          input: snapshot as unknown as Record<string, unknown>,
          campaignId: null,
          draftId: draft.id,
          // Counts only: never text, names or URLs.
          audit: { draftId: draft.id, draftVersion: draft.version, files: linked.length },
        };
      },
    },
    idempotencyKeyHeader,
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

export async function getJob(db: Db, ctx: RequestContext, jobId: string): Promise<Job> {
  const row = await findJob(db, ctx, jobId);
  if (row === null) throw notFound();
  return toJob(row);
}

export async function listJobs(
  db: Db,
  ctx: RequestContext,
  query: JobListQueryParsed,
): Promise<JobListResponse> {
  const rows = await listJobRows(db, ctx, {
    status: query.status,
    type: query.type,
    campaignId: query.campaignId,
    draftId: query.draftId,
    limit: query.limit + 1,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toJob),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  };
}

/**
 * Cancels a job. A queued job is cancelled at once; a running job is flagged and its worker stops
 * it between steps; cancelling a cancelled job changes nothing; a finished job cannot be cancelled.
 */
export async function cancelJob(db: Db, ctx: RequestContext, jobId: string): Promise<Job> {
  assertCanWrite(ctx);
  const row = await db.transaction(async (tx) => {
    const current = await findJob(tx, ctx, jobId, { forUpdate: true });
    if (current === null) throw notFound();

    let next: JobRow | null;
    if (current.status === 'queued' && canTransition('queued', 'cancelled')) {
      next = await cancelQueuedJob(tx, ctx, current.id);
    } else if (current.status === 'running') {
      next = await requestCancelRunningJob(tx, ctx, current.id);
    } else if (current.status === 'cancelled') {
      return current;
    } else {
      throw new AppError('CONFLICT', 'This job has already finished.');
    }
    if (next === null) throw new AppError('CONFLICT', 'This job has already finished.');
    await recordAuditEvent(tx, ctx, {
      action: 'job.cancel',
      resourceType: 'job',
      resourceId: next.id,
      metadata: { was: current.status },
    });
    return next;
  });
  return toJob(row);
}
