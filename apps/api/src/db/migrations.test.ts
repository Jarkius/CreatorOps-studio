import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, schema } from './client.js';
import { runMigrations } from './migrate.js';
import { seedDevData } from './seed.js';
import { requireDatabaseUrl } from '../test/db-url.js';
import { createPerson } from '../test/people.js';
import { createTestDb, type TestDb } from '../test/test-db.js';
import { SECRET_FOR_TESTS } from '../test/db-url.js';

// One entry per committed SQL migration in infra/migrations.
const MIGRATION_COUNT = 5;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
});

afterAll(async () => {
  await testDb.drop();
});

describe('database schema', () => {
  it('exists only because the committed migrations created it', async () => {
    const tables = await testDb.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'assets',
      'audit_events',
      'products',
      'upload_intents',
      'users',
      'workspace_members',
      'workspaces',
    ]);
    const applied = await testDb.pool.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(applied.rows[0]).toEqual({ n: MIGRATION_COUNT });
  });

  it('applying migrations twice is a no-op', async () => {
    await runMigrations(createDb(testDb.pool));
    const applied = await testDb.pool.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(applied.rows[0]).toEqual({ n: MIGRATION_COUNT });
  });

  it('rejects an unknown membership role', async () => {
    const seeded = await seedDevData(testDb.db);
    await expect(
      testDb.pool.query("update workspace_members set role = 'god' where workspace_id = $1", [
        seeded.workspaceId,
      ]),
    ).rejects.toThrow(/workspace_members_role_check/);
  });

  it('enforces unique emails', async () => {
    await expect(
      testDb.db.insert(schema.users).values({ email: 'dev@creatorops.local', displayName: 'Dup' }),
    ).rejects.toThrow();
  });

  it('seeding is idempotent', async () => {
    const first = await seedDevData(testDb.db);
    const second = await seedDevData(testDb.db);
    expect(second).toEqual(first);
    const counts = await testDb.pool.query<{ users: number; workspaces: number }>(
      'select (select count(*) from users)::int as users, (select count(*) from workspaces)::int as workspaces',
    );
    expect(counts.rows[0]).toEqual({ users: 1, workspaces: 1 });
  });

  it('deleting a workspace is refused while audit history exists', async () => {
    const seeded = await seedDevData(testDb.db);
    await testDb.pool.query(
      "insert into audit_events (workspace_id, actor_user_id, action, resource_type, resource_id) values ($1, $2, 'x', 'workspace', $3)",
      [seeded.workspaceId, seeded.userId, seeded.workspaceId],
    );
    await expect(
      testDb.pool.query('delete from workspaces where id = $1', [seeded.workspaceId]),
    ).rejects.toThrow();
  });
});

