import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient } from './client.js';

const USER = { id: 'u1', email: 'dev@creatorops.local', displayName: 'Dev User' };
const ME = { user: USER, workspaces: [{ id: 'w1', name: 'Dev Workspace', role: 'owner' }] };

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, impl };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('createApiClient', () => {
  it('calls the right URL, ignores a trailing slash, and parses the typed response', async () => {
    const { calls, impl } = fakeFetch(() =>
      json({ status: 'ok', service: 'creatorops-api', time: '2026-11-03T00:00:00.000Z' }),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:3000/', fetch: impl });
    expect((await client.health()).status).toBe('ok');
    expect(calls[0]?.url).toBe('http://localhost:3000/api/v1/health');
    expect(calls[0]?.method).toBe('GET');
  });

  it('sends the bearer token only on authenticated calls and reads it on every call', async () => {
    let token: string | null = 'first';
    const { calls, impl } = fakeFetch((call) =>
      call.url.endsWith('/me')
        ? json(ME)
        : json({ status: 'ok', service: 'creatorops-api', time: 't' }),
    );
    const client = createApiClient({ baseUrl: 'http://x', fetch: impl, getToken: () => token });

    await client.me();
    token = 'second';
    await client.me();
    await client.health();

    expect(calls[0]?.headers.authorization).toBe('Bearer first');
    expect(calls[1]?.headers.authorization).toBe('Bearer second');
    expect(calls[2]?.headers.authorization).toBeUndefined();
  });

  it('omits the header when there is no token', async () => {
    const { calls, impl } = fakeFetch(() => json(ME));
    await createApiClient({ baseUrl: 'http://x', fetch: impl, getToken: () => null }).me();
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('turns an API error body into an ApiError with code, requestId and field issues', async () => {
    const { impl } = fakeFetch(() =>
      json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The request is not valid.',
            requestId: 'req-123',
            details: { fields: [{ path: 'name', message: 'Required' }] },
          },
        },
        400,
      ),
    );
    const error = await failure(createApiClient({ baseUrl: 'http://x', fetch: impl }).me());
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, requestId: 'req-123' });
    expect(error.fields).toEqual([{ path: 'name', message: 'Required' }]);
    expect(error.retryable).toBe(false);
  });

  it('marks rate limits and server errors as retryable', async () => {
    const limited = fakeFetch(() =>
      json({ error: { code: 'RATE_LIMITED', message: 'Slow down', requestId: 'r' } }, 429),
    );
    expect(
      (await failure(createApiClient({ baseUrl: 'http://x', fetch: limited.impl }).me())).retryable,
    ).toBe(true);

    const broken = fakeFetch(() => new Response('<html>oops</html>', { status: 502 }));
    const error = await failure(createApiClient({ baseUrl: 'http://x', fetch: broken.impl }).me());
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('The server had a problem. Please try again.');
    expect(error.retryable).toBe(true);
  });

  it('reports a network failure without leaking the token or URL details', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.5:3000 token=abc');
    }) as typeof fetch;
    const error = await failure(
      createApiClient({
        baseUrl: 'http://x',
        fetch: impl,
        getToken: () => 'super-secret-token',
      }).me(),
    );
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).not.toContain('super-secret-token');
    expect(error.message).not.toContain('10.0.0.5');
    expect(error.retryable).toBe(true);
  });

  it('times out slow requests', async () => {
    const impl = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abort = new Error('aborted');
          abort.name = 'AbortError';
          reject(abort);
        });
      })) as typeof fetch;
    const error = await failure(
      createApiClient({ baseUrl: 'http://x', fetch: impl, timeoutMs: 20 }).health(),
    );
    expect(error.code).toBe('TIMEOUT');
    expect(error.retryable).toBe(true);
  });

  it('rejects a response that does not match the contract', async () => {
    const { impl } = fakeFetch(() => json({ user: { id: 1 } }));
    const error = await failure(createApiClient({ baseUrl: 'http://x', fetch: impl }).me());
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.retryable).toBe(false);
  });

  it('rejects a success response that is not JSON', async () => {
    const { impl } = fakeFetch(() => new Response('not json', { status: 200 }));
    const error = await failure(createApiClient({ baseUrl: 'http://x', fetch: impl }).health());
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  it('exposes the request id from the header when the body is not an API error', async () => {
    const { impl } = fakeFetch(
      () => new Response('gateway', { status: 504, headers: { 'x-request-id': 'edge-1' } }),
    );
    const error = await failure(createApiClient({ baseUrl: 'http://x', fetch: impl }).health());
    expect(error.requestId).toBe('edge-1');
  });

  it('posts for the mock token endpoint without credentials', async () => {
    const { calls, impl } = fakeFetch(() =>
      json({ token: 'v1.a.b', expiresAt: '2026-11-04T00:00:00.000Z', user: USER }),
    );
    const client = createApiClient({ baseUrl: 'http://x', fetch: impl, getToken: () => 'old' });
    const result = await client.mockToken();
    expect(result.token).toBe('v1.a.b');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://x/api/v1/auth/mock-token' });
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('times out when the server sends headers and then stalls the body', async () => {
    const impl = (async (_input: string | URL | Request, init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const abort = new Error('aborted');
              abort.name = 'AbortError';
              reject(abort);
            });
          }),
      }) as unknown as Response) as typeof fetch;
    const error = await failure(
      createApiClient({ baseUrl: 'http://x', fetch: impl, timeoutMs: 20 }).health(),
    );
    expect(error.code).toBe('TIMEOUT');
  });
});

