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

function recordingFetch(respond: () => Response) {
  const calls: BodyCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return respond();
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
