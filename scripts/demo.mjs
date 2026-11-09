// One command to try CreatorOps Studio on your own machine: `pnpm demo`.
//
// It starts PostgreSQL and Redis (the local scripts, no Docker), builds the dashboard and the
// extension for mock sign-in, creates a `creatorops_demo` database (kept between runs, so your
// products and drafts stay), then runs the API, the worker and the dashboard until you press Ctrl+C.
//
// Mock sign-in is for local use only: it is loopback-only (D-032) and there is no real login.
// Text generation uses the mock provider (Thai copy from templates, no paid API, no key needed).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 3000;
const WEB_PORT = 5173;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const DEMO_DATABASE = 'creatorops_demo';

const say = (message) => console.log(`\n==> ${message}`);

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function output(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
}

function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function waitFor(url, label, seconds = 60) {
  for (let i = 0; i < seconds; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not start within ${seconds} seconds (${url})`);
}

say('Starting PostgreSQL and Redis (local, no Docker)');
run('bash', ['scripts/pg-local.sh', 'start']);
run('bash', ['scripts/redis-local.sh', 'start']);
const serverUrl = process.env.DATABASE_URL ?? output('bash', ['scripts/pg-local.sh', 'url']);
const redisUrl = process.env.REDIS_URL ?? output('bash', ['scripts/redis-local.sh', 'url']);
const databaseUrl = withDatabase(serverUrl, DEMO_DATABASE);

say('Building everything (first run takes a minute)');
run('pnpm', ['build']);
const mockBuild = {
  ...process.env,
  VITE_AUTH_MODE: 'mock',
  VITE_API_BASE_URL: API_URL,
  VITE_DASHBOARD_URL: WEB_URL,
};
say('Building the dashboard and the extension with mock sign-in');
run('pnpm', ['exec', 'vite', 'build'], { cwd: path.join(root, 'apps', 'web'), env: mockBuild });
run('pnpm', ['exec', 'vite', 'build'], {
  cwd: path.join(root, 'apps', 'extension'),
  env: mockBuild,
});

say(`Preparing the ${DEMO_DATABASE} database`);
const require = createRequire(path.join(root, 'apps', 'api', 'package.json'));
const pg = require('pg');
const admin = new pg.Client({ connectionString: withDatabase(serverUrl, 'postgres') });
await admin.connect();
try {
  const exists = await admin.query('select 1 from pg_database where datname = $1', [DEMO_DATABASE]);
  if (exists.rowCount === 0) await admin.query(`create database ${DEMO_DATABASE}`);
} finally {
  await admin.end();
}
// `seed` applies every committed migration, then creates the development user and workspace.
run(process.execPath, [path.join(root, 'apps', 'api', 'dist', 'db', 'cli.js'), 'seed'], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

const extensionId = JSON.parse(
  readFileSync(path.join(root, 'apps', 'extension', 'dev-extension-key.json'), 'utf8'),
).id;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  AUTH_MODE: 'mock',
  API_BASE_URL: API_URL,
  WEB_ORIGIN: WEB_URL,
  EXTENSION_ORIGIN: `chrome-extension://${extensionId}`,
  // New every run: signed sessions and links stop working after a restart, which is fine here.
  SESSION_SECRET: randomBytes(32).toString('hex'),
  PORT: String(API_PORT),
  // Info, so job and provider-call lines show; the full output also goes to .data/logs/.
  LOG_LEVEL: 'info',
};

say('Starting the API, the worker and the dashboard');
// Each process writes everything to .data/logs/<name>.log (appended, secrets are already redacted
// by the API's logger) and to the terminal with a [name] prefix. The terminal skips the two lines
// per request ("incoming request", "request completed") because the panel polls often; the file
// keeps them.
const LOG_DIR = path.join(root, '.data', 'logs');
mkdirSync(LOG_DIR, { recursive: true });
const QUIET_ON_TERMINAL = /"msg":"(incoming request|request completed)"/;
function launch(name, command, args, options) {
  const file = createWriteStream(path.join(LOG_DIR, `${name}.log`), { flags: 'a' });
  file.write(`\n--- ${name} started ${new Date().toISOString()} ---\n`);
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', (chunk) => {
      file.write(chunk);
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!QUIET_ON_TERMINAL.test(line)) console.log(`[${name}] ${line}`);
      }
    });
  }
  child.on('close', () => file.end());
  return child;
}
const children = [
  launch('api', process.execPath, ['apps/api/dist/server.js'], { cwd: root, env }),
  launch('worker', process.execPath, ['apps/api/dist/worker.js'], { cwd: root, env }),
  launch('web', 'pnpm', ['exec', 'vite', 'preview', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: path.join(root, 'apps', 'web'),
    env,
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  console.log(
    '\nStopping the demo (PostgreSQL and Redis keep running; `pnpm dev:db:stop` and `pnpm dev:redis:stop` stop them).',
  );
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}
for (const child of children) child.on('exit', (code) => !stopping && stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

await waitFor(`${API_URL}/api/v1/health`, 'The API');
await waitFor(WEB_URL, 'The dashboard');

console.log(`
============================================================
 CreatorOps Studio is running (demo, mock sign-in, mock text)
============================================================
 Dashboard:  ${WEB_URL}
 API:        ${API_URL}/api/v1/health

 Try this:
   1. Open the dashboard. Products > New product (Thai name, selling points).
   2. Asset library: upload a PNG or JPG for the product.
   3. Campaigns > New campaign > Generate content. The worker writes the drafts.
   4. Open a draft: edit a section, Regenerate one section, Copy.
   5. Final video: needs ffmpeg installed (the [worker] line says "ffmpeg found").

 Side panel (Chrome): open chrome://extensions, turn on Developer mode,
 "Load unpacked", choose:  ${path.join(root, 'apps', 'extension', 'dist')}
 Then click the toolbar icon to open the panel.

 Text is the mock provider: Thai copy built from templates. A real provider
 is added in Settings. Logs: ${LOG_DIR} (api.log, worker.log, web.log).
 Press Ctrl+C to stop.
============================================================
`);
