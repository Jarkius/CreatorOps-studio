import { testStorage } from './test/storage.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { schema } from './db/client.js';
import { createAuthGuard } from './modules/identity/guard.js';
import { loadConfig } from './platform/config.js';
import { createLogger } from './platform/logger.js';
import {
  runAuthorizationHarness,
  runReadOnlyMemberHarness,
  type HarnessFixtures,
} from './test/authorization-harness.js';
import { requireDatabaseUrl, validEnv } from './test/db-url.js';
import { createPerson, type Person } from './test/people.js';
import { createTestDb, type TestDb } from './test/test-db.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let victim: Person;
let attacker: Person;
let fixtures: HarnessFixtures;
let victimProductId: string;
let victimAssetId: string;
let victimCampaignId: string;
let victimJobId: string;
let victimDraftId: string;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  victim = await createPerson(testDb.db, config.SESSION_SECRET, 'victim');
  attacker = await createPerson(testDb.db, config.SESSION_SECRET, 'attacker');
  const [product] = await testDb.db
    .insert(schema.products)
    .values({ workspaceId: victim.workspaceId, name: 'Victim product' })
    .returning({ id: schema.products.id });
  victimProductId = product?.id ?? '';
  const asset = await testDb.pool.query<{ id: string }>(
    `insert into assets (workspace_id, type, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
     values ($1, 'image', 'image/png', 10, 'v.png', repeat('c', 64), 'ws/x/y/original.png', $2) returning id`,
    [victim.workspaceId, victim.userId],
  );
  victimAssetId = asset.rows[0]?.id ?? '';
  const [campaign] = await testDb.db
    .insert(schema.campaigns)
    .values({
      workspaceId: victim.workspaceId,
      productId: victimProductId,
      name: 'Victim campaign',
      templateId: 'product-showcase',
      templateVersion: 1,
      language: 'th',
      durationSeconds: 30,
      createdBy: victim.userId,
    })
    .returning({ id: schema.campaigns.id });
  victimCampaignId = campaign?.id ?? '';
  const job = await testDb.pool.query<{ id: string }>(
    `insert into jobs (workspace_id, type, input, created_by, idempotency_key, request_hash, campaign_id)
     values ($1, 'generate_brief', '{}'::jsonb, $2, 'victim-key-12345678', repeat('d', 64), $3) returning id`,
    [victim.workspaceId, victim.userId, victimCampaignId],
  );
  victimJobId = job.rows[0]?.id ?? '';
  const [draft] = await testDb.db
    .insert(schema.contentDrafts)
    .values({
      workspaceId: victim.workspaceId,
      campaignId: victimCampaignId,
      productId: victimProductId,
      sections: {
        title: 'Victim draft',
        hook: 'Hook',
        script: 'Script',
        storyboard: ['Scene'],
        caption: 'Caption',
        hashtags: ['#a'],
        callToAction: 'Buy',
      },
      sectionState: Object.fromEntries(
        ['title', 'hook', 'script', 'storyboard', 'caption', 'hashtags', 'callToAction'].map(
          (name) => [name, { rev: 1, origin: 'generated', jobId: null }],
        ),
      ),
    })
    .returning({ id: schema.contentDrafts.id });
  victimDraftId = draft?.id ?? '';
  fixtures = {
    foreignParams: {
      workspaceId: victim.workspaceId,
      productId: victimProductId,
      assetId: victimAssetId,
      campaignId: victimCampaignId,
      jobId: victimJobId,
      draftId: victimDraftId,
    },
    // Valid sample bodies, so a route that validates before it authorises would show up as 400.
    bodies: {
      'POST /api/v1/workspaces/:workspaceId/products': { name: 'Planted' },
      'PATCH /api/v1/workspaces/:workspaceId/products/:productId': { version: 1, name: 'Pwned' },
      'POST /api/v1/workspaces/:workspaceId/campaigns': {
        productId: victimProductId,
        templateId: 'product-showcase',
        templateVersion: 1,
      },
      'POST /api/v1/workspaces/:workspaceId/jobs/generate-brief': { campaignId: victimCampaignId },
      'POST /api/v1/workspaces/:workspaceId/jobs/regenerate-section': {
        draftId: victimDraftId,
        section: 'hook',
        expectedRev: 1,
      },
      'POST /api/v1/workspaces/:workspaceId/jobs/export-package': {
        draftId: victimDraftId,
        draftVersion: 1,
      },
      'PATCH /api/v1/workspaces/:workspaceId/drafts/:draftId': {
        version: 1,
        sections: { hook: 'Pwned' },
      },
      'PUT /api/v1/workspaces/:workspaceId/drafts/:draftId/assets': { assets: [] },
      'PATCH /api/v1/workspaces/:workspaceId/campaigns/:campaignId': {
        version: 1,
        name: 'Pwned',
      },
      'POST /api/v1/workspaces/:workspaceId/assets/upload-intent': {
        filename: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 10,
      },
      'POST /api/v1/workspaces/:workspaceId/assets/complete-upload': {
        intentId: '00000000-0000-4000-8000-000000000000',
      },
    },
    // Routes without path parameters that act only on the caller's own data. Adding a route
    // here is a review decision: it must not touch anyone else's data.
    selfScoped: new Set(['GET /api/v1/me', 'GET /api/v1/workspaces', 'POST /api/v1/workspaces']),
  };
});

afterAll(async () => {
  await testDb.drop();
});

describe('read-only members over every write route', () => {
  it.each(['viewer', 'reviewer'])(
    'a %s gets 403 on every write route, and nothing changes',
    async (role) => {
      const member = await createPerson(testDb.db, config.SESSION_SECRET, `member-${role}`);
      await testDb.pool.query(
        `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`,
        [victim.workspaceId, member.userId, role],
      );
      const app = await buildApp({ config, logger: silent, db: testDb.db, storage: testStorage() });
      const report = await runReadOnlyMemberHarness(app, member.token, {
        ownParams: fixtures.foreignParams,
        bodies: fixtures.bodies,
      });
      expect(report.failures).toEqual([]);
      expect(report.checked).toEqual(
        expect.arrayContaining([
          'POST /api/v1/workspaces/:workspaceId/products',
          'PATCH /api/v1/workspaces/:workspaceId/products/:productId',
          'POST /api/v1/workspaces/:workspaceId/assets/upload-intent',
        ]),
      );
      expect(report.checked.length).toBeGreaterThanOrEqual(6);
      // The viewer can still read.
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${victim.workspaceId}/products`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      expect(read.statusCode).toBe(200);
      await app.close();
    },
  );
});

describe('authorization harness over every registered route', () => {
  it('denies a stranger on every route: 401 without a token, 404 for another workspace', async () => {
    const app = await buildApp({ config, logger: silent, db: testDb.db, storage: testStorage() });
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
      storage: testStorage(),
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
      storage: testStorage(),
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
      storage: testStorage(),
      registerRoutes: (instance) => {
        instance.get('/api/v1/everything', { onRequest: guard }, () => ({}));
      },
    });
    const report = await runAuthorizationHarness(app, attacker.token, fixtures);
    expect(report.failures.join('\n')).toContain('not declared selfScoped');
    await app.close();
  });

  it('proves the attacker really is a valid, authenticated user', async () => {
    const app = await buildApp({ config, logger: silent, db: testDb.db, storage: testStorage() });
    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${attacker.workspaceId}`,
      headers: { authorization: `Bearer ${attacker.token}` },
    });
    expect(own.statusCode).toBe(200);
    await app.close();
  });
});
