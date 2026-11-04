export const PROVIDER_ERROR_CODES = [
  'TIMEOUT',
  'UPSTREAM_5XX',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'INVALID_OUTPUT',
  'CONTENT_REFUSED',
  'AUTH_FAILED',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const TRANSIENT_CODES: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>([
  'TIMEOUT',
  'UPSTREAM_5XX',
  'RATE_LIMITED',
]);

/** Fixed sentences only. They never include request content, product text or secrets. */
const SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  TIMEOUT: 'The text provider did not respond in time.',
  UPSTREAM_5XX: 'The text provider returned a server error.',
  RATE_LIMITED: 'The text provider rate limit was reached.',
  INVALID_REQUEST: 'The generation request was rejected as invalid.',
  INVALID_OUTPUT: 'The text provider returned output that failed validation.',
  CONTENT_REFUSED: 'The text provider refused to generate this content.',
  AUTH_FAILED: 'The text provider rejected the configured credentials.',
};

export const MAX_RETRY_AFTER_MS = 60_000;

export interface ProviderErrorOptions {
  /** Only valid for RATE_LIMITED. Clamped to 0..60000. */
  retryAfterMs?: number;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(code: ProviderErrorCode, options: ProviderErrorOptions = {}) {
    super(SAFE_MESSAGES[code]);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = TRANSIENT_CODES.has(code);
    if (options.retryAfterMs !== undefined) {
      if (code !== 'RATE_LIMITED') {
        throw new TypeError('retryAfterMs is only allowed for RATE_LIMITED');
      }
      const requested = options.retryAfterMs;
      this.retryAfterMs = Number.isNaN(requested)
        ? 0
        : Math.min(MAX_RETRY_AFTER_MS, Math.max(0, requested));
    }
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
