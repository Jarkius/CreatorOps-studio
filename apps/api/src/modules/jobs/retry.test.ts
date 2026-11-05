import { ProviderError, type ProviderErrorCode } from '@creatorops/provider-core';
import { describe, expect, it } from 'vitest';

import {
  BACKOFF_MS,
  decideRetry,
  FAILURE_MESSAGES,
  jobErrorCodeFor,
  MAX_JOB_ATTEMPTS,
} from './retry.js';

const none = () => 0;
const nearlyOne = () => 0.999999;

describe('decideRetry: transient provider errors', () => {
  it.each([
    ['TIMEOUT', 'PROVIDER_TIMEOUT'],
    ['UPSTREAM_5XX', 'PROVIDER_UNAVAILABLE'],
    ['RATE_LIMITED', 'PROVIDER_RATE_LIMITED'],
  ] as const)('retries %s with the stable code %s', (providerCode, jobCode) => {
    const decision = decideRetry(new ProviderError(providerCode), 1, { random: none });
    expect(decision).toEqual({ retry: true, delayMs: 2_000, code: jobCode });
  });

  it('waits 2 s after the first failure and 10 s after the second; the third is final', () => {
    const error = new ProviderError('TIMEOUT');
    const delays = [1, 2, 3].map((attempt) => {
      const decision = decideRetry(error, attempt, { random: none });
      return decision.retry ? decision.delayMs : null;
    });
    expect(delays).toEqual([BACKOFF_MS[0], BACKOFF_MS[1], null]);
    expect(BACKOFF_MS).toEqual([2_000, 10_000, 30_000]);
  });

  it('adds jitter of at most a quarter of the base wait', () => {
    const error = new ProviderError('UPSTREAM_5XX');
    const low = decideRetry(error, 1, { random: none });
    const high = decideRetry(error, 1, { random: nearlyOne });
    expect(low.retry && low.delayMs).toBe(2_000);
    expect(high.retry && high.delayMs).toBe(2_499);
    const later = decideRetry(error, 2, { random: nearlyOne });
    expect(later.retry && later.delayMs).toBe(12_499);
  });

  it('keeps the retry delay at or above what a rate limit asked for, capped at one minute', () => {
    const asked = decideRetry(new ProviderError('RATE_LIMITED', { retryAfterMs: 20_000 }), 1, {
      random: none,
    });
    expect(asked.retry && asked.delayMs).toBe(20_000);

    const huge = decideRetry(new ProviderError('RATE_LIMITED', { retryAfterMs: 3_600_000 }), 1, {
      random: none,
    });
    expect(huge.retry && huge.delayMs).toBe(60_000);

    const small = decideRetry(new ProviderError('RATE_LIMITED', { retryAfterMs: 10 }), 1, {
      random: none,
    });
    expect(small.retry && small.delayMs).toBe(2_000);
  });
});

describe('decideRetry: limits', () => {
  it('stops after three attempts', () => {
    const error = new ProviderError('TIMEOUT');
    expect(MAX_JOB_ATTEMPTS).toBe(3);
    expect(decideRetry(error, 2, { random: none }).retry).toBe(true);
    expect(decideRetry(error, 3, { random: none })).toEqual({
      retry: false,
      code: 'PROVIDER_TIMEOUT',
      message: FAILURE_MESSAGES.PROVIDER_TIMEOUT,
    });
  });

  it('honours a lower limit on the job row and ignores a higher one', () => {
    const error = new ProviderError('TIMEOUT');
    expect(decideRetry(error, 1, { maxAttempts: 1 }).retry).toBe(false);
    expect(decideRetry(error, 3, { maxAttempts: 5 }).retry).toBe(false);
  });
});

describe('decideRetry: permanent errors fail at once (D-048)', () => {
  it.each([
    ['INVALID_OUTPUT', 'INVALID_PROVIDER_OUTPUT'],
    ['CONTENT_REFUSED', 'CONTENT_REFUSED'],
    ['INVALID_REQUEST', 'INTERNAL'],
    ['AUTH_FAILED', 'PROVIDER_AUTH'],
    ['BUDGET_EXCEEDED', 'PROVIDER_BUDGET'],
    ['OUTPUT_TRUNCATED', 'INVALID_PROVIDER_OUTPUT'],
  ] as const satisfies readonly (readonly [ProviderErrorCode, string])[])(
    '%s on the first attempt is final and maps to %s',
    (providerCode, jobCode) => {
      expect(decideRetry(new ProviderError(providerCode), 1)).toEqual({
        retry: false,
        code: jobCode,
        message: FAILURE_MESSAGES[jobCode],
      });
    },
  );

  it('treats an unknown error as final and never copies its text', () => {
    const decision = decideRetry(new Error('boom sk-live-secret'), 1);
    expect(decision).toEqual({
      retry: false,
      code: 'INTERNAL',
      message: FAILURE_MESSAGES.INTERNAL,
    });
    expect(JSON.stringify(decision)).not.toContain('secret');
    expect(decideRetry('a string', 1).retry).toBe(false);
    expect(decideRetry(undefined, 1).retry).toBe(false);
  });

  it('maps every provider error code to a job error code', () => {
    for (const code of [
      'TIMEOUT',
      'UPSTREAM_5XX',
      'RATE_LIMITED',
      'INVALID_REQUEST',
      'INVALID_OUTPUT',
      'CONTENT_REFUSED',
      'AUTH_FAILED',
      'BUDGET_EXCEEDED',
      'OUTPUT_TRUNCATED',
    ] as const) {
      expect(jobErrorCodeFor(new ProviderError(code))).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe('failure messages', () => {
  it('are fixed sentences without placeholders', () => {
    for (const message of Object.values(FAILURE_MESSAGES)) {
      expect(message).toMatch(/^[A-Z][^{}$<>]*\.$/);
      expect(message.length).toBeLessThanOrEqual(500);
    }
  });
});
