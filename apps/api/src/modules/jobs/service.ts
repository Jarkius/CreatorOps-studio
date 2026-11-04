import { createHash } from 'node:crypto';

import {
  IdempotencyKeySchema,
  JOB_ERROR_CODES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  type GenerateBriefJobRequest,
  type Job,
  type JobListQueryParsed,
  type JobListResponse,
} from '@creatorops/contracts';

import type { Db } from '../../db/client.js';
import { decodeCursor, encodeCursor } from '../../platform/cursor.js';
import { AppError } from '../../platform/errors.js';
import { recordAuditEvent } from '../audit/repo.js';
import { findCampaign } from '../campaigns/repo.js';
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

export async function createGenerateBriefJob(
  db: Db,
  queue: JobQueue,
  log: JobLog,
  ctx: RequestContext,
  body: GenerateBriefJobRequest,
  idempotencyKeyHeader: string | string[] | undefined,
): Promise<CreateJobResult> {
  assertCanWrite(ctx);
  const idempotencyKey = parseIdempotencyKey(idempotencyKeyHeader);
  const campaignId = body.campaignId.toLowerCase();
  const hash = requestHash('generate_brief', campaignId);

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

    const campaign = await findCampaign(tx, ctx, campaignId);
    if (campaign === null) throw invalid('campaignId', 'Campaign not found');
    if (campaign.status === 'archived') {
      throw new AppError('CONFLICT', 'Archived campaigns cannot be generated.');
    }
    if ((await countActiveJobs(tx, ctx)) >= MAX_ACTIVE_JOBS_PER_WORKSPACE) {
      throw new AppError('RATE_LIMITED', 'Too many jobs are running. Wait for one to finish.');
    }

    const row = await insertJob(tx, ctx, {
      type: 'generate_brief',
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
      idempotencyKey,
      requestHash: hash,
      campaignId: campaign.id,
      draftId: null,
    });
    await recordAuditEvent(tx, ctx, {
      action: 'job.create',
      resourceType: 'job',
      resourceId: row.id,
      metadata: { type: 'generate_brief', campaignId: campaign.id },
    });
    return { row, created: true };
  });

  if (outcome.created) {
    // After the commit. If the hand-off fails the job stays queued and the reconciler picks it up.
    try {
      await queue.enqueue(outcome.row.id);
    } catch (error) {
      log.warn(
        { event: 'job.enqueue_failed', jobId: outcome.row.id, error: errorName(error) },
        'could not hand the job to the queue; the reconciler will pick it up',
      );
    }
  }
  return { job: toJob(outcome.row), created: outcome.created };
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
