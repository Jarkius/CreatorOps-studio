import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { Db } from './client.js';

/**
 * Committed SQL migrations. The schema is created only through these files, never implicitly
 * (CLAUDE.md). The relative depth is the same from src/db and dist/db.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../../../infra/migrations', import.meta.url),
);

export async function runMigrations(db: Db, folder: string = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
