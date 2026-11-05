import { describe, expect, it } from 'vitest';

import {
  isSafeProviderBaseUrl,
  OPENROUTER_BASE_URL,
  PutProviderSettingsRequestSchema,
} from './provider.js';

describe('isSafeProviderBaseUrl', () => {
  it('accepts an https URL on a public host name, with a path', () => {
    for (const url of [
      'https://openrouter.ai/api/v1',
      'https://gateway.example.co.th/v1',
      'https://api.example.com:8443/openai/v1',
    ]) {
      expect(isSafeProviderBaseUrl(url), url).toBe(true);
    }
  });

  it('refuses http, credentials, query, fragment, IP addresses, local and internal names', () => {
    for (const url of [
      'http://openrouter.ai/api/v1',
      'https://user:pw@example.com/v1',
      'https://example.com/v1?key=1',
      'https://example.com/v1#x',
      'https://127.0.0.1/v1',
      'https://10.0.0.5/v1',
      'https://169.254.169.254/latest',
      'https://[::1]/v1',
      'https://localhost/v1',
      'https://app.localhost/v1',
      'https://printer.local/v1',
      'https://db.internal/v1',
      'https://metadata.google.internal/v1',
      'https://intranet/v1',
      'ftp://example.com',
      'not a url',
      '',
    ]) {
      expect(isSafeProviderBaseUrl(url), url).toBe(false);
    }
  });
});

describe('PutProviderSettingsRequestSchema', () => {
  const ok = { provider: 'openrouter', model: 'vendor/model-x' } as const;

  it('accepts OpenRouter without a URL, or with its own', () => {
    expect(PutProviderSettingsRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      PutProviderSettingsRequestSchema.safeParse({ ...ok, baseUrl: OPENROUTER_BASE_URL }).success,
    ).toBe(true);
  });

  it('refuses another URL for OpenRouter, and a custom provider without a safe URL', () => {
    expect(
      PutProviderSettingsRequestSchema.safeParse({ ...ok, baseUrl: 'https://evil.example/v1' })
        .success,
    ).toBe(false);
    expect(PutProviderSettingsRequestSchema.safeParse({ ...ok, provider: 'custom' }).success).toBe(
      false,
    );
    expect(
      PutProviderSettingsRequestSchema.safeParse({
        ...ok,
        provider: 'custom',
        baseUrl: 'https://127.0.0.1/v1',
      }).success,
    ).toBe(false);
    expect(
      PutProviderSettingsRequestSchema.safeParse({
        ...ok,
        provider: 'custom',
        baseUrl: 'https://gateway.example.com/v1',
      }).success,
    ).toBe(true);
  });

  it('checks the key shape, prices, cap, and unknown fields', () => {
    const parse = (extra: object) =>
      PutProviderSettingsRequestSchema.safeParse({ ...ok, ...extra });
    expect(parse({ apiKey: 'sk-or-v1-abcdef' }).success).toBe(true);
    expect(parse({ apiKey: 'short' }).success).toBe(false);
    expect(parse({ apiKey: 'has a space inside' }).success).toBe(false);
    expect(parse({ apiKey: 'line\nbreak-key-123' }).success).toBe(false);
    expect(parse({ pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } }).success).toBe(
      true,
    );
    expect(parse({ pricing: { inputPerMillionUsd: -1, outputPerMillionUsd: 15 } }).success).toBe(
      false,
    );
    expect(
      parse({ pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15, multiplier: 0 } }).success,
    ).toBe(false);
    expect(parse({ monthlyCapUsd: -5 }).success).toBe(false);
    expect(parse({ monthlyCapUsd: 0 }).success).toBe(true);
    expect(parse({ monthlyCapUsd: null }).success).toBe(true);
    expect(parse({ surprise: 1 }).success).toBe(false);
  });
});
