import { DraftAssetListResponseSchema } from '@creatorops/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let app: FastifyInstance;
let alice: Person; // owner of workspace A
let bob: Person; // owner of workspace B
let viewer: Person;
let reviewer: Person;
let editor: Person;
let counter = 0;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  app = await buildApp({
    config,
    logger: silent,
    db: testDb.db,
    storage: testStorage(),
    rateLimitMax: 100000,
  });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'viewer');
  reviewer = await createPerson(testDb.db, config.SESSION_SECRET, 'reviewer');
  editor = await createPerson(testDb.db, config.SESSION_SECRET, 'editor');
  for (const [person, role] of [
    [viewer, 'viewer'],
    [reviewer, 'reviewer'],
    [editor, 'editor'],
  ] as const) {
    await testDb.pool.query(
      'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
      [alice.workspaceId, person.userId, role],
    );
  }
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

async function one(sql: string, values: unknown[]): Promise<string> {
  return (await testDb.pool.query<{ id: string }>(sql, values)).rows[0]!.id;
}

const newProduct = (person: Person) =>
  one('insert into products (workspace_id, name) values ($1, $2) returning id', [
    person.workspaceId,
    'P',
  ]);

async function newDraft(person: Person, productId?: string) {
  const product = productId ?? (await newProduct(person));
  const campaign = await one(
    `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
     values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
    [person.workspaceId, product, person.userId],
  );
  const draft = await one(
    `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state)
     values ($1, $2, $3, '{}', '{}') returning id`,
    [person.workspaceId, campaign, product],
  );
  return { draft, product };
}

function newAsset(
  person: Person,
  options: { productId?: string | null; type?: 'image' | 'video'; status?: string } = {},
) {
  counter += 1;
  const video = options.type === 'video';
  return one(
    `insert into assets (workspace_id, product_id, type, status, mime_type, size_bytes, original_filename, sha256, storage_key, created_by, deleted_at)
     values ($1, $2, $3, $4, $5, 10, $6, repeat('a', 64), $7, $8, $9) returning id`,
    [
      person.workspaceId,
      options.productId ?? null,
      video ? 'video' : 'image',
      options.status ?? 'ready',
      video ? 'video/mp4' : 'image/png',
      video ? 'clip.mp4' : 'a.png',
      `ws/${person.workspaceId}/${counter}-${Math.random().toString(36).slice(2)}/original`,
      person.userId,
      options.status === 'deleted' ? new Date() : null,
    ],
  );
}

const url = (person: Person, draftId: string) =>
  `/api/v1/workspaces/${person.workspaceId}/drafts/${draftId}/assets`;

const call = (person: Person | null, method: 'GET' | 'PUT', path: string, payload?: unknown) =>
  app.inject({
    method,
    url: path,
    headers: person ? { authorization: `Bearer ${person.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const put = (person: Person | null, draftId: string, assets: unknown[], owner: Person = alice) =>
  call(person, 'PUT', url(owner, draftId), { assets });

const ids = (response: { json: () => unknown }) =>
  DraftAssetListResponseSchema.parse(response.json()).items.map((item) => item.assetId);

describe('attaching files to a draft', () => {
  it('starts empty, then holds the ordered list with role, scene and AI label, signed URLs included', async () => {
    const { draft, product } = await newDraft(alice);
    expect(ids(await call(alice, 'GET', url(alice, draft)))).toEqual([]);

    const [a, b, c] = [
      await newAsset(alice, { productId: product }),
      await newAsset(alice, { type: 'video' }),
      await newAsset(alice),
    ];
    const response = await put(alice, draft, [
      { assetId: b, scene: 'usage', aiGenerated: true, generator: 'Meta AI' },
      { assetId: a, role: 'cover', scene: 'product_hero' },
      { assetId: c },
    ]);
    expect(response.statusCode, response.body).toBe(200);
    const items = DraftAssetListResponseSchema.parse(response.json()).items;
    expect(items.map((item) => item.assetId)).toEqual([b, a, c]);
    expect(items.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
    expect(items.map((item) => item.role)).toEqual(['media', 'cover', 'media']);
    expect(items.map((item) => item.scene)).toEqual(['usage', 'product_hero', null]);
    expect(items[0]).toMatchObject({ aiGenerated: true, generator: 'Meta AI' });
    expect(items[1]).toMatchObject({ aiGenerated: false, generator: null });
    expect(items[0]?.asset.type).toBe('video');
    expect(items[0]?.asset.url).toContain('sig=');

    // The same call again changes nothing (repeatable), and a shorter list detaches the rest.
    const again = await put(alice, draft, [
      { assetId: b, scene: 'usage', aiGenerated: true, generator: 'Meta AI' },
      { assetId: a, role: 'cover', scene: 'product_hero' },
      { assetId: c },
    ]);
    expect(ids(again)).toEqual([b, a, c]);
    expect(ids(await put(alice, draft, [{ assetId: c }]))).toEqual([c]);
    expect(ids(await put(alice, draft, []))).toEqual([]);
  });

  it('refuses a file that is missing, malformed, deleted, from another workspace or from another product, all alike', async () => {
    const { draft } = await newDraft(alice);
    const otherProduct = await newProduct(alice);
    const bobAsset = await newAsset(bob);
    const deleted = await newAsset(alice, { status: 'deleted' });
    const foreignProduct = await newAsset(alice, { productId: otherProduct });
    const missing = '00000000-0000-4000-8000-000000000000';
    const bodies = new Set<string>();
    for (const assetId of [missing, 'not-a-uuid', bobAsset, deleted, foreignProduct]) {
      const response = await put(alice, draft, [{ assetId }]);
      expect(response.statusCode, assetId).toBe(400);
      bodies.add(
        JSON.stringify((response.json() as { error: unknown }).error).replace(
          /"requestId":"[^"]*"/,
          '',
        ),
      );
    }
    expect(bodies.size).toBe(1);
    // Nothing was attached by the refused calls.
    expect(ids(await call(alice, 'GET', url(alice, draft)))).toEqual([]);
  });

  it('refuses a body that breaks the contract: two covers, a repeat, more than ten, an unknown scene', async () => {
    const { draft } = await newDraft(alice);
    const [a, b] = [await newAsset(alice), await newAsset(alice)];
    const many = await Promise.all(Array.from({ length: 11 }, () => newAsset(alice)));
    for (const assets of [
      [
        { assetId: a, role: 'cover' },
        { assetId: b, role: 'cover' },
      ],
      [{ assetId: a }, { assetId: a.toUpperCase() }],
      many.map((assetId) => ({ assetId })),
      [{ assetId: a, scene: 'intro' }],
      [{ assetId: a, generator: 'x'.repeat(61) }],
    ]) {
      expect(
        (await put(alice, draft, assets)).statusCode,
        JSON.stringify(assets).slice(0, 80),
      ).toBe(400);
    }
  });

  it('answers 404 for a missing or malformed draft and for a draft of another workspace', async () => {
    const mine = await newAsset(alice);
    const theirs = await newDraft(bob);
    for (const draftId of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', theirs.draft]) {
      expect((await put(alice, draftId, [{ assetId: mine }])).statusCode, draftId).toBe(404);
      expect((await call(alice, 'GET', url(alice, draftId))).statusCode, draftId).toBe(404);
    }
    // And Bob cannot reach Alice's draft through his own workspace.
    const { draft } = await newDraft(alice);
    expect((await call(bob, 'GET', url(bob, draft))).statusCode).toBe(404);
    expect((await put(bob, draft, [], bob)).statusCode).toBe(404);
    // Another workspace id in the URL is refused before anything else.
    expect((await call(bob, 'GET', url(alice, draft))).statusCode).toBe(404);
  });

  it('lets owner and editor change attachments, lets every member read, and refuses viewer and reviewer with 403', async () => {
    const { draft } = await newDraft(alice);
    const asset = await newAsset(alice);
    expect((await put(editor, draft, [{ assetId: asset }])).statusCode).toBe(200);
    for (const person of [viewer, reviewer]) {
      const refused = await put(person, draft, []);
      expect(refused.statusCode).toBe(403);
      expect(ids(await call(person, 'GET', url(alice, draft)))).toEqual([asset]);
    }
    expect(ids(await call(alice, 'GET', url(alice, draft)))).toEqual([asset]);
    expect((await put(null, draft, [])).statusCode).toBe(401);
  });

  it('removes a deleted file from every draft, hides it, and lets the later purge succeed', async () => {
    const one1 = await newDraft(alice);
    const two = await newDraft(alice);
    const keep = await newAsset(alice);
    const gone = await newAsset(alice);
    await put(alice, one1.draft, [{ assetId: gone }, { assetId: keep }]);
    await put(alice, two.draft, [{ assetId: gone }]);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${alice.workspaceId}/assets/${gone}`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(ids(await call(alice, 'GET', url(alice, one1.draft)))).toEqual([keep]);
    expect(ids(await call(alice, 'GET', url(alice, two.draft)))).toEqual([]);
    const links = await testDb.pool.query('select 1 from draft_assets where asset_id = $1', [gone]);
    expect(links.rowCount).toBe(0);
    // With no link left, a hard delete (the purge) is not blocked by the foreign key.
    await expect(
      testDb.pool.query('delete from assets where id = $1', [gone]),
    ).resolves.toBeDefined();
  });

  it('records an audit event without file names or URLs', async () => {
    const { draft } = await newDraft(alice);
    const asset = await newAsset(alice);
    await put(alice, draft, [{ assetId: asset, aiGenerated: true, generator: 'Meta AI' }]);
    const rows = await testDb.pool.query<{ metadata: Record<string, unknown> }>(
      `select metadata from audit_events where action = 'draft.assets.updated' and resource_id = $1`,
      [draft],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.metadata).toEqual({ count: 1, hasCover: false, aiGenerated: 1 });
  });
});
