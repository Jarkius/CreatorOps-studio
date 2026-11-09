import { EXPORT_LIMITS } from '@creatorops/contracts';
import { sql } from 'drizzle-orm';
import {
  isProviderError,
  ProviderError,
  SECTION_NAMES,
  type TextProvider,
} from '@creatorops/provider-core';

import type { Db, DbOrTx } from '../../db/client.js';
import { assets, contentDrafts, draftExports } from '../../db/schema.js';
import type { Storage } from '../../storage/storage.js';
import { listLinked, replaceLinks } from '../draft-assets/repo.js';
import { findDraftIn, updateDraftRow } from '../drafts/repo.js';
import type { VideoTools } from '../video/ffmpeg.js';
import { ASSEMBLED_GENERATOR, buildAssembledVideo, type AssembleResult } from './assemble-video.js';
import { applySectionChanges, readDraftContent } from '../drafts/state.js';
import { buildExport, type ExportResult } from './export-package.js';
import { generateBrief, PermanentJobFailure, type GenerationResult } from './generate-brief.js';
import { generateVideoPrompts, type VideoPromptsResult } from './generate-video-prompts.js';
import { regenerateSection, type RegenerationResult } from './regenerate-section.js';
import type { JobQueue } from './queue.js';
import { decideRetry, FAILURE_MESSAGES } from './retry.js';
import type { JobRow } from './repo.js';
import {
  claimJob,
  heartbeat,
  lockOwnedJob,
  markCancelled,
  markFailed,
  markRequeued,
  markSucceeded,
} from './worker-repo.js';

