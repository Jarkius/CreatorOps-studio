import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createAuthGuard } from './modules/identity/guard.js';
import { loadConfig } from './platform/config.js';
import { createLogger } from './platform/logger.js';
import { runAuthorizationHarness, type HarnessFixtures } from './test/authorization-harness.js';
import { requireDatabaseUrl, validEnv } from './test/db-url.js';
import { createPerson, type Person } from './test/people.js';
import { createTestDb, type TestDb } from './test/test-db.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let victim: Person;
let attacker: Person;
let fixtures: HarnessFixtures;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  victim = await createPerson(testDb.db, config.SESSION_SECRET, 'victim');
  attacker = await createPerson(testDb.db, config.SESSION_SECRET, 'attacker');
  fixtures = {
    foreignParams: { workspaceId: victim.workspaceId },
    // Routes without path parameters that act only on the caller's own data. Adding a route
    // here is a review decision: it must not touch anyone else's data.
    selfScoped: new Set(['GET /api/v1/me', 'GET /api/v1/workspaces', 'POST /api/v1/workspaces']),
  };
});

afterAll(async () => {
  await testDb.drop();
});

describe('authorization harness over every registered route', () => {
  it('denies a stranger on every route: 401 without a token, 404 for another workspace', async () => {
    const app = await buildApp({ config, logger: silent, db: testDb.db });
    const report = await runAuthorizationHarness(app, attacker.token, fixtures);
    expect(report.failures).toEqual([]);
    // Guards against a harness that silently checks nothing.
    expect(report.checked).toEqual(
      expect.arrayContaining([
        'GET /api/v1/me',
        'GET /api/v1/workspaces',
        'GET /api/v1/workspaces/:workspaceId',
      ]),
    );
    expect(report.checked.length).toBeGreaterThanOrEqual(4);
    await app.close();
  });

  it('actually catches a route that leaks another workspace (the harness can fail)', async () => {
    const guard = createAuthGuard({ db: testDb.db, sessionSecret: config.SESSION_SECRET });
    const app = await buildApp({
      config,
      logger: silent,
      db: testDb.db,
      registerRoutes: (instance) => {
        // Guarded, but returns 200 for any workspace id: the bug the harness exists to find.
        instance.get('/api/v1/leaky/:workspaceId', { onRequest: guard }, () => ({ leaked: true }));
      },
    });
    const report = await runAuthorizationHarness(app, attacker.token, fixtures);
    expect(report.failures.join('\n')).toContain('GET /api/v1/leaky/:workspaceId: expected 404');
    await app.close();
  });

  it('fails when a new parameterised route has no fixture', async () => {
    const guard = createAuthGuard({ db: testDb.db, sessionSecret: config.SESSION_SECRET });
    const app = await buildApp({
      config,
      logger: silent,
      db: testDb.db,
      registerRoutes: (instance) => {
        instance.get('/api/v1/things/:thingId', { onRequest: guard }, () => ({}));
      },
    });
    const report = await runAuthorizationHarness(app, attacker.token, fixtures);
    expect(report.failures.join('\n')).toContain('no foreign fixture for parameters thingId');
    await app.close();
  });

  it('fails when a route without parameters has not been declared self-scoped', async () => {
    const guard = createAuthGuard({ db: testDb.db, sessionSecret: config.SESSION_SECRET });
    const app = await buildApp({
      config,
      logger: silent,
      db: testDb.db,
      registerRoutes: (instance) => {
        instance.get('/api/v1/everything', { onRequest: guard }, () => ({}));
      },
    });
    const report = await runAuthorizationHarness(app, attacker.token, fixtures);
    expect(report.failures.join('\n')).toContain('not declared selfScoped');
    await app.close();
  });

  it('proves the attacker really is a valid, authenticated user', async () => {
    const app = await buildApp({ config, logger: silent, db: testDb.db });
    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${attacker.workspaceId}`,
      headers: { authorization: `Bearer ${attacker.token}` },
    });
    expect(own.statusCode).toBe(200);
    await app.close();
  });
});
