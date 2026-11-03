import { ErrorBodySchema, ProductListResponseSchema, ProductSchema } from '@creatorops/contracts';
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
import { createProduct } from './service.js';
import { resolveWorkspaceContext } from '../identity/service.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let app: FastifyInstance;
let alice: Person; // owner of workspace A
let bob: Person; // owner of workspace B (a stranger to A)
let viewer: Person;
let reviewer: Person;
let editor: Person;

async function addMember(person: Person, workspaceId: string, role: string): Promise<void> {
  await testDb.db
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId: person.userId, role });
}

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  app = await buildApp({ config, logger: silent, db: testDb.db });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'viewer');
  reviewer = await createPerson(testDb.db, config.SESSION_SECRET, 'reviewer');
  editor = await createPerson(testDb.db, config.SESSION_SECRET, 'editor');
  await addMember(viewer, alice.workspaceId, 'viewer');
  await addMember(reviewer, alice.workspaceId, 'reviewer');
  await addMember(editor, alice.workspaceId, 'editor');
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

const base = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/products`;

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

async function makeProduct(person: Person, body: Record<string, unknown> = { name: 'Fan' }) {
  const response = await call(person, 'POST', base(person.workspaceId), body);
  expect(response.statusCode, response.body).toBe(201);
  return ProductSchema.parse(response.json());
}

describe('create', () => {
  it('creates an active product at version 1 with normalised text and an audit event', async () => {
    const decomposed = 'พั้ดลม'.normalize('NFD');
    const response = await call(alice, 'POST', base(alice.workspaceId), {
      name: `  ${decomposed}\u0007  `,
      description: 'Line one\nLine two\u0000',
      sourceUrl: ' https://Shop.Example.com/p/1 ',
      priceAmount: '199.50',
      currency: 'THB',
      sellingPoints: ['  เงียบ  ', 'ประหยัดไฟ'],
      targetAudience: '   ',
      restrictedClaims: ['ห้ามอ้างว่ารักษาโรค'],
    });
    expect(response.statusCode).toBe(201);
    const product = ProductSchema.parse(response.json());
    expect(product).toMatchObject({
      workspaceId: alice.workspaceId,
      name: decomposed.normalize('NFC'),
      description: 'Line one\nLine two',
      sourceUrl: 'https://shop.example.com/p/1',
      priceAmount: '199.50',
      currency: 'THB',
      sellingPoints: ['เงียบ', 'ประหยัดไฟ'],
      targetAudience: null,
      restrictedClaims: ['ห้ามอ้างว่ารักษาโรค'],
      status: 'active',
      version: 1,
      archivedAt: null,
      primaryAssetId: null,
    });

    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, product.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'product.created',
      actorUserId: alice.userId,
      workspaceId: alice.workspaceId,
    });
  });

  it('reports invalid input with field paths', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: '' }, 'name'],
      [{ name: 'x', sourceUrl: 'javascript:alert(1)' }, 'sourceUrl'],
      [{ name: 'x', priceAmount: '5' }, 'currency'],
      [{ name: 'x', sellingPoints: ['\u0007'] }, 'sellingPoints'],
      [{ name: 'x', sellingPoints: Array(21).fill('a') }, 'sellingPoints'],
      [{ name: '\u0007\u0008' }, 'name'],
    ];
    for (const [payload, path] of cases) {
      const response = await call(alice, 'POST', base(alice.workspaceId), payload);
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
    for (const extra of [
      { workspaceId: bob.workspaceId },
      { status: 'archived' },
      { version: 9 },
      { id: bob.workspaceId },
      { primaryAssetId: bob.workspaceId },
    ]) {
      const response = await call(alice, 'POST', base(alice.workspaceId), { name: 'x', ...extra });
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
    }
  });

  it('creates nothing when the audit event cannot be written', async () => {
    const isolated = await createTestDb(requireDatabaseUrl());
    try {
      const zed = await createPerson(isolated.db, config.SESSION_SECRET, 'zed');
      const ctx = await resolveWorkspaceContext(isolated.db, zed.userId, zed.workspaceId, 'r');
      if (!ctx) throw new Error('no context');
      await isolated.pool.query('drop table audit_events');
      await expect(createProduct(isolated.db, ctx, { name: 'Ghost' })).rejects.toThrow();
      const rows = await isolated.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.name, 'Ghost'));
      expect(rows).toHaveLength(0);
    } finally {
      await isolated.drop();
    }
  });
});

describe('cross-workspace access (IDOR)', () => {
  it("never lets a stranger read, change or archive another workspace's product", async () => {
    const secret = await makeProduct(alice, { name: 'Alice secret' });

    const attempts: [string, 'GET' | 'POST' | 'PATCH', string, unknown][] = [
      // through the victim's workspace path
      ['read via victim ws', 'GET', `${base(alice.workspaceId)}/${secret.id}`, undefined],
      [
        'patch via victim ws',
        'PATCH',
        `${base(alice.workspaceId)}/${secret.id}`,
        { version: 1, name: 'pwned' },
      ],
      [
        'archive via victim ws',
        'POST',
        `${base(alice.workspaceId)}/${secret.id}/archive`,
        undefined,
      ],
      ['list victim ws', 'GET', base(alice.workspaceId), undefined],
      // through the attacker's own workspace path, naming the victim's product id
      ['read via own ws', 'GET', `${base(bob.workspaceId)}/${secret.id}`, undefined],
      [
        'patch via own ws',
        'PATCH',
        `${base(bob.workspaceId)}/${secret.id}`,
        { version: 1, name: 'pwned' },
      ],
      ['archive via own ws', 'POST', `${base(bob.workspaceId)}/${secret.id}/archive`, undefined],
      [
        'unarchive via own ws',
        'POST',
        `${base(bob.workspaceId)}/${secret.id}/unarchive`,
        undefined,
      ],
    ];
    for (const [label, method, url, payload] of attempts) {
      const response = await call(bob, method, url, payload);
      expect(response.statusCode, `${label}: ${response.body}`).toBe(404);
      expect(response.body, label).not.toContain('Alice secret');
    }

    // Nothing changed, and the attacker's own list never shows it.
    const unchanged = await call(alice, 'GET', `${base(alice.workspaceId)}/${secret.id}`);
    expect(ProductSchema.parse(unchanged.json())).toMatchObject({
      name: 'Alice secret',
      version: 1,
      status: 'active',
    });
    const theirs = ProductListResponseSchema.parse(
      (await call(bob, 'GET', base(bob.workspaceId))).json(),
    );
    expect(theirs.items.some((item) => item.id === secret.id)).toBe(false);
  });

  it("will not create a product in someone else's workspace, nor let the body choose the workspace", async () => {
    const intoVictim = await call(bob, 'POST', base(alice.workspaceId), { name: 'Planted' });
    expect(intoVictim.statusCode).toBe(404);
    const bodyWorkspace = await call(bob, 'POST', base(bob.workspaceId), {
      name: 'Planted',
      workspaceId: alice.workspaceId,
    });
    expect(bodyWorkspace.statusCode).toBe(400);
    const planted = await testDb.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.name, 'Planted'));
    expect(planted).toHaveLength(0);
  });

  it('answers a stranger identically for a real product and a product that does not exist', async () => {
    const real = await makeProduct(alice, { name: 'Real one' });
    const a = await call(bob, 'GET', `${base(alice.workspaceId)}/${real.id}`);
    const b = await call(
      bob,
      'GET',
      `${base(alice.workspaceId)}/00000000-0000-4000-8000-000000000000`,
    );
    const strip = (text: string) => text.replace(/"requestId":"[^"]+"/, '');
    expect(strip(a.body)).toBe(strip(b.body));
  });

  it('a cursor taken from one workspace cannot reach another workspace', async () => {
    await makeProduct(alice, { name: 'A1' });
    await makeProduct(alice, { name: 'A2' });
    const first = ProductListResponseSchema.parse(
      (await call(alice, 'GET', `${base(alice.workspaceId)}?limit=1`)).json(),
    );
    expect(first.nextCursor).not.toBeNull();
    const viaBob = await call(
      bob,
      'GET',
      `${base(bob.workspaceId)}?limit=50&cursor=${first.nextCursor}`,
    );
    expect(viaBob.statusCode).toBe(200);
    const ids = ProductListResponseSchema.parse(viaBob.json()).items.map(
      (item) => item.workspaceId,
    );
    expect(ids.every((id) => id === bob.workspaceId)).toBe(true);
  });
});

describe('read', () => {
  it('returns a product, and 404 for unknown or malformed ids', async () => {
    const product = await makeProduct(alice);
    expect((await call(alice, 'GET', `${base(alice.workspaceId)}/${product.id}`)).statusCode).toBe(
      200,
    );
    for (const id of [
      '00000000-0000-4000-8000-000000000000',
      'nope',
      "' or 1=1 --",
      '../../etc/passwd',
    ]) {
      const response = await call(
        alice,
        'GET',
        `${base(alice.workspaceId)}/${encodeURIComponent(id)}`,
      );
      expect(response.statusCode, id).toBe(404);
    }
  });
});

describe('update (PATCH with version)', () => {
  it('applies a change, bumps the version, clears fields with null, and audits field names only', async () => {
    const product = await makeProduct(alice, {
      name: 'Before',
      description: 'Old description',
      sellingPoints: ['a'],
    });
    const response = await call(alice, 'PATCH', `${base(alice.workspaceId)}/${product.id}`, {
      version: 1,
      name: 'After',
      description: null,
      sellingPoints: ['b', 'c'],
    });
    expect(response.statusCode).toBe(200);
    const updated = ProductSchema.parse(response.json());
    expect(updated).toMatchObject({
      name: 'After',
      description: null,
      sellingPoints: ['b', 'c'],
      version: 2,
    });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(product.updatedAt).getTime(),
    );

    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, product.id));
    const update = events.find((event) => event.action === 'product.updated');
    expect(update?.metadata).toEqual({
      fields: ['name', 'description', 'sellingPoints'],
      version: 2,
    });
    expect(JSON.stringify(update?.metadata)).not.toContain('After');
  });

  it('answers 409 with the current version when the version is stale, and does not change anything', async () => {
    const product = await makeProduct(alice, { name: 'Original' });
    await call(alice, 'PATCH', `${base(alice.workspaceId)}/${product.id}`, {
      version: 1,
      name: 'First edit',
    });
    const stale = await call(alice, 'PATCH', `${base(alice.workspaceId)}/${product.id}`, {
      version: 1,
      name: 'Lost edit',
    });
    expect(stale.statusCode).toBe(409);
    const body = ErrorBodySchema.parse(stale.json());
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.currentVersion).toBe(2);
    const current = ProductSchema.parse(
      (await call(alice, 'GET', `${base(alice.workspaceId)}/${product.id}`)).json(),
    );
    expect(current.name).toBe('First edit');
  });

  it('lets exactly one of two simultaneous edits win', async () => {
    const product = await makeProduct(alice, { name: 'Race' });
    const url = `${base(alice.workspaceId)}/${product.id}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_unused, i) =>
        call(alice, 'PATCH', url, { version: 1, name: `Edit ${i}` }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(5);
    const final = ProductSchema.parse((await call(alice, 'GET', url)).json());
    expect(final.version).toBe(2);
  });

  it('answers 404, not 409, for a product that does not exist', async () => {
    const response = await call(
      alice,
      'PATCH',
      `${base(alice.workspaceId)}/00000000-0000-4000-8000-000000000000`,
      { version: 1, name: 'x' },
    );
    expect(response.statusCode).toBe(404);
  });

  it('rejects an update that would leave a price without a currency', async () => {
    const product = await makeProduct(alice, { name: 'Pricey' });
    const response = await call(alice, 'PATCH', `${base(alice.workspaceId)}/${product.id}`, {
      version: 1,
      priceAmount: '10',
    });
    expect(response.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(response.json()).error.details?.fields?.[0]?.path).toBe(
      'currency',
    );
    const ok = await call(alice, 'PATCH', `${base(alice.workspaceId)}/${product.id}`, {
      version: 1,
      priceAmount: '10',
      currency: 'THB',
    });
    expect(ok.statusCode).toBe(200);
    const cleared = await call(alice, 'PATCH', `${base(alice.workspaceId)}/${product.id}`, {
      version: 2,
      priceAmount: null,
      currency: null,
    });
    expect(ProductSchema.parse(cleared.json())).toMatchObject({
      priceAmount: null,
      currency: null,
    });
  });

  it('rejects empty updates and protected fields', async () => {
    const product = await makeProduct(alice, { name: 'Strict' });
    const url = `${base(alice.workspaceId)}/${product.id}`;
    for (const payload of [
      { version: 1 },
      { name: 'x' },
      { version: 1, name: 'x', status: 'archived' },
      { version: 1, name: 'x', workspaceId: bob.workspaceId },
      { version: 1, name: '' },
      { version: 1, name: '\u0007' },
    ]) {
      expect((await call(alice, 'PATCH', url, payload)).statusCode, JSON.stringify(payload)).toBe(
        400,
      );
    }
  });
});

