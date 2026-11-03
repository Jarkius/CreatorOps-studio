// Creates a fresh, migrated, seeded database named `creatorops_e2e` for the end-to-end suites.
//
// End-to-end tests create workspaces, products and files. Running them against the shared
// development database fills it up (a user may own only 20 workspaces) and makes results depend on
// earlier runs, so every suite starts from an empty database of its own. The name is fixed, so this
// script can never drop anything but that one database.
//
// Usage: DATABASE_URL=postgres://... node scripts/e2e-db.mjs   (the URL names the server and login)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps', 'api', 'package.json'));
const pg = require('pg');

const E2E_DATABASE = 'creatorops_e2e';
const source = process.env.DATABASE_URL;
if (!source) {
  console.error(
    'DATABASE_URL is not set. Run: export DATABASE_URL="$(bash scripts/pg-local.sh url)"',
  );
  process.exit(1);
}

function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const admin = new pg.Client({ connectionString: withDatabase(source, 'postgres') });
await admin.connect();
try {
  await admin.query(`drop database if exists ${E2E_DATABASE} with (force)`);
  await admin.query(`create database ${E2E_DATABASE}`);
} finally {
  await admin.end();
}

// `seed` applies every committed migration, then creates the development user and workspace.
execFileSync(process.execPath, [path.join(root, 'apps', 'api', 'dist', 'db', 'cli.js'), 'seed'], {
  env: { ...process.env, DATABASE_URL: withDatabase(source, E2E_DATABASE) },
  stdio: 'inherit',
});
