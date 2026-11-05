import {
  estimateCostUsd,
  isProviderError,
  ProviderError,
  type GenerateBriefRequest,
  type ModelPricing,
  type ProviderCallOptions,
  type ProviderUsage,
  type RegenerateSectionRequest,
  type TextProvider,
  type VideoPromptRequest,
  type VideoPromptScene,
} from '@creatorops/provider-core';
import type { DraftSections, SectionName, SectionValue } from '@creatorops/provider-core';

import type { Db } from '../../db/client.js';
import { reserveCall, settleCall, type Settlement } from './ledger.js';

export interface MeterContext {
  readonly db: Db;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly model: string;
  readonly pricing: ModelPricing | null;
  /** The monthly limit in USD, or null. */
  readonly capUsd: number | null;
  /** The adapter's output limit: the worst case for the reply. */
  readonly maxOutputTokens: number;
  /** Replaceable so tests can see a failed settlement. */
  readonly log?: { warn(object: Record<string, unknown>, message: string): void };
}

/** Thai can use more than one token per character, so the input estimate is deliberately high. */
const TOKENS_PER_CHARACTER = 1.5;

/** A reported cost this much over the predicted one is flagged (and shown on the usage screen). */
export const ANOMALY_RATIO = 1.25;
const ANOMALY_FLOOR_USD = 0.0005;

/** Errors after which the provider may still have billed the call: keep the worst case. */
const MAY_HAVE_BILLED = new Set([
  'TIMEOUT',
  'INVALID_OUTPUT',
  'OUTPUT_TRUNCATED',
  'CONTENT_REFUSED',
]);

export function worstCaseUsd(
  requestChars: number,
  maxOutputTokens: number,
  pricing: ModelPricing | null,
): number {
  if (pricing === null) return 0;
  return estimateCostUsd(
    { inputUnits: Math.ceil(requestChars * TOKENS_PER_CHARACTER), outputUnits: maxOutputTokens },
    pricing,
  );
}

export function settlementFor(usage: ProviderUsage, pricing: ModelPricing | null): Settlement {
  const computed = pricing === null ? null : estimateCostUsd(usage, pricing);
  const reported = usage.costUsd ?? null;
  const costUsd = reported ?? computed ?? 0;
  const anomaly =
    reported !== null &&
    computed !== null &&
    reported > computed * ANOMALY_RATIO + ANOMALY_FLOOR_USD;
  return {
    status: 'settled',
    requests: usage.requests ?? 1,
    inputUnits: usage.inputUnits,
    outputUnits: usage.outputUnits,
    costUsd,
    costSource: reported !== null ? 'reported' : computed !== null ? 'computed' : null,
    anomaly,
  };
}

/**
 * Wraps a real provider so every call is recorded in the usage ledger (D-077): the worst case is
 * set aside under the workspace lock before the call (and the call is refused with
 * BUDGET_EXCEEDED when it would pass the monthly limit), and the real cost is written after.
 * A settlement that fails to write leaves the call reserved at its worst case, so the limit
 * fails closed.
 */
export class MeteredTextProvider implements TextProvider {
  readonly id: string;
  private calls = 0;

  constructor(
    private readonly inner: TextProvider,
    private readonly meter: MeterContext,
  ) {
    this.id = inner.id;
  }

  private async metered<T extends { usage: ProviderUsage }>(
    requestChars: number,
    run: () => Promise<T>,
  ): Promise<T> {
    const { meter } = this;
    const callIndex = (this.calls += 1);
    const reservedUsd = worstCaseUsd(requestChars, meter.maxOutputTokens, meter.pricing);
    const reserved = await reserveCall(meter.db, {
      workspaceId: meter.workspaceId,
      jobId: meter.jobId,
      attempt: meter.attempt,
      callIndex,
      provider: this.inner.id,
      model: meter.model,
      reservedUsd,
      capUsd: meter.capUsd,
    });
    if (!reserved.ok) {
      // Over the limit: stop here and make no call. A duplicate means this attempt already ran.
      throw new ProviderError(
        reserved.reason === 'over_cap' ? 'BUDGET_EXCEEDED' : 'INVALID_REQUEST',
      );
    }
    const settle = async (settlement: Settlement): Promise<void> => {
      try {
        await settleCall(meter.db, reserved.eventId, settlement);
      } catch (error) {
        meter.log?.warn(
          {
            event: 'usage.settle_failed',
            jobId: meter.jobId,
            error: error instanceof Error ? error.name : 'Error',
          },
          'could not record usage; the call stays reserved at its worst case',
        );
      }
    };
    let result: T;
    try {
      result = await run();
    } catch (error) {
      const billed = isProviderError(error) && MAY_HAVE_BILLED.has(error.code);
      await settle({
        status: billed ? 'settled' : 'released',
        requests: billed ? 1 : 0,
        inputUnits: 0,
        outputUnits: 0,
        costUsd: billed ? reservedUsd : 0,
        costSource: billed ? 'reserved' : null,
        anomaly: false,
      });
      throw error;
    }
    await settle(settlementFor(result.usage, meter.pricing));
    return result;
  }

  generateBrief(
    req: GenerateBriefRequest,
    opts?: ProviderCallOptions,
  ): Promise<{ output: DraftSections; usage: ProviderUsage; model: string }> {
    return this.metered(JSON.stringify(req).length, () => this.inner.generateBrief(req, opts));
  }

  generateVideoPrompts(
    req: VideoPromptRequest,
    opts?: ProviderCallOptions,
  ): Promise<{ scenes: VideoPromptScene[]; usage: ProviderUsage; model: string }> {
    return this.metered(JSON.stringify(req).length, () =>
      this.inner.generateVideoPrompts(req, opts),
    );
  }

  regenerateSection(
    req: RegenerateSectionRequest,
    opts?: ProviderCallOptions,
  ): Promise<{ section: SectionName; value: SectionValue; usage: ProviderUsage; model: string }> {
    return this.metered(JSON.stringify(req).length, () => this.inner.regenerateSection(req, opts));
  }
}