const PRODUCT = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'Fan',
  description: null,
  sourceUrl: null,
  priceAmount: '199.00',
  currency: 'THB',
  sellingPoints: ['Quiet'],
  targetAudience: null,
  brandTone: null,
  restrictedClaims: [],
  primaryAssetId: null,
  status: 'active',
  version: 1,
  createdAt: '2026-11-03T00:00:00.000Z',
  updatedAt: '2026-11-03T00:00:00.000Z',
  archivedAt: null,
};

interface BodyCall extends Call {
  body: string | undefined;
}

function recordingFetch(respond: (url: string) => Response) {
  const calls: BodyCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return respond(String(input));
  }) as typeof fetch;
  return { calls, impl };
}

describe('workspaces and products', () => {
  it('lists products with the query string and escapes ids in the path', async () => {
    const { calls, impl } = recordingFetch(() => json({ items: [PRODUCT], nextCursor: 'abc' }));
    const client = createApiClient({ baseUrl: 'http://x', fetch: impl, getToken: () => 't' });
    const result = await client.products.list('w/1', {
      status: 'archived',
      limit: 10,
      cursor: undefined,
    });
    expect(result.nextCursor).toBe('abc');
    expect(calls[0]?.url).toBe(
      'http://x/api/v1/workspaces/w%2F1/products?status=archived&limit=10',
    );
    expect(calls[0]?.headers.authorization).toBe('Bearer t');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('sends JSON bodies with a content type, and no content type when there is no body', async () => {
    const { calls, impl } = recordingFetch(() => json(PRODUCT));
    const client = createApiClient({ baseUrl: 'http://x', fetch: impl });

    await client.products.create('w1', { name: 'Fan', sellingPoints: ['Quiet'] });
    await client.products.update('w1', 'p1', { version: 1, name: 'Fan 2' });
    await client.products.archive('w1', 'p1');

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://x/api/v1/workspaces/w1/products',
    });
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ name: 'Fan', sellingPoints: ['Quiet'] });
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      url: 'http://x/api/v1/workspaces/w1/products/p1',
    });
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ version: 1, name: 'Fan 2' });
    expect(calls[2]).toMatchObject({
      method: 'POST',
      url: 'http://x/api/v1/workspaces/w1/products/p1/archive',
    });
    expect(calls[2]?.headers['content-type']).toBeUndefined();
    expect(calls[2]?.body).toBeUndefined();
  });

  it('exposes the current version when an update conflicts', async () => {
    const { impl } = recordingFetch(() =>
      json(
        {
          error: {
            code: 'CONFLICT',
            message: 'This product was changed by someone else.',
            requestId: 'r1',
            details: { currentVersion: 7 },
          },
        },
        409,
      ),
    );
    const error = await failure(
      createApiClient({ baseUrl: 'http://x', fetch: impl }).products.update('w1', 'p1', {
        version: 1,
        name: 'x',
      }),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', status: 409, currentVersion: 7 });
    expect(error.retryable).toBe(false);
  });

  it('creates and reads workspaces', async () => {
    const workspace = {
      id: 'w1',
      name: 'Shop',
      defaultLanguage: 'th',
      brandVoice: null,
      role: 'owner',
      createdAt: 't',
      updatedAt: 't',
    };
    const { calls, impl } = recordingFetch(() => json(workspace, 201));
    const client = createApiClient({ baseUrl: 'http://x', fetch: impl });
    expect((await client.workspaces.create({ name: 'Shop' })).role).toBe('owner');
    expect((await client.workspaces.get('w1')).name).toBe('Shop');
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/v1/workspaces',
      'http://x/api/v1/workspaces/w1',
    ]);
  });

  it('rejects a product response that does not match the contract', async () => {
    const { impl } = recordingFetch(() => json({ ...PRODUCT, version: 'one' }));
    const error = await failure(
      createApiClient({ baseUrl: 'http://x', fetch: impl }).products.get('w1', 'p1'),
    );
    expect(error.code).toBe('INVALID_RESPONSE');
  });
});

