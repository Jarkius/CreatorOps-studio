import pg from 'pg';

import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

/**
 * Database test support (D-026). Migrations are applied once to a template database in the
 * vitest globalSetup; each test file clones the template, so tests never share rows and the
 * schema only ever comes from the committed migrations.
 */
export const TEMPLATE_DB = 'creatorops_tpl';

// Serialises CREATE DATABASE ... TEMPLATE, which fails when two sessions clone the same template
// at the same moment.
const CLONE_LOCK = 724_001;

function withDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(
  databaseUrl: string,
  run: (admin: pg.Client) => Promise<T>,
): Promise<T> {
  const admin = new pg.Client({ connectionString: withDatabase(databaseUrl, 'postgres') });
  await admin.connect();
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

/**
 * Builds the template database from the committed migrations. Run once per test run. The lock
 * is held until the migrations finish, so a concurrent run cannot clone a half-built template.
 */
export async function provisionTemplate(databaseUrl: string): Promise<void> {
  await withAdmin(databaseUrl, async (admin) => {
    await admin.query('select pg_advisory_lock($1)', [CLONE_LOCK]);
    try {
      await admin.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
      await admin.query(`create database ${TEMPLATE_DB}`);

      const pool = new pg.Pool({
        connectionString: withDatabase(databaseUrl, TEMPLATE_DB),
        max: 1,
      });
      try {
        await runMigrations(createDb(pool));
      } finally {
        await pool.end();
      }
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [CLONE_LOCK]);
    }
  });
}

export interface TestDb {
  readonly name: string;
  readonly url: string;
  readonly pool: pg.Pool;
  readonly db: Db;
  drop(): Promise<void>;
}

let counter = 0;

/** Creates an isolated, fully migrated database for one test file. Call drop() when finished. */
export async function createTestDb(databaseUrl: string): Promise<TestDb> {
  counter += 1;
  const name = `t_${process.pid}_${counter}_${Math.random().toString(36).slice(2, 8)}`;

  await withAdmin(databaseUrl, async (admin) => {
    await admin.query('select pg_advisory_lock($1)', [CLONE_LOCK]);
    try {
      await admin.query(`create database ${name} template ${TEMPLATE_DB}`);
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [CLONE_LOCK]);
    }
  });

  const url = withDatabase(databaseUrl, name);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    name,
    url,
    pool,
    db: createDb(pool),
    async drop() {
      await pool.end();
      await withAdmin(databaseUrl, async (admin) => {
        await admin.query(`drop database if exists ${name} with (force)`);
      });
    },
  };
}