/** The part of a logger the worker needs. Callers never pass product text or secrets in it. */
export interface WorkerLog {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

export interface WorkerSettings {
  /** How long a claim lasts without a heartbeat. */
  readonly leaseSeconds: number;
  /** How often a running job renews its lease and looks for a cancel request. */
  readonly heartbeatMs: number;
  /** The longest one provider call may take; a job that makes several calls gets that per call. */
  readonly providerTimeoutMs: number;
  /** The longest the final-video job may take (re-encoding a 1080x1920 video takes minutes). */
  readonly videoTimeoutMs: number;
}

export const DEFAULT_WORKER_SETTINGS: WorkerSettings = {
  leaseSeconds: 60,
  heartbeatMs: 20_000,
  // One generate job may make up to three sequential real calls, so the whole-job limit is longer
  // than one call is expected to take. The lease is renewed by the heartbeat meanwhile.
  providerTimeoutMs: 90_000,
  videoTimeoutMs: 10 * 60_000,
};

export interface WorkerDeps {
  readonly db: Db;
  readonly provider: TextProvider;
  /**
   * Picks the provider for one job from its workspace (a saved real provider, metered), and falls
   * back to `provider`. Without it every job uses `provider`.
   */
  readonly resolveProvider?: (
    job: { id: string; workspaceId: string },
    attempt: number,
  ) => Promise<TextProvider>;
  readonly queue: JobQueue;
  readonly log: WorkerLog;
  /** Where export packages are written. Without it an export job fails with a plain message. */
  readonly storage?: Storage;
  /** The owner's ffmpeg and ffprobe for the final video (D-086). */
  readonly videoTools?: VideoTools;
  readonly settings?: Partial<WorkerSettings>;
  /** Replaceable so tests can make the retry delay exact. */
  readonly random?: () => number;
}

/**
 * What happened to the job in this call.
 * - `skipped`: it was not claimable (a duplicate message, not due yet, already taken or finished)
 * - `lost`: this worker's lease was taken over, so it wrote nothing
 */
export type ProcessOutcome = 'succeeded' | 'failed' | 'retried' | 'cancelled' | 'skipped' | 'lost';

type AbortReason = 'cancel' | 'lease';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

/**
 * Runs one job (D-045, D-048). Safe to call twice for the same job at once: only one call can
 * claim it. Expected failures end up in the job row; this function throws only when the database
 * itself fails, and then the lease runs out and the reconciler takes over.
 */
export async function processJob(deps: WorkerDeps, jobId: string): Promise<ProcessOutcome> {
  const settings = { ...DEFAULT_WORKER_SETTINGS, ...deps.settings };
  const job = await claimJob(deps.db, jobId, settings.leaseSeconds);
  if (job === null) return 'skipped';

  const attempt = job.attempts;
  const started = Date.now();
  const logFields = { jobId: job.id, workspaceId: job.workspaceId, type: job.type, attempt };
  deps.log.info({ event: 'job.started', ...logFields }, 'job started');

  const controller = new AbortController();
  let beating = false;
  const beat = async (): Promise<void> => {
    if (beating) return;
    beating = true;
    try {
      const result = await heartbeat(deps.db, job.id, attempt, settings.leaseSeconds);
      if (!result.owned) controller.abort('lease' satisfies AbortReason);
      else if (result.cancelRequested) controller.abort('cancel' satisfies AbortReason);
    } catch (error) {
      // The lease simply lapses if the database stays unreachable; the reconciler handles that.
      deps.log.warn(
        { event: 'job.heartbeat_failed', ...logFields, error: errorName(error) },
        'could not renew the lease',
      );
    } finally {
      beating = false;
    }
  };
  const timer = setInterval(() => void beat(), settings.heartbeatMs);

  try {
    const outcome = await run(deps, job, attempt, controller, settings);
    deps.log.info(
      { event: 'job.finished', ...logFields, outcome, durationMs: Date.now() - started },
      'job finished',
    );
    return outcome;
  } finally {
    clearInterval(timer);
  }
}

/**
 * The whole-job time limit: one provider call's limit for each call the job makes in a row. A
 * generate job builds `variants` drafts one after another (up to three), so a single 90 s budget
 * would fail a healthy slow provider on the last variant and then charge for the retry.
 */
export function jobTimeoutMs(job: { type: string; input: unknown }, settings: WorkerSettings) {
  if (job.type === 'assemble_video') return settings.videoTimeoutMs;
  if (job.type !== 'generate_brief') return settings.providerTimeoutMs;
  const variants = (job.input as { variants?: unknown } | null)?.variants;
  const calls = typeof variants === 'number' && Number.isInteger(variants) ? variants : 3;
  return settings.providerTimeoutMs * Math.min(Math.max(calls, 1), 3);
}

function providerFor(deps: WorkerDeps, job: JobRow, attempt: number): Promise<TextProvider> {
  return deps.resolveProvider === undefined
    ? Promise.resolve(deps.provider)
    : deps.resolveProvider(job, attempt);
}

async function run(
  deps: WorkerDeps,
  job: JobRow,
  attempt: number,
  controller: AbortController,
  settings: WorkerSettings,
): Promise<ProcessOutcome> {
  const timeout = AbortSignal.timeout(jobTimeoutMs(job, settings));
  const signal = AbortSignal.any([controller.signal, timeout]);

  let result: JobResult;
  try {
    if (job.type === 'generate_brief') {
      result = {
        kind: 'generate_brief',
        ...(await generateBrief(deps.db, await providerFor(deps, job, attempt), job, signal)),
      };
    } else if (job.type === 'regenerate_section') {
      result = {
        kind: 'regenerate_section',
        ...(await regenerateSection(deps.db, await providerFor(deps, job, attempt), job, signal)),
      };
    } else if (job.type === 'generate_video_prompts') {
      result = {
        kind: 'generate_video_prompts',
        ...(await generateVideoPrompts(
          deps.db,
          await providerFor(deps, job, attempt),
          job,
          signal,
        )),
      };
    } else if (job.type === 'export_package') {
      if (deps.storage === undefined) {
        throw new PermanentJobFailure('INTERNAL', 'This job type is not supported.');
      }
      result = {
        kind: 'export_package',
        ...(await buildExport(deps.db, deps.storage, job, signal)),
      };
    } else if (job.type === 'assemble_video') {
      if (deps.storage === undefined || deps.videoTools === undefined) {
        throw new PermanentJobFailure('INTERNAL', 'This job type is not supported.');
      }
      result = {
        kind: 'assemble_video',
        ...(await buildAssembledVideo(
          deps.db,
          { storage: deps.storage, tools: deps.videoTools, log: deps.log },
          job,
          signal,
        )),
      };
    } else {
      throw new PermanentJobFailure('INTERNAL', 'This job type is not supported.');
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return controller.signal.reason === 'lease' ? 'lost' : settleCancelled(deps, job, attempt);
    }
    // A final video that runs out of time would run out again: fail it for good, plainly.
    const failure =
      timeout.aborted && !isProviderError(error)
        ? job.type === 'assemble_video'
          ? new PermanentJobFailure(
              'VIDEO_FAILED',
              'Making the final video took too long. Try fewer or shorter scene videos, then try again.',
            )
          : new ProviderError('TIMEOUT')
        : error;
    return settleFailure(deps, job, attempt, failure);
  }
  const outcome = await settleSuccess(deps, job, attempt, result);
  if (
    (result.kind === 'export_package' || result.kind === 'assemble_video') &&
    outcome !== 'succeeded' &&
    deps.storage !== undefined
  ) {
    // The job was cancelled, taken over or refused at settlement, so no row points at the file.
    await deps.storage.delete(result.storageKey).catch(() => undefined);
  }
  return outcome;
}

type JobResult =
  | ({ readonly kind: 'generate_brief' } & GenerationResult)
  | ({ readonly kind: 'regenerate_section' } & RegenerationResult)
  | ({ readonly kind: 'generate_video_prompts' } & VideoPromptsResult)
  | ({ readonly kind: 'export_package' } & ExportResult)
  | ({ readonly kind: 'assemble_video' } & AssembleResult);

async function settleSuccess(
  deps: WorkerDeps,
  job: JobRow,
  attempt: number,
  result: JobResult,
): Promise<ProcessOutcome> {
  return deps.db.transaction(async (tx) => {
    const owned = await lockOwnedJob(tx, job.id, attempt);
    if (owned === null) return 'lost';
    // A cancel request that arrived while the provider was busy wins: nothing is stored.
    if (owned.cancelRequestedAt !== null) {
      await markCancelled(tx, job.id);
      return 'cancelled';
    }
    if (result.kind === 'regenerate_section') {
      return settleRegeneration(tx, job, result);
    }
    if (result.kind === 'export_package') {
      return settleExport(tx, job, result);
    }
    if (result.kind === 'assemble_video') {
      return settleAssembly(tx, job, result);
    }
    if (result.kind === 'generate_video_prompts') {
      await markSucceeded(tx, job.id, {
        output: {
          draftId: result.draftId,
          draftVersion: result.draftVersion,
          model: result.model,
          scenes: result.scenes.map((scene) => ({ ...scene })),
        },
        provider: result.provider,
      });
      return 'succeeded';
    }
    const rows = await tx
      .insert(contentDrafts)
      .values(
        result.variants.map((variant) => ({
          workspaceId: job.workspaceId,
          campaignId: result.campaignId,
          productId: result.productId,
          variantIndex: variant.variantIndex,
          sections: variant.sections,
          // Every section starts at revision 1, generated by this job (D-050).
          sectionState: Object.fromEntries(
            SECTION_NAMES.map((name) => [name, { rev: 1, origin: 'generated', jobId: job.id }]),
          ),
          claimWarnings: variant.claimWarnings,
          needsReview: variant.needsReview,
        })),
      )
      .returning({ id: contentDrafts.id });
    await markSucceeded(tx, job.id, {
      output: { draftIds: rows.map((row) => row.id), model: result.model },
      provider: result.provider,
    });
    return 'succeeded';
  });
}

/**
 * Stores a regenerated section (D-050). The draft row is locked first, so a manual edit and this
 * job cannot interleave: if the section's revision is no longer the one the job was created for,
 * the job fails with SECTION_CHANGED and the draft is left exactly as the edit made it.
 */
async function settleRegeneration(
  tx: DbOrTx,
  job: JobRow,
  result: RegenerationResult,
): Promise<ProcessOutcome> {
  const draft = await findDraftIn(tx, job.workspaceId, result.draftId, { forUpdate: true });
  const content = draft === null ? null : readDraftContent(draft);
  if (draft === null || content === null) {
    await markFailed(tx, job.id, {
      code: 'INTERNAL',
      message: 'The draft is no longer available.',
    });
    return 'failed';
  }
  if (content.sectionState[result.section]?.rev !== result.expectedRev) {
    await markFailed(tx, job.id, {
      code: 'SECTION_CHANGED',
      message: FAILURE_MESSAGES.SECTION_CHANGED,
    });
    return 'failed';
  }
  const next = applySectionChanges(
    content,
    { [result.section]: result.value },
    { origin: 'generated', jobId: job.id },
    result.facts,
  );
  // A value equal to the old one changes nothing: the job still succeeds, the revision stays.
  const updated =
    next.changed.length === 0
      ? draft
      : await updateDraftRow(tx, job.workspaceId, draft.id, draft.version, {
          sections: next.sections,
          sectionState: next.sectionState,
          claimWarnings: next.claimWarnings,
          needsReview: next.needsReview,
          status: 'draft',
        });
  if (updated === null) throw new Error('Draft update lost its row lock');
  await markSucceeded(tx, job.id, {
    output: {
      draftId: draft.id,
      section: result.section,
      rev: next.sectionState[result.section]?.rev ?? result.expectedRev,
      changed: next.changed.length > 0,
      model: result.model,
    },
    provider: result.provider,
  });
  return 'succeeded';
}

/**
 * Records a finished package (D-067 item 4). The row and the job's success are one transaction, so
 * a row always has a finished job. The expiry uses the database clock.
 */
async function settleExport(
  tx: DbOrTx,
  job: JobRow,
  result: ExportResult,
): Promise<ProcessOutcome> {
  const rows = await tx
    .insert(draftExports)
    .values({
      workspaceId: job.workspaceId,
      draftId: result.draftId,
      jobId: job.id,
      createdBy: result.createdBy,
      draftVersion: result.draftVersion,
      fileCount: result.fileCount,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      filename: result.filename,
      storageKey: result.storageKey,
      manifest: result.manifest,
      expiresAt: sql`date_trunc('milliseconds', now()) + make_interval(days => ${EXPORT_LIMITS.ttlDays})`,
    })
    .returning({ id: draftExports.id });
  const row = rows[0];
  if (row === undefined) throw new Error('Export row was not written');
  await markSucceeded(tx, job.id, {
    output: {
      exportId: row.id,
      draftId: result.draftId,
      fileCount: result.fileCount,
      sizeBytes: result.sizeBytes,
    },
    provider: 'export',
  });
  return 'succeeded';
}

/**
 * Records the final video (D-086): the asset row and its place on the draft are written with the
 * job's success in one transaction, under the draft's row lock (the same lock the attachments
 * route takes). The previous final video leaves the draft (it stays in the library); the new one
 * goes last. A draft that is full or gone fails the job and the caller deletes the file.
 */
async function settleAssembly(
  tx: DbOrTx,
  job: JobRow,
  result: AssembleResult,
): Promise<ProcessOutcome> {
  const draft = await findDraftIn(tx, job.workspaceId, result.draftId, { forUpdate: true });
  if (draft === null) {
    await markFailed(tx, job.id, {
      code: 'INTERNAL',
      message: 'The draft is no longer available.',
    });
    return 'failed';
  }
  const linked = await listLinked(tx, job.workspaceId, draft.id);
  const kept = linked.filter(
    (item) =>
      !(
        item.link.generator === ASSEMBLED_GENERATOR &&
        item.link.scene === null &&
        item.asset.type === 'video'
      ),
  );
  if (kept.length + 1 > EXPORT_LIMITS.maxAssetsPerDraft) {
    await markFailed(tx, job.id, {
      code: 'VIDEO_FAILED',
      message: `The draft already holds ${EXPORT_LIMITS.maxAssetsPerDraft} files. Remove one, then try again.`,
    });
    return 'failed';
  }
  await tx.insert(assets).values({
    id: result.assetId,
    workspaceId: job.workspaceId,
    productId: draft.productId,
    type: 'video',
    status: 'ready',
    mimeType: 'video/mp4',
    sizeBytes: result.sizeBytes,
    width: 1080,
    height: 1920,
    durationMs: result.durationMs,
    originalFilename: `final-video-${draft.id.slice(0, 8)}.mp4`,
    sha256: result.sha256,
    storageKey: result.storageKey,
    source: 'generated',
    createdBy: job.createdBy,
  });
  await replaceLinks(tx, job.workspaceId, draft.id, [
    ...kept.map((item, index) => ({ ...item.link, sortOrder: index })),
    {
      workspaceId: job.workspaceId,
      draftId: draft.id,
      assetId: result.assetId,
      role: 'media',
      sortOrder: kept.length,
      scene: null,
      aiGenerated: true,
      generator: ASSEMBLED_GENERATOR,
      createdBy: job.createdBy,
    },
  ]);
  await markSucceeded(tx, job.id, {
    output: {
      draftId: draft.id,
      assetId: result.assetId,
      durationMs: result.durationMs,
      clipCount: result.clipCount,
      subtitles: result.subtitles,
      subtitleIssue: result.subtitleIssue,
      skippedScenes: [...result.skippedScenes],
      srt: result.srt,
    },
    provider: 'ffmpeg',
  });
  return 'succeeded';
}

async function settleCancelled(
  deps: WorkerDeps,
  job: JobRow,
  attempt: number,
): Promise<ProcessOutcome> {
  return deps.db.transaction(async (tx) => {
    if ((await lockOwnedJob(tx, job.id, attempt)) === null) return 'lost';
    await markCancelled(tx, job.id);
    return 'cancelled';
  });
}

async function settleFailure(
  deps: WorkerDeps,
  job: JobRow,
  attempt: number,
  error: unknown,
): Promise<ProcessOutcome> {
  const decision =
    error instanceof PermanentJobFailure
      ? ({ retry: false, code: error.code, message: error.message } as const)
      : decideRetry(error, attempt, {
          maxAttempts: job.maxAttempts,
          ...(deps.random === undefined ? {} : { random: deps.random }),
        });

  const outcome = await deps.db.transaction(async (tx): Promise<ProcessOutcome> => {
    const owned = await lockOwnedJob(tx, job.id, attempt);
    if (owned === null) return 'lost';
    if (owned.cancelRequestedAt !== null) {
      await markCancelled(tx, job.id);
      return 'cancelled';
    }
    if (decision.retry) {
      await markRequeued(tx, job.id, decision.delayMs);
      return 'retried';
    }
    await markFailed(tx, job.id, { code: decision.code, message: decision.message });
    return 'failed';
  });

  deps.log.warn(
    {
      event: 'job.attempt_failed',
      jobId: job.id,
      workspaceId: job.workspaceId,
      attempt,
      code: decision.code,
      retry: decision.retry,
      error: errorName(error),
    },
    'job attempt failed',
  );

  if (outcome === 'retried' && decision.retry) {
    try {
      await deps.queue.enqueue(job.id, { delayMs: decision.delayMs, attempt: attempt + 1 });
    } catch (queueError) {
      deps.log.warn(
        { event: 'job.enqueue_failed', jobId: job.id, error: errorName(queueError) },
        'could not hand the retry to the queue; the reconciler will pick it up',
      );
    }
  }
  return outcome;
}
