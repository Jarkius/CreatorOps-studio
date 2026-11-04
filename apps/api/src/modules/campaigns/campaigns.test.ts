import { testStorage } from '../../test/storage.js';
import {
  CampaignListResponseSchema,
  CampaignSchema,
  ErrorBodySchema,
  ProductSchema,
  TemplateListResponseSchema,
  type Campaign,
} from '@creatorops/contracts';
import { listTemplates } from '@creatorops/provider-core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { schema } from '../../db/client.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let app: FastifyInstance;
let alice: Person; // owner of workspace A
let bob: Person; // owner of workspace B (a stranger to A)
let viewer: Person;
let reviewer: Person;

async function addMember(person: Person, workspaceId: string, role: string): Promise<void> {
  await testDb.db
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId: person.userId, role });
}

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  app = await buildApp({ config, logger: silent, db: testDb.db, storage: testStorage() });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'viewer');
  reviewer = await createPerson(testDb.db, config.SESSION_SECRET, 'reviewer');
  await addMember(viewer, alice.workspaceId, 'viewer');
  await addMember(reviewer, alice.workspaceId, 'reviewer');
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

const campaignsBase = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/campaigns`;
const productsBase = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/products`;

async function call(
  person: Person | null,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    ...(person ? { headers: { authorization: `Bearer ${person.token}` } } : {}),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function makeProduct(person: Person, name = 'Fan'): Promise<string> {
  const response = await call(person, 'POST', productsBase(person.workspaceId), { name });
  expect(response.statusCode, response.body).toBe(201);
  return ProductSchema.parse(response.json()).id;
}

async function makeCampaign(
  person: Person,
  body: Record<string, unknown>,
  productId?: string,
): Promise<Campaign> {
  const pid = productId ?? (await makeProduct(person));
  const response = await call(person, 'POST', campaignsBase(person.workspaceId), {
    productId: pid,
    templateId: 'product-showcase',
    templateVersion: 1,
    ...body,
  });
  expect(response.statusCode, response.body).toBe(201);
  return CampaignSchema.parse(response.json());
}

describe('create', () => {
  it('stores a Thai name and tone in NFC, trims them and removes control characters', async () => {
    const productId = await makeProduct(alice);
    // Tone mark (U+0E48, combining class 107) typed before the vowel (U+0E38, class 103): NFC reorders.
    const created = await makeCampaign(
      alice,
      {
        name: '  กุ่ น้ำ\u0007  ',
        tone: ' กุ่ สบายๆ Café\u0007 ',
      },
      productId,
    );
    expect(created).toMatchObject({
      name: 'กุ่ น้ำ',
      tone: 'กุ่ สบายๆ Café',
    });

    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, created.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'campaign.create',
      actorUserId: alice.userId,
      workspaceId: alice.workspaceId,
      resourceType: 'campaign',
    });
  });

  it('fills every default: name from the product, template duration, workspace language, draft at version 1', async () => {
    const productId = await makeProduct(alice, 'Desk lamp');
    const response = await call(alice, 'POST', campaignsBase(alice.workspaceId), {
      productId,
      templateId: 'problem-solution',
      templateVersion: 1,
    });
    expect(response.statusCode).toBe(201);
    expect(CampaignSchema.parse(response.json())).toMatchObject({
      workspaceId: alice.workspaceId,
      productId,
      name: 'Desk lamp',
      templateId: 'problem-solution',
      templateVersion: 1,
      language: 'th',
      tone: null,
      platform: 'generic',
      durationSeconds: 45,
      variants: 1,
      status: 'draft',
      version: 1,
    });
  });

  it('uses the workspace default language unless the request names one', async () => {
    const english = await createPerson(testDb.db, config.SESSION_SECRET, 'english');
    await testDb.pool.query("update workspaces set default_language = 'en' where id = $1", [
      english.workspaceId,
    ]);
    const byDefault = await makeCampaign(english, { name: 'A' });
    expect(byDefault.language).toBe('en');
    const explicit = await makeCampaign(english, { name: 'B', language: 'th' });
    expect(explicit.language).toBe('th');
  });

  it('cuts the default name at 120 characters on whole grapheme clusters', async () => {
    // "a" then 60 clusters of ก + ี + ่ (three code points each): 181 code points in 61 clusters.
    // A cut at 120 code points would split a cluster; the name must stop after 39 clusters (118).
    const thai = `a${'กี่'.repeat(60)}`;
    const productId = await makeProduct(alice, thai);
    const cut = await makeCampaign(alice, {}, productId);
    expect(cut.name).toBe(`a${'กี่'.repeat(39)}`);
    expect([...cut.name].length).toBeLessThanOrEqual(120);

    // One cluster longer than 120 code points cannot be cut anywhere: the name falls back.
    const oneCluster = await makeProduct(alice, `ก${'\u0E48'.repeat(130)}`);
    const fallback = await makeCampaign(alice, {}, oneCluster);
    expect(fallback.name).toBe('Campaign');

    const longProduct = await makeProduct(alice, 'x'.repeat(200));
    const long = await makeCampaign(alice, {}, longProduct);
    expect(long.name).toBe('x'.repeat(120));
  });

  it('rejects invalid input with field paths', async () => {
    const productId = await makeProduct(alice);
    const base = { productId, templateId: 'product-showcase', templateVersion: 1 };
    const cases: [Record<string, unknown>, string][] = [
      [{ templateId: 'product-showcase', templateVersion: 1 }, 'productId'],
      [{ ...base, templateVersion: undefined }, 'templateVersion'],
      [{ ...base, templateVersion: 0 }, 'templateVersion'],
      [{ ...base, name: '' }, 'name'],
      [{ ...base, name: '\u0007' }, 'name'],
      [{ ...base, name: 'x'.repeat(121) }, 'name'],
      [{ ...base, language: 'fr' }, 'language'],
      [{ ...base, tone: 'x'.repeat(101) }, 'tone'],
      [{ ...base, platform: 'youtube' }, 'platform'],
      [{ ...base, durationSeconds: 4 }, 'durationSeconds'],
      [{ ...base, durationSeconds: 181 }, 'durationSeconds'],
      [{ ...base, variants: 4 }, 'variants'],
      [{ ...base, variants: 0 }, 'variants'],
    ];
    for (const [payload, path] of cases) {
      const response = await call(alice, 'POST', campaignsBase(alice.workspaceId), payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      const body = ErrorBodySchema.parse(response.json());
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(
        body.error.details?.fields?.some((f) => f.path.startsWith(path)),
        JSON.stringify(payload),
      ).toBe(true);
    }
  });

  it('rejects fields the client must not set', async () => {
    const productId = await makeProduct(alice);
    for (const extra of [
      { workspaceId: bob.workspaceId },
      { status: 'active' },
      { version: 9 },
      { createdBy: bob.userId },
      { id: bob.workspaceId },
    ]) {
      const response = await call(alice, 'POST', campaignsBase(alice.workspaceId), {
        productId,
        templateId: 'product-showcase',
        templateVersion: 1,
        ...extra,
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
    }
  });

  it('answers 400 Product not found for a missing, malformed or another workspace product', async () => {
    const bobsProduct = await makeProduct(bob, 'Bob product');
    const attempts: [Person, string][] = [
      [alice, '00000000-0000-4000-8000-000000000000'],
      [alice, 'nope'],
      [alice, bobsProduct],
      [bob, await makeProduct(alice, 'Alice product')],
    ];
    for (const [person, productId] of attempts) {
      const response = await call(person, 'POST', campaignsBase(person.workspaceId), {
        productId,
        templateId: 'product-showcase',
        templateVersion: 1,
      });
      expect(response.statusCode).toBe(400);
      expect(ErrorBodySchema.parse(response.json()).error.details?.fields).toEqual([
        { path: 'productId', message: 'Product not found' },
      ]);
    }
  });

  it('answers 400 Template not found for an unknown template id or version', async () => {
    const productId = await makeProduct(alice);
    for (const [templateId, templateVersion] of [
      ['unknown', 1],
      ['product-showcase', 2],
    ] as const) {
      const response = await call(alice, 'POST', campaignsBase(alice.workspaceId), {
        productId,
        templateId,
        templateVersion,
      });
      expect(response.statusCode, templateId).toBe(400);
      expect(ErrorBodySchema.parse(response.json()).error.details?.fields).toEqual([
        { path: 'templateId', message: 'Template not found' },
      ]);
    }
  });

  it('refuses a new campaign for an archived product with 409', async () => {
    const productId = await makeProduct(alice, 'Retired');
    const archived = await call(
      alice,
      'POST',
      `${productsBase(alice.workspaceId)}/${productId}/archive`,
    );
    expect(archived.statusCode).toBe(200);
    const response = await call(alice, 'POST', campaignsBase(alice.workspaceId), {
      productId,
      templateId: 'product-showcase',
      templateVersion: 1,
    });
    expect(response.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(response.json()).error).toMatchObject({
      code: 'CONFLICT',
      message: 'Archived products cannot get new campaigns.',
    });
  });

  it('answers 409 Campaign limit reached once a workspace holds 500 campaigns, and writes nothing', async () => {
    const capped = await createPerson(testDb.db, config.SESSION_SECRET, 'capped');
    const productId = await makeProduct(capped, 'Capped product');
    await testDb.pool.query(
      `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
       select $1, $2, 'Bulk ' || g, 'product-showcase', 1, 'th', 30, $3 from generate_series(1, 500) g`,
      [capped.workspaceId, productId, capped.userId],
    );
    const response = await call(capped, 'POST', campaignsBase(capped.workspaceId), {
      productId,
      templateId: 'product-showcase',
      templateVersion: 1,
    });
    expect(response.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(response.json()).error).toMatchObject({
      code: 'CONFLICT',
      message: 'Campaign limit reached.',
    });
    const count = await testDb.pool.query<{ n: number }>(
      'select count(*)::int as n from campaigns where workspace_id = $1',
      [capped.workspaceId],
    );
    expect(count.rows[0]?.n).toBe(500);
    const audits = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, capped.workspaceId));
    expect(audits.filter((event) => event.action === 'campaign.create')).toHaveLength(0);
  });
});

