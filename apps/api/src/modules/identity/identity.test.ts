import { testStorage } from '../../test/storage.js';
import { ErrorBodySchema, MeResponseSchema, MockTokenResponseSchema } from '@creatorops/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { schema } from '../../db/client.js';
import { seedDevData, type SeedResult } from '../../db/seed.js';
import { loadConfig, type ApiConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createAuthGuard } from './guard.js';
import { resolveWorkspaceContext } from './service.js';
import { signToken, TOKEN_TTL_SECONDS } from './token.js';

const config: ApiConfig = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });
// The Host header a browser sends when it calls the configured API_BASE_URL (http://localhost:3000).
const LOCAL = { host: 'localhost:3000' };

let testDb: TestDb;
let seeded: SeedResult;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  seeded = await seedDevData(testDb.db);
});

afterAll(async () => {
  await testDb.drop();
});

async function app(overrides: Partial<ApiConfig> = {}) {
  return buildApp({
    config: { ...config, ...overrides } as ApiConfig,
    logger: silent,
    db: testDb.db,
    storage: testStorage(),
  });
}

async function mockToken(instance: Awaited<ReturnType<typeof app>>): Promise<string> {
  const response = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/mock-token',
    headers: LOCAL,
  });
  expect(response.statusCode).toBe(200);
  return MockTokenResponseSchema.parse(response.json()).token;
}

describe('mock token endpoint', () => {
  it('issues a verifiable token for the seeded development user only', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/auth/mock-token',
      headers: LOCAL,
    });
    expect(response.statusCode).toBe(200);
    const body = MockTokenResponseSchema.parse(response.json());
    expect(body.user.id).toBe(seeded.userId);
    expect(body.user.email).toBe('dev@creatorops.local');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await instance.close();
  });

  it('does not exist when the auth mode is not mock', async () => {
    const instance = await app({ AUTH_MODE: 'other' } as unknown as Partial<ApiConfig>);
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/auth/mock-token',
      headers: LOCAL,
    });
    expect(response.statusCode).toBe(404);
    ErrorBodySchema.parse(response.json());
    await instance.close();
  });

  it('answers 404 with a hint when the development user has not been seeded', async () => {
    const empty = await createTestDb(requireDatabaseUrl());
    try {
      const instance = await buildApp({
        config,
        logger: silent,
        db: empty.db,
        storage: testStorage(),
      });
      const response = await instance.inject({
        method: 'POST',
        url: '/api/v1/auth/mock-token',
        headers: LOCAL,
      });
      expect(response.statusCode).toBe(404);
      expect(ErrorBodySchema.parse(response.json()).error.message).toContain('pnpm db:seed');
      await instance.close();
    } finally {
      await empty.drop();
    }
  });
});

describe('mock token endpoint host check (DNS rebinding)', () => {
  it('refuses a request whose Host header is not the local API address', async () => {
    const instance = await app();
    for (const host of [
      'evil.example:3000',
      'evil.example',
      'localhost:9999',
      'localhost.evil.example:3000',
      '10.0.0.5:3000',
    ]) {
      const response = await instance.inject({
        method: 'POST',
        url: '/api/v1/auth/mock-token',
        headers: { host },
      });
      expect(response.statusCode, host).toBe(403);
      expect(ErrorBodySchema.parse(response.json()).error.code).toBe('FORBIDDEN');
      expect(response.body).not.toContain('"token"');
    }
    await instance.close();
  });

  it('accepts the other loopback spellings of the same port', async () => {
    const instance = await app();
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST:3000']) {
      const response = await instance.inject({
        method: 'POST',
        url: '/api/v1/auth/mock-token',
        headers: { host },
      });
      expect(response.statusCode, host).toBe(200);
    }
    await instance.close();
  });

  it('only accepts the exact configured host when the API is not on loopback', async () => {
    const instance = await app({ API_BASE_URL: 'https://api.example.com' });
    const ok = await instance.inject({
      method: 'POST',
      url: '/api/v1/auth/mock-token',
      headers: { host: 'api.example.com' },
    });
    const other = await instance.inject({
      method: 'POST',
      url: '/api/v1/auth/mock-token',
      headers: { host: 'localhost:3000' },
    });
    expect(ok.statusCode).toBe(200);
    expect(other.statusCode).toBe(403);
    await instance.close();
  });
});