describe('archive and unarchive', () => {
  it('hides archived products from the default list, keeps them readable, and restores them', async () => {
    const product = await makeProduct(alice, { name: 'To archive' });
    const url = `${base(alice.workspaceId)}/${product.id}`;

    const archived = ProductSchema.parse((await call(alice, 'POST', `${url}/archive`)).json());
    expect(archived).toMatchObject({ status: 'archived', version: 2 });
    expect(archived.archivedAt).not.toBeNull();

    const active = ProductListResponseSchema.parse(
      (await call(alice, 'GET', `${base(alice.workspaceId)}?limit=100`)).json(),
    );
    expect(active.items.some((item) => item.id === product.id)).toBe(false);
    const inArchive = ProductListResponseSchema.parse(
      (await call(alice, 'GET', `${base(alice.workspaceId)}?status=archived&limit=100`)).json(),
    );
    expect(inArchive.items.some((item) => item.id === product.id)).toBe(true);
    expect((await call(alice, 'GET', url)).statusCode).toBe(200);

    const restored = ProductSchema.parse((await call(alice, 'POST', `${url}/unarchive`)).json());
    expect(restored).toMatchObject({ status: 'active', archivedAt: null, version: 3 });
  });

  it('is idempotent: repeating it changes nothing and records one audit event', async () => {
    const product = await makeProduct(alice, { name: 'Twice' });
    const url = `${base(alice.workspaceId)}/${product.id}/archive`;
    const first = ProductSchema.parse((await call(alice, 'POST', url)).json());
    const second = await call(alice, 'POST', url);
    expect(second.statusCode).toBe(200);
    expect(ProductSchema.parse(second.json()).version).toBe(first.version);
    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, product.id));
    expect(events.filter((event) => event.action === 'product.archived')).toHaveLength(1);
  });

  it('answers 404 for a missing product', async () => {
    const response = await call(
      alice,
      'POST',
      `${base(alice.workspaceId)}/00000000-0000-4000-8000-000000000000/archive`,
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('pagination', () => {
  it('walks every product exactly once, in a stable order, even when timestamps tie', async () => {
    const carol = await createPerson(testDb.db, config.SESSION_SECRET, 'carol');
    // Seven products, five of them with the same created_at.
    for (let i = 0; i < 7; i += 1) {
      await testDb.pool.query(
        'insert into products (workspace_id, name, created_at) values ($1, $2, $3)',
        [
          carol.workspaceId,
          `P${i}`,
          i < 5 ? '2026-01-01T00:00:00.000Z' : `2026-01-0${i}T00:00:00.000Z`,
        ],
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `${base(carol.workspaceId)}?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const page = ProductListResponseSchema.parse((await call(carol, 'GET', url)).json());
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);

    const again: string[] = [];
    let next: string | null = null;
    do {
      const url: string = `${base(carol.workspaceId)}?limit=3${next ? `&cursor=${next}` : ''}`;
      const page = ProductListResponseSchema.parse((await call(carol, 'GET', url)).json());
      again.push(...page.items.map((item) => item.id));
      next = page.nextCursor;
    } while (next !== null);
    expect(again).toEqual(seen);
  });

  it('rejects malformed cursors, limits and parameters', async () => {
    const url = base(alice.workspaceId);
    const forged = Buffer.from(JSON.stringify({ t: 'not a date', i: 'x' })).toString('base64url');
    const wrongShape = Buffer.from(JSON.stringify({ a: 1 })).toString('base64url');
    for (const query of [
      'cursor=garbage!!',
      `cursor=${forged}`,
      `cursor=${wrongShape}`,
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
  it('lets viewers and reviewers read but not change anything', async () => {
    const product = await makeProduct(alice, { name: 'Role test' });
    const url = `${base(alice.workspaceId)}/${product.id}`;
    for (const person of [viewer, reviewer]) {
      expect((await call(person, 'GET', url)).statusCode).toBe(200);
      expect((await call(person, 'GET', base(alice.workspaceId))).statusCode).toBe(200);
      expect((await call(person, 'POST', base(alice.workspaceId), { name: 'x' })).statusCode).toBe(
        403,
      );
      expect((await call(person, 'PATCH', url, { version: 1, name: 'x' })).statusCode).toBe(403);
      expect((await call(person, 'POST', `${url}/archive`)).statusCode).toBe(403);
    }
    const unchanged = ProductSchema.parse((await call(alice, 'GET', url)).json());
    expect(unchanged).toMatchObject({ name: 'Role test', version: 1, status: 'active' });
  });

  it('lets editors change content', async () => {
    const response = await call(editor, 'POST', base(alice.workspaceId), { name: 'By editor' });
    expect(response.statusCode).toBe(201);
  });
});

describe('database constraints (defence in depth)', () => {
  const insert = (columns: string, values: unknown[]) =>
    testDb.pool.query(
      `insert into products (workspace_id, name, ${columns}) values ($1, 'c', ${values.map((_v, i) => `$${i + 2}`).join(', ')})`,
      [alice.workspaceId, ...values],
    );

  it('refuses rows that break the rules, even if the API were bypassed', async () => {
    await expect(insert('status', ['deleted'])).rejects.toThrow(/products_status_check/);
    await expect(insert('status', ['archived'])).rejects.toThrow(/products_archived_consistent/);
    await expect(insert('price_amount', ['5'])).rejects.toThrow(/products_price_currency_check/);
    await expect(insert('price_amount, currency', ['-1', 'THB'])).rejects.toThrow(
      /products_price_nonnegative/,
    );
    await expect(insert('selling_points', ['{"a":1}'])).rejects.toThrow(
      /products_selling_points_array/,
    );
    await expect(insert('version', [0])).rejects.toThrow(/products_version_positive/);
    await expect(insert('description', ['x'.repeat(5001)])).rejects.toThrow(
      /products_description_length/,
    );
    await expect(
      testDb.pool.query(
        "insert into products (workspace_id, name) values ('00000000-0000-4000-8000-000000000000', 'x')",
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});