describe('cross-workspace access (IDOR)', () => {
  it("never lets a stranger read or change another workspace's campaign", async () => {
    const secret = await makeCampaign(alice, { name: 'Alice secret' });

    const attempts: [string, 'GET' | 'PATCH', string, unknown][] = [
      ['read via victim ws', 'GET', `${campaignsBase(alice.workspaceId)}/${secret.id}`, undefined],
      [
        'patch via victim ws',
        'PATCH',
        `${campaignsBase(alice.workspaceId)}/${secret.id}`,
        { version: 1, name: 'pwned' },
      ],
      ['read via own ws', 'GET', `${campaignsBase(bob.workspaceId)}/${secret.id}`, undefined],
      [
        'patch via own ws',
        'PATCH',
        `${campaignsBase(bob.workspaceId)}/${secret.id}`,
        { version: 1, name: 'pwned' },
      ],
    ];
    for (const [label, method, url, payload] of attempts) {
      const response = await call(bob, method, url, payload);
      expect(response.statusCode, `${label}: ${response.body}`).toBe(404);
      expect(response.body, label).not.toContain('Alice secret');
    }

    const unchanged = await call(alice, 'GET', `${campaignsBase(alice.workspaceId)}/${secret.id}`);
    expect(CampaignSchema.parse(unchanged.json())).toMatchObject({
      name: 'Alice secret',
      version: 1,
      status: 'draft',
    });
    const theirs = CampaignListResponseSchema.parse(
      (await call(bob, 'GET', campaignsBase(bob.workspaceId))).json(),
    );
    expect(theirs.items.some((item) => item.id === secret.id)).toBe(false);
  });

  it("will not create a campaign in someone else's workspace", async () => {
    const productId = await makeProduct(alice);
    const response = await call(bob, 'POST', campaignsBase(alice.workspaceId), {
      productId,
      templateId: 'product-showcase',
      templateVersion: 1,
    });
    expect(response.statusCode).toBe(404);
  });

  it('answers a stranger identically for a real campaign and one that does not exist', async () => {
    const real = await makeCampaign(alice, { name: 'Real one' });
    const a = await call(bob, 'GET', `${campaignsBase(alice.workspaceId)}/${real.id}`);
    const b = await call(
      bob,
      'GET',
      `${campaignsBase(alice.workspaceId)}/00000000-0000-4000-8000-000000000000`,
    );
    const strip = (text: string) => text.replace(/"requestId":"[^"]+"/, '');
    expect(strip(a.body)).toBe(strip(b.body));
  });
});

