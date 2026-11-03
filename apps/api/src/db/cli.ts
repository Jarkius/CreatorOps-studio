import { ConfigError, parseEnv } from '@creatorops/config';
import { z } from 'zod';

import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { seedDevData } from './seed.js';
import { createPool } from '../platform/db.js';

const cliEnv = z.object({
  DATABASE_URL: z
    .string()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgres:// URL'),
});

/** `node dist/db/cli.js migrate` or `node dist/db/cli.js seed`. */
async function main(command: string | undefined): Promise<number> {
  if (command !== 'migrate' && command !== 'seed') {
    process.stderr.write('usage: node dist/db/cli.js {migrate|seed}\n');
    return 2;
  }
  let databaseUrl: string;
  try {
    databaseUrl = parseEnv(cliEnv, process.env).DATABASE_URL;
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const pool = createPool(databaseUrl);
  try {
    const db = createDb(pool);
    if (command === 'migrate') {
      await runMigrations(db);
      process.stdout.write('migrations applied\n');
    } else {
      await runMigrations(db);
      const seeded = await seedDevData(db);
      process.stdout.write(
        `seeded development user ${seeded.userId} and workspace ${seeded.workspaceId}\n`,
      );
    }
    return 0;
  } catch {
    process.stderr.write(`${command} failed. Check DATABASE_URL and that PostgreSQL is running.\n`);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main(process.argv[2]);
