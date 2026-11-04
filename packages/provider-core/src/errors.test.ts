import { describe, expect, it } from 'vitest';

import {
  MAX_RETRY_AFTER_MS,
  PROVIDER_ERROR_CODES,
  ProviderError,
  isProviderError,
  type ProviderErrorCode,
} from './errors.js';

const TRANSIENT: ProviderErrorCode[] = ['TIMEOUT', 'UPSTREAM_5XX', 'RATE_LIMITED'];

describe('ProviderError', () => {
  it('marks only TIMEOUT, UPSTREAM_5XX and RATE_LIMITED as retryable', () => {
    for (const code of PROVIDER_ERROR_CODES) {
      const error = new ProviderError(code);
      expect(error.retryable, code).toBe(TRANSIENT.includes(code));
      expect(error.code).toBe(code);
    }
  });

  it('is an Error with a stable name', () => {
    const error = new ProviderError('CONTENT_REFUSED');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProviderError');
  });

  it('uses a short fixed message per code without request content', () => {
    for (const code of PROVIDER_ERROR_CODES) {
      const message = new ProviderError(code).message;
      expect(message.length, code).toBeGreaterThan(0);
      expect(message.length, code).toBeLessThanOrEqual(80);
    }
    expect(new ProviderError('TIMEOUT').message).toBe('The text provider did not respond in time.');
  });

  it('keeps retryAfterMs for RATE_LIMITED', () => {
    expect(new ProviderError('RATE_LIMITED', { retryAfterMs: 2000 }).retryAfterMs).toBe(2000);
  });

  it('clamps retryAfterMs to 0..60000', () => {
    expect(new ProviderError('RATE_LIMITED', { retryAfterMs: 120_000 }).retryAfterMs).toBe(
      MAX_RETRY_AFTER_MS,
    );
    expect(new ProviderError('RATE_LIMITED', { retryAfterMs: -5 }).retryAfterMs).toBe(0);
    expect(new ProviderError('RATE_LIMITED', { retryAfterMs: Number.NaN }).retryAfterMs).toBe(0);
    expect(new ProviderError('RATE_LIMITED', { retryAfterMs: 0 }).retryAfterMs).toBe(0);
  });

  it('leaves retryAfterMs undefined when it is not given', () => {
    expect(new ProviderError('RATE_LIMITED').retryAfterMs).toBeUndefined();
  });

  it('refuses retryAfterMs on any code other than RATE_LIMITED', () => {
    expect(() => new ProviderError('TIMEOUT', { retryAfterMs: 1000 })).toThrow(TypeError);
    expect(() => new ProviderError('UPSTREAM_5XX', { retryAfterMs: 1000 })).toThrow(TypeError);
  });
});

describe('isProviderError', () => {
  it('recognises ProviderError instances only', () => {
    expect(isProviderError(new ProviderError('AUTH_FAILED'))).toBe(true);
    expect(isProviderError(new Error('boom'))).toBe(false);
    expect(isProviderError({ code: 'TIMEOUT' })).toBe(false);
    expect(isProviderError(undefined)).toBe(false);
  });
});