describe('read', () => {
  it('returns a campaign, and 404 for unknown or malformed ids', async () => {
    const campaign = await makeCampaign(alice, {});
    expect(
      (await call(alice, 'GET', `${campaignsBase(alice.workspaceId)}/${campaign.id}`)).statusCode,
    ).toBe(200);
    for (const id of [
      '00000000-0000-4000-8000-000000000000',
      'nope',
      "' or 1=1 --",
      '../../etc/passwd',
    ]) {
      const response = await call(
        alice,
        'GET',
        `${campaignsBase(alice.workspaceId)}/${encodeURIComponent(id)}`,
      );
      expect(response.statusCode, id).toBe(404);
    }
  });

  it('lists the workspace templates with their content', async () => {
    const response = await call(viewer, 'GET', `/api/v1/workspaces/${alice.workspaceId}/templates`);
    expect(response.statusCode).toBe(200);
    const body = TemplateListResponseSchema.parse(response.json());
    expect(body.items).toEqual(
      listTemplates().map((template) => ({
        id: template.id,
        version: template.version,
        name: template.name,
        description: template.description,
        defaultDurationSeconds: template.defaultDurationSeconds,
      })),
    );
    expect(body.items.map((item) => [item.id, item.version, item.defaultDurationSeconds])).toEqual([
      ['product-showcase', 1, 30],
      ['problem-solution', 1, 45],
      ['review-style', 1, 45],
    ]);
    expect(body.items[0]?.name.th).toBe('โชว์สินค้า');
    expect(
      (await call(bob, 'GET', `/api/v1/workspaces/${alice.workspaceId}/templates`)).statusCode,
    ).toBe(404);
  });
});

