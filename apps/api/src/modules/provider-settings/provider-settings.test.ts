import { randomBytes } from 'node:crypto';

import { ProviderCheckResponseSchema, ProviderSettingsSchema } from '@creatorops/contracts';
import type { HttpRequest, HttpResponse, HttpTransport } from '@creatorops/provider-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { decryptSecret, parseSecretsKey } from '../../platform/secrets.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';

const KEY_B64 = randomBytes(32).toString('base64');
const config = loadConfig(validEnv({ SECRETS_ENCRYPTION_KEY: KEY_B64 }));
const configNoKey = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });
const SECRET = 'sk-or-v1-0123456789abcdefSECRETVALUE';
const SECRET2 = 'sk-or-v1-fedcba9876543210OTHERVALUE';

let testDb: TestDb;
let app: FastifyInstance;
let appNoKey: FastifyInstance;
let alice: Person;
let bob: Person;
const members: Record<string, Person> = {};
const sent: HttpRequest[] = [];
let nextStatus = 200;

const transport: HttpTransport = (request) => {
  sent.push(request);
  const response: HttpResponse = {
    status: nextStatus,
    headers: { get: () => null },
    text: () => Promise.resolve('{"data":[]}'),
  };
  return Promise.resolve(response);
};

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  const common = {
    logger: silent,
    db: testDb.db,
    storage: testStorage(),
    rateLimitMax: 100000,
    providerRateLimitMax: 100000,
  };
  app = await buildApp({ config, ...common, providerTransport: transport });
  appNoKey = await buildApp({ config: configNoKey, ...common });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-bob');
  for (const role of ['admin', 'editor', 'reviewer', 'viewer'] as const) {
    members[role] = await createPerson(testDb.db, config.SESSION_SECRET, `ps-${role}`);
    await testDb.pool.query(
      'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
      [alice.workspaceId, members[role]!.userId, role],
    );
  }
});

afterAll(async () => {
  await app.close();
  await appNoKey.close();
  await testDb.drop();
});