describe('GET /api/v1/me', () => {
  it('rejects a request without credentials with 401 and a Bearer challenge', async () => {
    const instance = await app();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    const body = ErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
    await instance.close();
  });

  it('returns the signed-in user and their workspaces', async () => {
    const instance = await app();
    const token = await mockToken(instance);
    const response = await instance.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = MeResponseSchema.parse(response.json());
    expect(body.user.id).toBe(seeded.userId);
    expect(body.workspaces).toEqual([
      { id: seeded.workspaceId, name: 'Dev Workspace', role: 'owner' },
    ]);
    await instance.close();
  });

  it('gives the same 401 for every kind of bad credential', async () => {
    const instance = await app();
    const good = await mockToken(instance);
    const now = Math.floor(Date.now() / 1000);
    const expired = signToken(
      { sub: seeded.userId, iat: now - 2 * TOKEN_TTL_SECONDS, exp: now - 10 },
      config.SESSION_SECRET,
    );
    const wrongSecret = signToken(
      { sub: seeded.userId, iat: now, exp: now + 600 },
      'a-different-secret-a-different-secret-0',
    );
    const unknownUser = signToken(
      { sub: '00000000-0000-4000-8000-000000000000', iat: now, exp: now + 600 },
      config.SESSION_SECRET,
    );
    const notAUuid = signToken(
      { sub: 'not-a-uuid', iat: now, exp: now + 600 },
      config.SESSION_SECRET,
    );
    const tampered = `${good.slice(0, -3)}${good.endsWith('abc') ? 'xyz' : 'abc'}`;

    const headers: Record<string, string>[] = [
      { authorization: `Bearer ${expired}` },
      { authorization: `Bearer ${wrongSecret}` },
      { authorization: `Bearer ${unknownUser}` },
      { authorization: `Bearer ${notAUuid}` },
      { authorization: `Bearer ${tampered}` },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' },
      { authorization: 'Bearer not.a.token' },
      { authorization: `Basic ${Buffer.from('dev:dev').toString('base64')}` },
      { authorization: good },
    ];
    const bodies = new Set<string>();
    for (const header of headers) {
      const response = await instance.inject({ method: 'GET', url: '/api/v1/me', headers: header });
      expect(response.statusCode, JSON.stringify(header)).toBe(401);
      const parsed = ErrorBodySchema.parse(response.json());
      bodies.add(`${parsed.error.code}|${parsed.error.message}`);
    }
    expect(bodies.size).toBe(1);
    await instance.close();
  });
});

describe('resolveWorkspaceContext', () => {
  it('returns a context with the membership role for a member', async () => {
    const context = await resolveWorkspaceContext(
      testDb.db,
      seeded.userId,
      seeded.workspaceId,
      'req-1',
    );
    expect(context).toEqual({
      userId: seeded.userId,
      workspaceId: seeded.workspaceId,
      role: 'owner',
      requestId: 'req-1',
    });
  });

  it('brands the canonical id from the database even if the caller used upper case', async () => {
    const context = await resolveWorkspaceContext(
      testDb.db,
      seeded.userId,
      seeded.workspaceId.toUpperCase(),
      'r',
    );
    expect(context?.workspaceId).toBe(seeded.workspaceId);
  });

  it('returns null for a workspace the user is not a member of', async () => {
    const [stranger] = await testDb.db
      .insert(schema.users)
      .values({ email: 'stranger@example.test', displayName: 'Stranger' })
      .returning({ id: schema.users.id });
    const [theirs] = await testDb.db
      .insert(schema.workspaces)
      .values({ name: 'Theirs', ownerUserId: stranger!.id })
      .returning({ id: schema.workspaces.id });
    await testDb.db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: theirs!.id, userId: stranger!.id, role: 'owner' });

    expect(await resolveWorkspaceContext(testDb.db, seeded.userId, theirs!.id, 'r')).toBeNull();
    expect(await resolveWorkspaceContext(testDb.db, stranger!.id, theirs!.id, 'r')).not.toBeNull();
  });

  it('returns null for malformed or unknown ids without touching the database for malformed ones', async () => {
    expect(await resolveWorkspaceContext(testDb.db, seeded.userId, 'nope', 'r')).toBeNull();
    expect(await resolveWorkspaceContext(testDb.db, seeded.userId, "' or 1=1 --", 'r')).toBeNull();
    expect(
      await resolveWorkspaceContext(
        testDb.db,
        seeded.userId,
        '00000000-0000-4000-8000-000000000000',
        'r',
      ),
    ).toBeNull();
  });
});

describe('auth guard on its own', () => {
  // A route that trusts the guard completely and never re-checks request.auth, so these tests
  // prove the guard itself refuses bad credentials rather than relying on a handler.
  async function guardedApp() {
    return buildApp({
      config,
      logger: silent,
      db: testDb.db,
      storage: testStorage(),
      registerRoutes: (instance) => {
        instance.get(
          '/test/guarded',
          { onRequest: createAuthGuard({ db: testDb.db, sessionSecret: config.SESSION_SECRET }) },
          () => ({ ok: true }),
        );
      },
    });
  }

  it('lets a valid token through', async () => {
    const instance = await guardedApp();
    const token = await mockToken(instance);
    const response = await instance.inject({
      method: 'GET',
      url: '/test/guarded',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    await instance.close();
  });

  it('refuses a validly signed token for a user that does not exist', async () => {
    const instance = await guardedApp();
    const now = Math.floor(Date.now() / 1000);
    const ghost = signToken(
      { sub: '00000000-0000-4000-8000-000000000000', iat: now, exp: now + 600 },
      config.SESSION_SECRET,
    );
    const response = await instance.inject({
      method: 'GET',
      url: '/test/guarded',
      headers: { authorization: `Bearer ${ghost}` },
    });
    expect(response.statusCode).toBe(401);
    await instance.close();
  });

  it('refuses missing, malformed, and wrong-scheme credentials', async () => {
    const instance = await guardedApp();
    for (const headers of [
      {},
      { authorization: 'Bearer' },
      { authorization: 'Bearer garbage' },
      { authorization: 'Basic Zm9vOmJhcg==' },
    ]) {
      const response = await instance.inject({ method: 'GET', url: '/test/guarded', headers });
      expect(response.statusCode, JSON.stringify(headers)).toBe(401);
    }
    await instance.close();
  });
});
