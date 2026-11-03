import { describe, expect, it } from 'vitest';

import { createSessionClient } from './session.js';
import { createMemoryTokenStore } from './token-store.js';

const USER = { id: 'u1', email: 'dev@creatorops.local', displayName: 'Dev User' };
const ME = { user: USER, workspaces: [{ id: 'w1', name: 'Dev Workspace', role: 'owner' }] };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const unauthenticated = () =>
  json(
    { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.', requestId: 'r1' } },
    401,
  );

interface Call {
  path: string;
  authorization: string | undefined;
}

/** A fake API: tokens are numbered, only the token in `valid` is accepted by /me. */
function fakeApi() {
  const calls: Call[] = [];
  const state = { issued: 0, valid: new Set<string>() };
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ path, authorization: headers.authorization });
    if (path === '/api/v1/auth/mock-token') {
      state.issued += 1;
      const token = `token-${state.issued}`;
      state.valid.add(token);
      return json({ token, expiresAt: '2099-01-01T00:00:00.000Z', user: USER });
    }
    if (path === '/api/v1/me') {
      const token = headers.authorization?.replace('Bearer ', '');
      return token && state.valid.has(token) ? json(ME) : unauthenticated();
    }
    return json({ error: { code: 'NOT_FOUND', message: 'no', requestId: 'r' } }, 404);
  }) as typeof fetch;
  return { calls, state, impl };
}

describe('createSessionClient', () => {
  it('signs in with a mock token when none is stored, stores it, and loads the user', async () => {
    const api = fakeApi();
    const store = createMemoryTokenStore();
    const session = createSessionClient({
      baseUrl: 'http://x',
      store,
      mockAuth: true,
      fetch: api.impl,
    });
    const me = await session.loadMe();
    expect(me.user.displayName).toBe('Dev User');
    expect(await store.get()).toBe('token-1');
    expect(api.calls.map((c) => c.path)).toEqual(['/api/v1/auth/mock-token', '/api/v1/me']);
    expect(api.calls[1]?.authorization).toBe('Bearer token-1');
  });

  it('reuses a stored token without asking for a new one', async () => {
    const api = fakeApi();
    api.state.valid.add('kept');
    const store = createMemoryTokenStore();
    await store.set('kept');
    const session = createSessionClient({
      baseUrl: 'http://x',
      store,
      mockAuth: true,
      fetch: api.impl,
    });
    await session.loadMe();
    expect(api.calls.map((c) => c.path)).toEqual(['/api/v1/me']);
    expect(api.state.issued).toBe(0);
  });

  it('replaces an expired token exactly once and then succeeds', async () => {
    const api = fakeApi();
    const store = createMemoryTokenStore();
    await store.set('expired');
    const session = createSessionClient({
      baseUrl: 'http://x',
      store,
      mockAuth: true,
      fetch: api.impl,
    });
    await session.loadMe();
    expect(await store.get()).toBe('token-1');
    expect(api.calls.map((c) => c.path)).toEqual([
      '/api/v1/me',
      '/api/v1/auth/mock-token',
      '/api/v1/me',
    ]);
  });

  it('gives up with a readable error instead of looping when a fresh token is also rejected', async () => {
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path.endsWith('mock-token')) {
        return json({ token: 'useless', expiresAt: '2099-01-01T00:00:00.000Z', user: USER });
      }
      return unauthenticated();
    }) as typeof fetch;
    const session = createSessionClient({
      baseUrl: 'http://x',
      store: createMemoryTokenStore(),
      mockAuth: true,
      fetch: impl,
    });
    await expect(session.loadMe()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls.filter((p) => p.endsWith('/me'))).toHaveLength(2);
    expect(calls.filter((p) => p.endsWith('mock-token'))).toHaveLength(2);
  });

  it('does not call the mock-token endpoint when mock auth is off', async () => {
    const api = fakeApi();
    const session = createSessionClient({
      baseUrl: 'http://x',
      store: createMemoryTokenStore(),
      mockAuth: false,
      fetch: api.impl,
    });
    await expect(session.loadMe()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Sign-in is not configured yet.',
    });
    expect(api.calls).toHaveLength(0);
  });

  it('passes other errors through without touching the stored token', async () => {
    const store = createMemoryTokenStore();
    await store.set('keep-me');
    const impl = (async () =>
      json(
        { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', requestId: 'r9' } },
        500,
      )) as typeof fetch;
    const session = createSessionClient({
      baseUrl: 'http://x',
      store,
      mockAuth: true,
      fetch: impl,
    });
    await expect(session.loadMe()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: 'r9',
    });
    expect(await store.get()).toBe('keep-me');
  });
});