describe('assets and cross-workspace integrity (D-037)', () => {
  const sha = 'a'.repeat(64);

  async function setup() {
    const alice = await createPerson(
      testDb.db,
      SECRET_FOR_TESTS,
      `alice-${Math.random().toString(36).slice(2, 7)}`,
    );
    const bob = await createPerson(
      testDb.db,
      SECRET_FOR_TESTS,
      `bob-${Math.random().toString(36).slice(2, 7)}`,
    );
    const product = async (workspaceId: string) =>
      (
        await testDb.pool.query<{ id: string }>(
          'insert into products (workspace_id, name) values ($1, $2) returning id',
          [workspaceId, 'P'],
        )
      ).rows[0]!.id;
    const asset = async (
      person: { workspaceId: string; userId: string },
      productId: string | null = null,
      extra: Partial<Record<string, unknown>> = {},
    ) =>
      (
        await testDb.pool.query<{ id: string }>(
          `insert into assets (workspace_id, product_id, type, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [
            person.workspaceId,
            productId,
            extra.type ?? 'image',
            extra.mime ?? 'image/png',
            extra.size ?? 10,
            extra.filename ?? 'a.png',
            extra.sha ?? sha,
            `ws/${person.workspaceId}/x/original.png`,
            person.userId,
          ],
        )
      ).rows[0]!.id;
    return { alice, bob, product, asset };
  }

  it('refuses an asset linked to a product of another workspace', async () => {
    const { alice, bob, product, asset } = await setup();
    const bobsProduct = await product(bob.workspaceId);
    await expect(asset(alice, bobsProduct)).rejects.toThrow(/assets_product_fk/);
    await expect(asset(bob, bobsProduct)).resolves.toBeTruthy();
  });

  it("refuses a product whose cover image is another workspace's asset", async () => {
    const { alice, bob, product, asset } = await setup();
    const aliceProduct = await product(alice.workspaceId);
    const bobsAsset = await asset(bob);
    await expect(
      testDb.pool.query('update products set primary_asset_id = $1 where id = $2', [
        bobsAsset,
        aliceProduct,
      ]),
    ).rejects.toThrow(/products_primary_asset_fk/);
    const ownAsset = await asset(alice);
    await expect(
      testDb.pool.query('update products set primary_asset_id = $1 where id = $2', [
        ownAsset,
        aliceProduct,
      ]),
    ).resolves.toBeTruthy();
  });

  it('refuses to hard-delete an asset that is still a product cover image', async () => {
    const { alice, product, asset } = await setup();
    const p = await product(alice.workspaceId);
    const a = await asset(alice);
    await testDb.pool.query('update products set primary_asset_id = $1 where id = $2', [a, p]);
    await expect(testDb.pool.query('delete from assets where id = $1', [a])).rejects.toThrow(
      /products_primary_asset_fk/,
    );
  });

  it('refuses an upload intent for a product of another workspace', async () => {
    const { alice, bob, product } = await setup();
    const bobsProduct = await product(bob.workspaceId);
    const insert = (productId: string | null) =>
      testDb.pool.query(
        `insert into upload_intents (workspace_id, user_id, product_id, asset_id, declared_mime, declared_size, original_filename, expires_at)
         values ($1, $2, $3, gen_random_uuid(), 'image/png', 10, 'a.png', now() + interval '10 minutes')`,
        [alice.workspaceId, alice.userId, productId],
      );
    await expect(insert(bobsProduct)).rejects.toThrow(/upload_intents_product_fk/);
    await expect(insert(null)).resolves.toBeTruthy();
  });

  it('refuses rows that break the asset rules', async () => {
    const { alice, asset } = await setup();
    await expect(asset(alice, null, { mime: 'image/svg+xml' })).rejects.toThrow(
      /assets_mime_check/,
    );
    await expect(asset(alice, null, { type: 'video', mime: 'image/png' })).rejects.toThrow(
      /assets_type_matches_mime/,
    );
    await expect(asset(alice, null, { size: 0 })).rejects.toThrow(/assets_size_positive/);
    await expect(asset(alice, null, { sha: 'XYZ' })).rejects.toThrow(/assets_sha256_format/);
    await expect(asset(alice, null, { filename: '' })).rejects.toThrow(/assets_filename_length/);
    await expect(asset(alice, null, { filename: 'x'.repeat(256) })).rejects.toThrow(
      /assets_filename_length/,
    );
  });

  it('refuses a soft-deleted state that is inconsistent', async () => {
    const { alice, asset } = await setup();
    const a = await asset(alice);
    await expect(
      testDb.pool.query("update assets set status = 'deleted' where id = $1", [a]),
    ).rejects.toThrow(/assets_deleted_consistent/);
    await expect(
      testDb.pool.query("update assets set status = 'deleted', deleted_at = now() where id = $1", [
        a,
      ]),
    ).resolves.toBeTruthy();
  });

  it('refuses two assets that share a storage key, and a received size of zero', async () => {
    const { alice, asset } = await setup();
    await asset(alice);
    await expect(asset(alice)).rejects.toThrow(/assets_storage_key_unique/);
    await expect(
      testDb.pool.query(
        `insert into upload_intents (workspace_id, user_id, asset_id, declared_mime, declared_size, original_filename, expires_at, received_size)
         values ($1, $2, gen_random_uuid(), 'image/png', 10, 'a.png', now(), 0)`,
        [alice.workspaceId, alice.userId],
      ),
    ).rejects.toThrow(/upload_intents_received_size_positive/);
  });
});