describe('update (PATCH with version)', () => {
  it('bumps the version, refreshes updated_at, clears the tone with null and normalises the name', async () => {
    const campaign = await makeCampaign(alice, { name: 'Before', tone: 'warm' });
    const response = await call(
      alice,
      'PATCH',
      `${campaignsBase(alice.workspaceId)}/${campaign.id}`,
      { version: 1, name: '  กุ่\u0007 After  ', tone: null },
    );
    expect(response.statusCode).toBe(200);
    const updated = CampaignSchema.parse(response.json());
    expect(updated).toMatchObject({ name: 'กุ่ After', tone: null, version: 2 });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(campaign.updatedAt).getTime(),
    );

    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, campaign.id));
    const update = events.find((event) => event.action === 'campaign.update');
    expect(update?.metadata).toEqual({ fields: ['name', 'tone'], version: 2 });
    expect(JSON.stringify(update?.metadata)).not.toContain('After');
  });

  it('answers 409 with the current version when the version is stale, and changes nothing', async () => {
    const campaign = await makeCampaign(alice, { name: 'Original' });
    const url = `${campaignsBase(alice.workspaceId)}/${campaign.id}`;
    await call(alice, 'PATCH', url, { version: 1, name: 'First edit' });
    const stale = await call(alice, 'PATCH', url, { version: 1, name: 'Lost edit' });
    expect(stale.statusCode).toBe(409);
    const body = ErrorBodySchema.parse(stale.json());
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.currentVersion).toBe(2);
    expect(CampaignSchema.parse((await call(alice, 'GET', url)).json()).name).toBe('First edit');
  });

  it('changes status in any direction, one step at a time', async () => {
    const campaign = await makeCampaign(alice, { name: 'Lifecycle' });
    const url = `${campaignsBase(alice.workspaceId)}/${campaign.id}`;
    let version = 1;
    for (const status of ['active', 'archived', 'draft', 'archived'] as const) {
      const response = await call(alice, 'PATCH', url, { version, status });
      expect(response.statusCode, status).toBe(200);
      version += 1;
      expect(CampaignSchema.parse(response.json())).toMatchObject({ status, version });
    }
  });

  it('answers 404, not 409, for a campaign that does not exist or has a malformed id', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'nope']) {
      const response = await call(alice, 'PATCH', `${campaignsBase(alice.workspaceId)}/${id}`, {
        version: 1,
        name: 'x',
      });
      expect(response.statusCode, id).toBe(404);
    }
  });

  it('rejects empty updates, protected fields and invalid values', async () => {
    const campaign = await makeCampaign(alice, { name: 'Strict' });
    const url = `${campaignsBase(alice.workspaceId)}/${campaign.id}`;
    for (const payload of [
      { version: 1 },
      { name: 'x' },
      { version: 1, status: 'deleted' },
      { version: 1, name: 'x', workspaceId: bob.workspaceId },
      { version: 1, name: 'x', productId: campaign.productId },
      { version: 1, name: '' },
      { version: 1, name: '\u0007' },
      { version: 1, name: 'x'.repeat(121) },
      { version: 0, name: 'x' },
    ]) {
      expect((await call(alice, 'PATCH', url, payload)).statusCode, JSON.stringify(payload)).toBe(
        400,
      );
    }
    expect(CampaignSchema.parse((await call(alice, 'GET', url)).json())).toMatchObject({
      name: 'Strict',
      version: 1,
    });
  });
});

