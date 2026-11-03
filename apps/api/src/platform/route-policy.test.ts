import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { createAuthGuard } from '../modules/identity/guard.js';
import { createWorkspaceScope } from '../modules/identity/scope.js';
import { makeApp } from '../test/app-helpers.js';
import { loadConfig } from './config.js';
import { PUBLIC_ROUTES } from './route-policy.js';
import { validEnv } from '../test/db-url.js';
import { createDb } from '../db/client.js';
import pg from 'pg';

const config = loadConfig(validEnv());
// A pool opens no connection until used; these tests only inspect route registration.
const db = createDb(new pg.Pool({ connectionString: config.DATABASE_URL }));
const guard = createAuthGuard({ db, sessionSecret: config.SESSION_SECRET });
const scope = createWorkspaceScope({ db });

describe('route policy (secure by default)', () => {
  it('refuses to start when an /api/v1 route is neither public nor guarded', async () => {
    await expect(
      makeApp({
        registerRoutes: (app: FastifyInstance) => {
          app.get('/api/v1/forgot-the-guard', () => ({ secret: 'data' }));
        },
      }),
    ).rejects.toThrow(/GET \/api\/v1\/forgot-the-guard.*auth guard/);
  });

  it('refuses a /workspaces/:workspaceId route that has the guard but no workspace scope', async () => {
    await expect(
      makeApp({
        registerRoutes: (app: FastifyInstance) => {
          app.get('/api/v1/workspaces/:workspaceId/things', { onRequest: guard }, () => ({}));
        },
      }),
    ).rejects.toThrow(/workspace scope/);
  });

  it('accepts guarded routes, and guarded plus scoped workspace routes', async () => {
    const { app } = await makeApp({
      registerRoutes: (instance: FastifyInstance) => {
        instance.get('/api/v1/guarded', { onRequest: guard }, () => ({}));
        instance.get(
          '/api/v1/workspaces/:workspaceId/things',
          { onRequest: guard, preValidation: scope },
          () => ({}),
        );
      },
    });
    const keys = app.registeredRoutes.map((route) => `${route.method} ${route.url}`);
    expect(keys).toContain('GET /api/v1/guarded');
    expect(keys).toContain('GET /api/v1/workspaces/:workspaceId/things');
    await app.close();
  });

  it('ignores routes outside /api/v1 (such as test-only routes)', async () => {
    const { app } = await makeApp({
      registerRoutes: (instance: FastifyInstance) => {
        instance.get('/test/open', () => ({}));
      },
    });
    expect(app.registeredRoutes.some((route) => route.url === '/test/open')).toBe(false);
    await app.close();
  });

  it('marks exactly the allow-listed routes as public', async () => {
    const { app } = await makeApp();
    const publicKeys = app.registeredRoutes
      .filter((route) => route.isPublic)
      .map((route) => `${route.method} ${route.url}`)
      .sort();
    expect(publicKeys).toEqual([...PUBLIC_ROUTES].sort());
    await app.close();
  });

  it('records no HEAD twins and flags workspace-scoped routes', async () => {
    const { app } = await makeApp();
    expect(app.registeredRoutes.some((route) => route.method === 'HEAD')).toBe(false);
    const scoped = app.registeredRoutes
      .filter((route) => route.isWorkspaceScoped)
      .map((route) => route.url);
    expect(scoped).toContain('/api/v1/workspaces/:workspaceId');
    await app.close();
  });
});
