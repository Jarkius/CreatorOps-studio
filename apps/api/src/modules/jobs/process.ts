import {
  isProviderError,
  ProviderError,
  SECTION_NAMES,
  type TextProvider,
} from '@creatorops/provider-core';

import type { Db } from '../../db/client.js';
import { contentDrafts } from '../../db/schema.js';
import { generateBrief, PermanentJobFailure, type GenerationResult } from './generate-brief.js';
import type { JobQueue } from './queue.js';
import { decideRetry } from './retry.js';
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
  /** The longest one provider call may take. */
  readonly providerTimeoutMs: number;
}

export const DEFAULT_WORKER_SETTINGS: WorkerSettings = {
  leaseSeconds: 60,
  heartbeatMs: 20_000,
  providerTimeoutMs: 30_000,
};

export interface WorkerDeps {
  readonly db: Db;
  readonly provider: TextProvider;
  readonly queue: JobQueue;
  readonly log: WorkerLog;
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

async function run(
  deps: WorkerDeps,
  job: JobRow,
  attempt: number,
  controller: AbortController,
  settings: WorkerSettings,
): Promise<ProcessOutcome> {
  const timeout = AbortSignal.timeout(settings.providerTimeoutMs);
  const signal = AbortSignal.any([controller.signal, timeout]);

  let result: GenerationResult;
  try {
    if (job.type !== 'generate_brief') {
      // regenerate_section arrives with S3.6; until then nothing creates one.
      throw new PermanentJobFailure('INTERNAL', 'This job type is not supported yet.');
    }
    result = await generateBrief(deps.db, deps.provider, job, signal);
  } catch (error) {
    if (controller.signal.aborted) {
      return controller.signal.reason === 'lease' ? 'lost' : settleCancelled(deps, job, attempt);
    }
    const failure =
      timeout.aborted && !isProviderError(error) ? new ProviderError('TIMEOUT') : error;
    return settleFailure(deps, job, attempt, failure);
  }
  return settleSuccess(deps, job, attempt, result);
}

async function settleSuccess(
  deps: WorkerDeps,
  job: JobRow,
  attempt: number,
  result: GenerationResult,
): Promise<ProcessOutcome> {
  return deps.db.transaction(async (tx) => {
    const owned = await lockOwnedJob(tx, job.id, attempt);
    if (owned === null) return 'lost';
    // A cancel request that arrived while the provider was busy wins: nothing is stored.
    if (owned.cancelRequestedAt !== null) {
      await markCancelled(tx, job.id);
      return 'cancelled';
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
