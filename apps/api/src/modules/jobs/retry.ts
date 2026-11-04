import {
  isProviderError,
  MAX_RETRY_AFTER_MS,
  type ProviderErrorCode,
} from '@creatorops/provider-core';
import type { JobErrorCode } from '@creatorops/contracts';

/** Attempts a job may use before it fails for good (D-048). The row can lower this, never raise it. */
export const MAX_JOB_ATTEMPTS = 3;

/** Wait before attempt 2, 3 and 4 (D-048). The last entry only matters if the limit is raised. */
export const BACKOFF_MS = [2_000, 10_000, 30_000] as const;

/** Random extra wait, as a share of the base wait, so retries do not arrive in step. */
const JITTER_SHARE = 0.25;

const PROVIDER_TO_JOB_ERROR: Readonly<Record<ProviderErrorCode, JobErrorCode>> = {
  TIMEOUT: 'PROVIDER_TIMEOUT',
  UPSTREAM_5XX: 'PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  INVALID_OUTPUT: 'INVALID_PROVIDER_OUTPUT',
  CONTENT_REFUSED: 'CONTENT_REFUSED',
  // These two are our bug or our configuration, not something the user can act on.
  INVALID_REQUEST: 'INTERNAL',
  AUTH_FAILED: 'INTERNAL',
};

/** What the job row records. Fixed sentences only: they never carry provider or product text. */
export const FAILURE_MESSAGES: Readonly<Record<JobErrorCode, string>> = {
  PROVIDER_TIMEOUT: 'The text provider did not respond in time.',
  PROVIDER_UNAVAILABLE: 'The text provider is unavailable right now.',
  PROVIDER_RATE_LIMITED: 'The text provider rate limit was reached.',
  INVALID_PROVIDER_OUTPUT: 'The text provider returned output that failed validation.',
  CONTENT_REFUSED: 'The text provider refused to generate this content.',
  SECTION_CHANGED: 'The section was edited while the job was running.',
  ASSET_UNAVAILABLE:
    'An attached file is missing or no longer available. Check the attachments and try again.',
  EXPORT_TOO_LARGE: 'The package is too large to export. Remove some attachments and try again.',
  CANCELLED: 'Cancelled by a user.',
  INTERNAL: 'The job failed unexpectedly.',
};

export type RetryDecision =
  | { readonly retry: true; readonly delayMs: number; readonly code: JobErrorCode }
  | { readonly retry: false; readonly code: JobErrorCode; readonly message: string };

export interface DecideRetryOptions {
  /** Attempts the job may use; defaults to MAX_JOB_ATTEMPTS and is never above it. */
  readonly maxAttempts?: number;
  /** Returns a number in [0, 1). Replaceable so tests are exact. */
  readonly random?: () => number;
}

/** The job error code for a failure. Anything that is not a ProviderError is INTERNAL. */
export function jobErrorCodeFor(error: unknown): JobErrorCode {
  return isProviderError(error) ? PROVIDER_TO_JOB_ERROR[error.code] : 'INTERNAL';
}

/**
 * Decides whether a failed attempt is tried again (D-048). Pure.
 *
 * Only transient provider errors (timeout, server error, rate limit) retry, and only while
 * attempts remain. A rate limit waits at least as long as the provider asked, capped at one
 * minute. Everything else, including every unknown error, fails at once with a stable code.
 *
 * @param attempt the attempt that just failed, counting from 1
 */
export function decideRetry(
  error: unknown,
  attempt: number,
  options: DecideRetryOptions = {},
): RetryDecision {
  const code = jobErrorCodeFor(error);
  const limit = Math.min(options.maxAttempts ?? MAX_JOB_ATTEMPTS, MAX_JOB_ATTEMPTS);

  if (!isProviderError(error) || !error.retryable || attempt >= limit) {
    return { retry: false, code, message: FAILURE_MESSAGES[code] };
  }

  const base = BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
  const random = options.random ?? Math.random;
  const jitter = Math.floor(base * JITTER_SHARE * Math.min(Math.max(random(), 0), 0.999999));
  const asked =
    error.retryAfterMs === undefined ? 0 : Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS);
  return { retry: true, delayMs: Math.max(base, asked) + jitter, code };
}