const url = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/provider-settings`;
const call = (
  who: Person | null,
  method: 'GET' | 'PUT' | 'DELETE' | 'POST',
  workspaceId: string,
  payload?: unknown,
  suffix = '',
  target: FastifyInstance = app,
) =>
  target.inject({
    method,
    url: url(workspaceId) + suffix,
    headers: who ? { authorization: `Bearer ${who.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const body = (overrides: Record<string, unknown> = {}) => ({
  provider: 'openrouter',
  model: 'vendor/model-x',
  apiKey: SECRET,
  ...overrides,
});

const row = async (workspaceId: string) =>
  (
    await testDb.pool.query('select * from provider_credentials where workspace_id = $1', [
      workspaceId,
    ])
  ).rows[0];

describe('provider settings', () => {
  it('starts as the mock writer, and can store a key only when the server has an encryption key', async () => {
    const response = await call(alice, 'GET', alice.workspaceId);
    expect(response.statusCode).toBe(200);
    expect(ProviderSettingsSchema.parse(response.json())).toMatchObject({
      configured: false,
      source: 'mock',
      canStoreKey: true,
    });
    const without = await call(alice, 'GET', alice.workspaceId, undefined, '', appNoKey);
    expect(without.json()).toMatchObject({ canStoreKey: false });
    const refused = await call(alice, 'PUT', alice.workspaceId, body(), '', appNoKey);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('SECRETS_ENCRYPTION_KEY');
    expect(refused.body).not.toContain(SECRET);
    expect(await row(alice.workspaceId)).toBeUndefined();
  });

  it('saves an encrypted key, returns only its last four, and never writes the key anywhere readable', async () => {
    const response = await call(
      alice,
      'PUT',
      alice.workspaceId,
      body({
        monthlyCapUsd: 25.5,
        pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15, multiplier: 1.3 },
      }),
    );
    expect(response.statusCode, response.body).toBe(200);
    const settings = ProviderSettingsSchema.parse(response.json());
    expect(settings).toMatchObject({
      configured: true,
      source: 'workspace',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'vendor/model-x',
      keyLast4: 'ALUE',
      monthlyCapUsd: 25.5,
      version: 1,
    });
    expect(settings.pricing).toMatchObject({
      inputPerMillionUsd: 3,
      multiplier: 1.3,
      minPerRequestUsd: 0,
    });
    expect(response.body).not.toContain(SECRET);

    const stored = await row(alice.workspaceId);
    expect(stored.key_encrypted).not.toContain(SECRET);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    // The ciphertext opens with the server key and this workspace, and only then.
    const secrets = parseSecretsKey(KEY_B64, 'k1');
    expect(decryptSecret(stored.key_encrypted, secrets, alice.workspaceId)).toBe(SECRET);
    expect(() => decryptSecret(stored.key_encrypted, secrets, bob.workspaceId)).toThrow();

    // Reading again, and the audit trail, never show the key.
    const read = await call(alice, 'GET', alice.workspaceId);
    expect(read.body).not.toContain(SECRET);
    expect(read.json()).toMatchObject({ keyLast4: 'ALUE', model: 'vendor/model-x' });
    const audit = await testDb.pool.query(
      "select metadata::text as m from audit_events where workspace_id = $1 and action like 'provider.%'",
      [alice.workspaceId],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET);
    expect(JSON.stringify(audit.rows)).not.toContain('SECRETVALUE');
  });

  it('lets every member read it but only an owner or admin change it', async () => {
    for (const role of ['admin', 'editor', 'reviewer', 'viewer']) {
      expect((await call(members[role]!, 'GET', alice.workspaceId)).statusCode, role).toBe(200);
    }
    for (const role of ['editor', 'reviewer', 'viewer']) {
      const who = members[role]!;
      expect(
        (await call(who, 'PUT', alice.workspaceId, body({ version: 1 }))).statusCode,
        role,
      ).toBe(403);
      expect((await call(who, 'DELETE', alice.workspaceId)).statusCode, role).toBe(403);
      expect(
        (await call(who, 'POST', alice.workspaceId, undefined, '/check')).statusCode,
        role,
      ).toBe(403);
    }
    const settings = (await call(alice, 'GET', alice.workspaceId)).json() as { version: number };
    const byAdmin = await call(
      members.admin!,
      'PUT',
      alice.workspaceId,
      body({ apiKey: undefined, version: settings.version, model: 'vendor/model-y' }),
    );
    expect(byAdmin.statusCode, byAdmin.body).toBe(200);
    expect(byAdmin.json()).toMatchObject({ model: 'vendor/model-y', version: 2 });
  });

  it('gives a stranger 404 on every route and an unauthenticated caller 401, and never touches another workspace', async () => {
    for (const [method, suffix] of [
      ['GET', ''],
      ['PUT', ''],
      ['DELETE', ''],
      ['POST', '/check'],
    ] as const) {
      expect(
        (await call(bob, method, alice.workspaceId, method === 'PUT' ? body() : undefined, suffix))
          .statusCode,
        method,
      ).toBe(404);
      expect(
        (await call(null, method, alice.workspaceId, undefined, suffix)).statusCode,
        method,
      ).toBe(401);
    }
    const before = await row(alice.workspaceId);
    await call(bob, 'PUT', bob.workspaceId, body({ apiKey: SECRET2 }));
    expect((await row(alice.workspaceId)).key_encrypted).toBe(before.key_encrypted);
    expect((await row(bob.workspaceId)).key_last4).toBe('LUE'.length ? 'ALUE' : '');
    await call(bob, 'DELETE', bob.workspaceId);
    expect(await row(alice.workspaceId)).toBeDefined();
  });

  it('needs the key the first time, the version afterwards, and refuses a stale version with the current one', async () => {
    const carol = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-carol');
    const noKey = await call(carol, 'PUT', carol.workspaceId, body({ apiKey: undefined }));
    expect(noKey.statusCode).toBe(400);
    expect(noKey.body).toContain('apiKey');
    expect((await call(carol, 'PUT', carol.workspaceId, body())).statusCode).toBe(200);
    const noVersion = await call(carol, 'PUT', carol.workspaceId, body({ apiKey: undefined }));
    expect(noVersion.statusCode).toBe(400);
    expect(noVersion.body).toContain('version');
    const ok = await call(carol, 'PUT', carol.workspaceId, body({ apiKey: SECRET2, version: 1 }));
    expect(ok.json()).toMatchObject({ version: 2, keyLast4: 'ALUE' });
    const stale = await call(
      carol,
      'PUT',
      carol.workspaceId,
      body({ apiKey: undefined, version: 1 }),
    );
    expect(stale.statusCode).toBe(409);
    expect(
      (stale.json() as { error: { details: { currentVersion: number } } }).error.details
        .currentVersion,
    ).toBe(2);
  });

  it('keeps the saved key when none is sent, and replaces it when one is', async () => {
    const dana = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-dana');
    await call(dana, 'PUT', dana.workspaceId, body());
    const first = await row(dana.workspaceId);
    await call(
      dana,
      'PUT',
      dana.workspaceId,
      body({ apiKey: undefined, version: 1, model: 'other/model' }),
    );
    const kept = await row(dana.workspaceId);
    expect(kept.key_encrypted).toBe(first.key_encrypted);
    expect(kept.model).toBe('other/model');
    await call(dana, 'PUT', dana.workspaceId, body({ apiKey: SECRET2, version: 2 }));
    const replaced = await row(dana.workspaceId);
    expect(replaced.key_encrypted).not.toBe(first.key_encrypted);
    expect(
      decryptSecret(replaced.key_encrypted, parseSecretsKey(KEY_B64, 'k1'), dana.workspaceId),
    ).toBe(SECRET2);
  });

  it('validates the address, model, key shape, prices and limit', async () => {
    const erin = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-erin');
    const bad: Record<string, unknown>[] = [
      { provider: 'custom' },
      { provider: 'custom', baseUrl: 'http://gateway.example.com/v1' },
      { provider: 'custom', baseUrl: 'https://169.254.169.254/v1' },
      { provider: 'custom', baseUrl: 'https://localhost/v1' },
      { baseUrl: 'https://evil.example.com/v1' },
      { model: '' },
      { apiKey: 'short' },
      { apiKey: 'has a space in it' },
      { monthlyCapUsd: -1 },
      { pricing: { inputPerMillionUsd: -1, outputPerMillionUsd: 1 } },
      { extra: 1 },
    ];
    for (const overrides of bad) {
      const response = await call(erin, 'PUT', erin.workspaceId, body(overrides));
      expect(response.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(response.body).not.toContain(SECRET);
    }
    const custom = await call(
      erin,
      'PUT',
      erin.workspaceId,
      body({ provider: 'custom', baseUrl: 'https://gateway.example.com/v1' }),
    );
    expect(custom.json()).toMatchObject({
      provider: 'custom',
      baseUrl: 'https://gateway.example.com/v1',
    });
  });

  it('removes the saved provider, and removing twice is harmless', async () => {
    const finn = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-finn');
    await call(finn, 'PUT', finn.workspaceId, body());
    const gone = await call(finn, 'DELETE', finn.workspaceId);
    expect(gone.json()).toMatchObject({ configured: false, source: 'mock' });
    expect(await row(finn.workspaceId)).toBeUndefined();
    expect((await call(finn, 'DELETE', finn.workspaceId)).statusCode).toBe(200);
  });
});

describe('check connection', () => {
  it('says nothing is saved, then makes one GET to /models with the key and no body', async () => {
    const gina = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-gina');
    const none = await call(gina, 'POST', gina.workspaceId, undefined, '/check');
    expect(ProviderCheckResponseSchema.parse(none.json())).toMatchObject({
      ok: false,
      code: 'NOT_CONFIGURED',
    });
    await call(gina, 'PUT', gina.workspaceId, body());
    sent.length = 0;
    nextStatus = 200;
    const ok = await call(gina, 'POST', gina.workspaceId, undefined, '/check');
    expect(ok.json()).toMatchObject({ ok: true, code: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'GET', url: 'https://openrouter.ai/api/v1/models' });
    expect(sent[0]!.body).toBeUndefined();
    expect(sent[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(ok.body).not.toContain(SECRET);
  });

  it('shows a stable code and plain sentence for a rejected key and an unreachable provider', async () => {
    const hank = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-hank');
    await call(hank, 'PUT', hank.workspaceId, body());
    nextStatus = 401;
    const bad = await call(hank, 'POST', hank.workspaceId, undefined, '/check');
    expect(bad.json()).toMatchObject({
      ok: false,
      code: 'AUTH_FAILED',
      message: 'The provider did not accept the key.',
    });
    nextStatus = 503;
    expect((await call(hank, 'POST', hank.workspaceId, undefined, '/check')).json()).toMatchObject({
      code: 'UNREACHABLE',
    });
    nextStatus = 200;
    const audit = await testDb.pool.query(
      "select metadata::text as m from audit_events where workspace_id = $1 and action = 'provider.settings_checked'",
      [hank.workspaceId],
    );
    expect(audit.rowCount).toBe(2);
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET);
  });

  it('says the key cannot be opened when the server key is different, and still never leaks it', async () => {
    const ivy = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-ivy');
    await call(ivy, 'PUT', ivy.workspaceId, body());
    const other = await buildApp({
      config: loadConfig(validEnv({ SECRETS_ENCRYPTION_KEY: randomBytes(32).toString('base64') })),
      logger: silent,
      db: testDb.db,
      storage: testStorage(),
      providerTransport: transport,
    });
    try {
      const response = await call(ivy, 'POST', ivy.workspaceId, undefined, '/check', other);
      expect(response.json()).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
      expect(response.body).not.toContain(SECRET);
    } finally {
      await other.close();
    }
  });
});

describe('rate limits', () => {
  it('limits saving to 20 a minute and checking to 10 a minute per client', async () => {
    const limited = await buildApp({
      config,
      logger: silent,
      db: testDb.db,
      storage: testStorage(),
      rateLimitMax: 100000,
      providerTransport: transport,
    });
    try {
      const jo = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-jo');
      const codes: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        codes.push(
          (await call(jo, 'PUT', jo.workspaceId, body({ model: 'bad model' }), '', limited))
            .statusCode,
        );
      }
      expect(codes.slice(0, 20).every((code) => code === 200 || code === 400 || code === 409)).toBe(
        true,
      );
      expect(codes[20]).toBe(429);
      const kay = await createPerson(testDb.db, config.SESSION_SECRET, 'ps-kay');
      const checks: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        checks.push(
          (await call(kay, 'POST', kay.workspaceId, undefined, '/check', limited)).statusCode,
        );
      }
      expect(checks[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
