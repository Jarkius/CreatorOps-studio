import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, schema } from './client.js';
import { runMigrations } from './migrate.js';
import { seedDevData } from './seed.js';
import { requireDatabaseUrl } from '../test/db-url.js';
import { createTestDb, type TestDb } from '../test/test-db.js';

// One entry per committed SQL migration in infra/migrations.
const MIGRATION_COUNT = 2;

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
      'audit_events',
      'products',
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