describe('pagination', () => {
  it('walks campaigns three pages at a time with limit 1, with and without the status filter', async () => {
    const pager = await createPerson(testDb.db, config.SESSION_SECRET, 'pager');
    const productId = await makeProduct(pager, 'Pager product');
    const drafts: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      drafts.push((await makeCampaign(pager, { name: `Draft ${i}` }, productId)).id);
    }
    const archived = await makeCampaign(pager, { name: 'Archived one' }, productId);
    await call(pager, 'PATCH', `${campaignsBase(pager.workspaceId)}/${archived.id}`, {
      version: 1,
      status: 'archived',
    });

    const walk = async (query: string) => {
      const seen: Campaign[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const suffix = cursor ? `&cursor=${cursor}` : '';
        const page = CampaignListResponseSchema.parse(
          (
            await call(pager, 'GET', `${campaignsBase(pager.workspaceId)}?limit=1${query}${suffix}`)
          ).json(),
        );
        expect(page.items.length).toBeLessThanOrEqual(1);
        seen.push(...page.items);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 10);
      return { seen, pages };
    };

    const filtered = await walk('&status=draft');
    expect(filtered.pages).toBe(3);
    expect(filtered.seen.map((item) => item.id).sort()).toEqual([...drafts].sort());
    expect(filtered.seen.every((item) => item.status === 'draft')).toBe(true);
    expect((await walk('&status=draft')).seen.map((item) => item.id)).toEqual(
      filtered.seen.map((item) => item.id),
    );

    const everything = await walk('');
    expect(everything.pages).toBe(4);
    expect(new Set(everything.seen.map((item) => item.id)).size).toBe(4);
  });

  it('rejects malformed cursors, limits and parameters', async () => {
    const url = campaignsBase(alice.workspaceId);
    const forged = Buffer.from(JSON.stringify({ t: 'not a date', i: 'x' })).toString('base64url');
    for (const query of [
      'cursor=garbage!!',
      `cursor=${forged}`,
      'limit=0',
      'limit=101',
      'limit=abc',
      'status=deleted',
      'workspaceId=x',
    ]) {
      const response = await call(alice, 'GET', `${url}?${query}`);
      expect(response.statusCode, query).toBe(400);
    }
  });
});

describe('roles', () => {
  it('lets viewers and reviewers read but not create or change campaigns', async () => {
    const campaign = await makeCampaign(alice, { name: 'Role test' });
    const url = `${campaignsBase(alice.workspaceId)}/${campaign.id}`;
    const productId = campaign.productId;
    for (const person of [viewer, reviewer]) {
      expect((await call(person, 'GET', url)).statusCode).toBe(200);
      expect((await call(person, 'GET', campaignsBase(alice.workspaceId))).statusCode).toBe(200);
      expect(
        (
          await call(person, 'POST', campaignsBase(alice.workspaceId), {
            productId,
            templateId: 'product-showcase',
            templateVersion: 1,
          })
        ).statusCode,
      ).toBe(403);
      expect((await call(person, 'PATCH', url, { version: 1, name: 'x' })).statusCode).toBe(403);
    }
    expect(CampaignSchema.parse((await call(alice, 'GET', url)).json())).toMatchObject({
      name: 'Role test',
      version: 1,
      status: 'draft',
    });
  });
});

describe('audit', () => {
  it('records one campaign.create event per created campaign', async () => {
    const audited = await createPerson(testDb.db, config.SESSION_SECRET, 'audited');
    const created = await makeCampaign(audited, { name: 'Audited' });
    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, created.id));
    expect(events.map((event) => event.action)).toEqual(['campaign.create']);
    expect(events[0]?.metadata).toEqual({ name: 'Audited' });
  });

  it('records a campaign.update event with field names and version, not values', async () => {
    const audited = await createPerson(testDb.db, config.SESSION_SECRET, 'audit-update');
    const created = await makeCampaign(audited, { name: 'Before change' });
    await call(audited, 'PATCH', `${campaignsBase(audited.workspaceId)}/${created.id}`, {
      version: 1,
      status: 'active',
    });
    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, created.id));
    const update = events.find((event) => event.action === 'campaign.update');
    expect(update).toMatchObject({ actorUserId: audited.userId, workspaceId: audited.workspaceId });
    expect(update?.metadata).toEqual({ fields: ['status'], version: 2 });
  });
});
