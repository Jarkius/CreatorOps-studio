import { describe, expect, it } from 'vitest';

import { REDACTED, redactString, redactValue } from './redact.js';

describe('redactValue: keys', () => {
  it('redacts values under sensitive keys, at any depth and in arrays', () => {
    const input = {
      requestId: 'req-1',
      headers: { authorization: 'Bearer abc.def', Cookie: 'sid=1', 'x-api-key': 'k-123' },
      body: { password: 'hunter2', nested: { accessToken: 't0k', clientSecret: 's3' } },
      list: [{ apiKey: 'zzz' }, { ok: 'fine' }],
      privateKey: '-----BEGIN-----',
      signature: 'deadbeef',
      sig: 'cafe',
    };
    expect(redactValue(input)).toEqual({
      requestId: 'req-1',
      headers: { authorization: REDACTED, Cookie: REDACTED, 'x-api-key': REDACTED },
      body: { password: REDACTED, nested: { accessToken: REDACTED, clientSecret: REDACTED } },
      list: [{ apiKey: REDACTED }, { ok: 'fine' }],
      privateKey: REDACTED,
      signature: REDACTED,
      sig: REDACTED,
    });
  });

  it('keeps numeric and boolean usage counters under token-like keys', () => {
    expect(redactValue({ inputTokens: 120, outputTokens: 30, hasToken: true })).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      hasToken: true,
    });
  });

  it('keeps null and undefined under sensitive keys as they are', () => {
    expect(redactValue({ token: null, secret: undefined })).toEqual({
      token: null,
      secret: undefined,
    });
  });

  it('does not mutate its input', () => {
    const input = { password: 'p', inner: { token: 't' } };
    redactValue(input);
    expect(input).toEqual({ password: 'p', inner: { token: 't' } });
  });
});

describe('redactString', () => {
  it('hides bearer and basic credentials', () => {
    expect(redactString('failed with Bearer abc.DEF-123_x')).toBe(`failed with Bearer ${REDACTED}`);
    expect(redactString('header Basic dXNlcjpwYXNz')).toBe(`header Basic ${REDACTED}`);
  });

  it('hides the password in connection URLs but keeps user and host', () => {
    expect(redactString('connect postgres://creatorops:hunter2@db.internal:5432/app failed')).toBe(
      `connect postgres://creatorops:${REDACTED}@db.internal:5432/app failed`,
    );
  });

  it('hides the whole query string of absolute URLs (signed media URLs)', () => {
    const out = redactString('GET https://files.example.com/m/abc.jpg?sig=SECRET&exp=99 done');
    expect(out).toBe(`GET https://files.example.com/m/abc.jpg?${REDACTED} done`);
    expect(out).not.toContain('SECRET');
  });

  it('hides the query string of paths', () => {
    expect(redactString('/api/v1/media/abc?sig=SECRET&exp=1')).toBe(
      `/api/v1/media/abc?${REDACTED}`,
    );
    expect(redactString('request for "/media/x.png?sig=SECRET" ok')).not.toContain('SECRET');
  });

  it('leaves ordinary text alone', () => {
    expect(redactString('Created product 42 for workspace w1')).toBe(
      'Created product 42 for workspace w1',
    );
  });
});

describe('redactValue: special values', () => {
  it('flattens errors and scrubs their message and stack', () => {
    const error = new Error('cannot reach postgres://u:hunter2@localhost:5432/db');
    const out = redactValue(error) as Record<string, string>;
    expect(out.type).toBe('Error');
    expect(out.message).toBe(`cannot reach postgres://u:${REDACTED}@localhost:5432/db`);
    expect(out.stack).not.toContain('hunter2');
  });

  it('scrubs own enumerable properties of errors', () => {
    const error = Object.assign(new Error('boom'), { token: 'abc', code: 'E1' });
    expect(redactValue(error)).toMatchObject({ token: REDACTED, code: 'E1' });
  });

  it('replaces binary data with its size', () => {
    expect(redactValue({ bytes: new Uint8Array(5) })).toEqual({ bytes: '[binary 5 bytes]' });
    expect(redactValue(Buffer.from('hello'))).toBe('[binary 5 bytes]');
  });

  it('handles circular references and deep nesting', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(redactValue(a)).toEqual({ name: 'a', self: '[circular]' });

    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    expect(JSON.stringify(redactValue(deep))).toContain('[max depth]');
  });
});
