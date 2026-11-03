import { afterEach, describe, expect, it } from 'vitest';

import { makeApp, type TestApp } from './test/app-helpers.js';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

describe('request logging', () => {
  it('records method, redacted url and status for a request, and nothing secret', async () => {
    current = await makeApp();
    const response = await current.app.inject({
      method: 'GET',
      url: '/api/v1/health?sig=SECRET&token=ALSOSECRET',
      headers: { authorization: 'Bearer abc.def.ghi', cookie: 'sid=SESSIONVALUE' },
    });
    expect(response.statusCode).toBe(200);

    const all = current.logs.join('\n');
    expect(all).not.toMatch(/SECRET|ALSOSECRET|abc\.def\.ghi|SESSIONVALUE/);

    const lines = current.logLines();
    const incoming = lines.find((line) => line.req !== undefined);
    const completed = lines.find((line) => line.res !== undefined);
    expect(incoming?.req).toMatchObject({ method: 'GET', url: '/api/v1/health?[REDACTED]' });
    expect(completed?.res).toMatchObject({ statusCode: 200 });
    expect(typeof completed?.reqId).toBe('string');
  });

  it('keeps the same request id on the request and response lines', async () => {
    current = await makeApp();
    const response = await current.app.inject({ method: 'GET', url: '/api/v1/health' });
    const id = response.headers['x-request-id'];
    const ids = current.logLines().map((line) => line.reqId);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set([id]));
  });
});
