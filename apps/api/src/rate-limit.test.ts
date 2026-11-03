import { ErrorBodySchema } from '@creatorops/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { makeApp, type TestApp } from './test/app-helpers.js';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

async function statuses(
  test: TestApp,
  url: string,
  headers: (i: number) => Record<string, string>,
  n: number,
) {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push((await test.app.inject({ method: 'GET', url, headers: headers(i) })).statusCode);
  }
  return out;
}

describe('rate limiting', () => {
  it('counts requests to unknown routes, so probing cannot bypass the limit', async () => {
    current = await makeApp({ rateLimitMax: 3 });
    const codes = await statuses(current, '/does-not-exist', () => ({}), 5);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
    const limited = await current.app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(ErrorBodySchema.parse(limited.json()).error.code).toBe('RATE_LIMITED');
  });

  it('shares one bucket and ignores X-Forwarded-For when no proxy is trusted (the default)', async () => {
    current = await makeApp({ rateLimitMax: 2 });
    const codes = await statuses(
      current,
      '/api/v1/health',
      (i) => ({ 'x-forwarded-for': `203.0.113.${i + 1}` }),
      4,
    );
    expect(codes).toEqual([200, 200, 429, 429]);
  });

  it('keys by the forwarded client address when one proxy hop is trusted', async () => {
    current = await makeApp({ rateLimitMax: 2, env: { TRUST_PROXY_HOPS: '1' } });
    const first = await statuses(
      current,
      '/api/v1/health',
      () => ({ 'x-forwarded-for': '203.0.113.1' }),
      3,
    );
    const second = await statuses(
      current,
      '/api/v1/health',
      () => ({ 'x-forwarded-for': '203.0.113.2' }),
      2,
    );
    expect(first).toEqual([200, 200, 429]);
    expect(second).toEqual([200, 200]);
  });
});
