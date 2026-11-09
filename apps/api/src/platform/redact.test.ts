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

  it('hides the password in a Redis URL, with or without a user name', () => {
    expect(redactString('connect redis://:hunter2@127.0.0.1:6379 failed')).toBe(
      `connect redis://:${REDACTED}@127.0.0.1:6379 failed`,
    );
    expect(redactString('connect rediss://default:hunter2@cache.internal:6380/0 failed')).toBe(
      `connect rediss://default:${REDACTED}@cache.internal:6380/0 failed`,
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

describe('redaction gaps closed after review', () => {
  it('hides the query of a path that follows a key or colon, not just whitespace', () => {
    for (const text of [
      'url=/media/a.png?sig=SECRET',
      'path:/x?token=SECRET',
      '{"url":"/m/a?sig=SECRET"}',
      '[/a?sig=SECRET]',
    ]) {
      const out = redactString(text);
      expect(out, text).not.toContain('SECRET');
      expect(out, text).toContain(REDACTED);
    }
  });

  it('is idempotent and does not mangle already redacted URLs', () => {
    const once = redactString('GET https://files.example.com/m/a.jpg?sig=SECRET ok');
    expect(redactString(once)).toBe(once);
  });

  it('follows error causes and aggregate errors', () => {
    const cause = new Error('inner postgres://u:hunter2@h:5432/d');
    const outer = new Error('outer', { cause });
    const out = redactValue(outer) as { cause: { message: string } };
    expect(out.cause.message).toBe(`inner postgres://u:${REDACTED}@h:5432/d`);

    const aggregate = new AggregateError([new Error('a Bearer abc.def')], 'many');
    const flat = JSON.stringify(redactValue(aggregate));
    expect(flat).not.toContain('abc.def');
    expect(flat).toContain('many');
  });

  it('keeps useful values for dates, URLs, maps and sets, and scrubs them', () => {
    expect(redactValue(new Date('2026-11-03T00:00:00.000Z'))).toBe('2026-11-03T00:00:00.000Z');
    expect(redactValue(new Date('nope'))).toBe('Invalid Date');
    expect(redactValue(new URL('https://x.test/m?sig=SECRET'))).toBe(
      `https://x.test/m?${REDACTED}`,
    );
    expect(
      redactValue(
        new Map([
          ['password', 'p'],
          ['ok', 'fine'],
        ]),
      ),
    ).toEqual([
      ['password', REDACTED],
      ['ok', 'fine'],
    ]);
    expect(redactValue(new Set(['a', 'Bearer abc.def']))).toEqual(['a', `Bearer ${REDACTED}`]);
  });
});

describe('redactString: provider API keys in free text', () => {
  it('hides sk- style keys anywhere in a string, and leaves short or ordinary text alone', () => {
    expect(redactString('call failed for key sk-or-v1-abcdef0123456789abcdef done')).toBe(
      `call failed for key ${REDACTED} done`,
    );
    expect(redactString('{"key":"sk-proj_ABCDEFGHIJKLMNOP1234"}')).toBe(`{"key":"${REDACTED}"}`);
    expect(redactString('sk-short and task-force and desk-lamp-0123456789abcdef')).toBe(
      'sk-short and task-force and desk-lamp-0123456789abcdef',
    );
  });
});
