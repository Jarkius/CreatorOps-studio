import { provisionTemplate } from './test-db.js';

/**
 * Runs once before the test files. Without DATABASE_URL nothing is provisioned: the database
 * tests themselves fail with instructions (see db-url.ts), while pure unit tests still run.
 */
export default async function setup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.SKIP_DB_TESTS === '1') return;
  await provisionTemplate(databaseUrl);
}