describe('content: campaigns, drafts, jobs', () => {
  const SECTIONS = {
    title: 'ชื่อ',
    hook: 'ฮุค',
    script: 'สคริปต์',
    storyboard: ['ฉาก'],
    caption: 'แคปชั่น',
    hashtags: ['#a'],
    callToAction: 'สั่งเลย',
  };
  const STATE = Object.fromEntries(
    Object.keys(SECTIONS).map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
  );
  const DRAFT = {
    id: 'd1',
    workspaceId: 'w1',
    campaignId: 'c1',
    productId: 'p1',
    variantIndex: 0,
    sections: SECTIONS,
    sectionState: STATE,
    claimWarnings: [],
    needsReview: false,
    status: 'draft',
    version: 1,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
  };
  const JOB = {
    id: 'j1',
    workspaceId: 'w1',
    type: 'generate_brief',
    status: 'queued',
    input: {},
    output: null,
    errorCode: null,
    errorMessage: null,
    provider: null,
    attempts: 0,
    maxAttempts: 3,
    campaignId: 'c1',
    draftId: null,
    createdAt: '2026-11-04T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  };
  const make = (respond: (url: string) => Response) => {
    const { calls, impl } = recordingFetch(respond);
    return {
      calls,
      client: createApiClient({ baseUrl: 'http://x', fetch: impl, getToken: () => 't' }),
    };
  };

  it('sends the idempotency key header on generate and regenerate, and nowhere else', async () => {
    const { calls, client } = make(() => json(JOB, 202));
    await client.jobs.generateBrief('w/1', { campaignId: 'c1' }, 'key-12345678');
    await client.jobs.regenerateSection(
      'w1',
      { draftId: 'd1', section: 'hook', expectedRev: 1 },
      'key-87654321',
    );
    await client.jobs.get('w1', 'j1');
    await client.jobs.cancel('w1', 'j 1');
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'http://x/api/v1/workspaces/w%2F1/jobs/generate-brief'],
      ['POST', 'http://x/api/v1/workspaces/w1/jobs/regenerate-section'],
      ['GET', 'http://x/api/v1/workspaces/w1/jobs/j1'],
      ['POST', 'http://x/api/v1/workspaces/w1/jobs/j%201/cancel'],
    ]);
    expect(calls[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(calls[0]?.headers.authorization).toBe('Bearer t');
    expect(calls[0]?.body).toBe(JSON.stringify({ campaignId: 'c1' }));
    expect(calls[1]?.headers['idempotency-key']).toBe('key-87654321');
    expect(calls[2]?.headers['idempotency-key']).toBeUndefined();
    expect(calls[3]?.headers['idempotency-key']).toBeUndefined();
  });

  it('calls the export routes, with the key only on the job', async () => {
    const exportRow = {
      id: 'e1',
      workspaceId: 'w1',
      draftId: 'd1',
      jobId: 'j1',
      status: 'ready',
      draftVersion: 2,
      fileCount: 3,
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      filename: 'creatorops-20261104-abcd1234.zip',
      createdAt: '2026-11-04T00:00:00.000Z',
      expiresAt: '2026-11-11T00:00:00.000Z',
    };
    const { calls, client } = make((url) =>
      url.endsWith('/download-url')
        ? json({ url: '/api/v1/exports/e1/download?u=1', expiresAt: 'x', filename: 'f.zip' })
        : url.includes('/jobs/')
          ? json(JOB, 202)
          : url.includes('/exports?')
            ? json({ items: [exportRow], nextCursor: null })
            : json(exportRow),
    );
    await client.jobs.exportPackage('w1', { draftId: 'd1', draftVersion: 2 }, 'key-12345678');
    expect((await client.exports.list('w1', { draftId: 'd1' })).items[0]?.id).toBe('e1');
    expect((await client.exports.get('w1', 'e 1')).filename).toMatch(/\.zip$/);
    expect((await client.exports.downloadUrl('w1', 'e1')).url).toContain('/download');
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'http://x/api/v1/workspaces/w1/jobs/export-package'],
      ['GET', 'http://x/api/v1/workspaces/w1/exports?draftId=d1'],
      ['GET', 'http://x/api/v1/workspaces/w1/exports/e%201'],
      ['POST', 'http://x/api/v1/workspaces/w1/exports/e1/download-url'],
    ]);
    expect(calls[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(calls[3]?.headers['idempotency-key']).toBeUndefined();
  });

  it('accepts both 200 (replay) and 202 (new) job responses', async () => {
    for (const status of [200, 202]) {
      const { client } = make(() => json(JOB, status));
      expect((await client.jobs.generateBrief('w1', { campaignId: 'c1' }, 'key-12345678')).id).toBe(
        'j1',
      );
    }
  });

  it('reads and replaces the files attached to a draft', async () => {
    const { calls, client } = make(() => json({ items: [] }));
    expect(await client.drafts.listAssets('w1', 'd 1')).toEqual({ items: [] });
    await client.drafts.setAssets('w1', 'd1', {
      assets: [{ assetId: 'a1', scene: 'usage', aiGenerated: true, generator: 'Meta AI' }],
    });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', 'http://x/api/v1/workspaces/w1/drafts/d%201/assets'],
      ['PUT', 'http://x/api/v1/workspaces/w1/drafts/d1/assets'],
    ]);
    expect(calls[1]?.body).toBe(
      JSON.stringify({
        assets: [{ assetId: 'a1', scene: 'usage', aiGenerated: true, generator: 'Meta AI' }],
      }),
    );
  });

  it('reads and edits drafts with the version, and exposes currentVersion on a conflict', async () => {
    const { calls, client } = make(() =>
      json(calls.length === 2 ? { items: [DRAFT], nextCursor: null } : DRAFT),
    );
    expect((await client.drafts.get('w1', 'd1')).sections.hook).toBe('ฮุค');
    await client.drafts.list('w1', { campaignId: 'c1', limit: 5 });
    await client.drafts.update('w1', 'd1', { version: 1, sections: { hook: 'ใหม่' } });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', 'http://x/api/v1/workspaces/w1/drafts/d1'],
      ['GET', 'http://x/api/v1/workspaces/w1/drafts?campaignId=c1&limit=5'],
      ['PATCH', 'http://x/api/v1/workspaces/w1/drafts/d1'],
    ]);
    expect(calls[2]?.body).toBe(JSON.stringify({ version: 1, sections: { hook: 'ใหม่' } }));

    const conflict = make(() =>
      json(
        {
          error: {
            code: 'CONFLICT',
            message: 'changed',
            requestId: 'r1',
            details: { currentVersion: 4 },
          },
        },
        409,
      ),
    );
    const error = await failure(
      conflict.client.drafts.update('w1', 'd1', { version: 1, sections: { hook: 'x' } }),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', status: 409, currentVersion: 4 });
  });

  it('lists templates and campaigns and creates and updates a campaign', async () => {
    const CAMPAIGN = {
      id: 'c1',
      workspaceId: 'w1',
      productId: 'p1',
      name: 'C',
      templateId: 'product-showcase',
      templateVersion: 1,
      language: 'th',
      tone: null,
      platform: 'generic',
      durationSeconds: 30,
      variants: 1,
      status: 'draft',
      version: 1,
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z',
    };
    const { calls, client } = make(() => json(calls.length === 1 ? { items: [] } : CAMPAIGN));
    await client.templates.list('w1');
    await client.campaigns.get('w1', 'c1');
    await client.campaigns.create('w1', {
      productId: 'p1',
      templateId: 'product-showcase',
      templateVersion: 1,
    });
    await client.campaigns.update('w1', 'c1', { version: 1, name: 'N' });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', 'http://x/api/v1/workspaces/w1/templates'],
      ['GET', 'http://x/api/v1/workspaces/w1/campaigns/c1'],
      ['POST', 'http://x/api/v1/workspaces/w1/campaigns'],
      ['PATCH', 'http://x/api/v1/workspaces/w1/campaigns/c1'],
    ]);
  });

  it('rejects a draft response that does not match the contract', async () => {
    const { client } = make(() => json({ ...DRAFT, sections: { title: 'only' } }));
    expect(await failure(client.drafts.get('w1', 'd1'))).toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
