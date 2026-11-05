import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_DATABASE_URL = process.env.DATABASE_URL;

if (!DEV_DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Run: export DATABASE_URL="$(bash scripts/pg-local.sh url)" from the repo root.',
  );
}

// The suites run against their own database, created fresh by scripts/e2e-db.mjs (never the dev one).
const databaseUrl = new URL(DEV_DATABASE_URL);
databaseUrl.pathname = '/creatorops_e2e';
const DATABASE_URL = databaseUrl.toString();
process.env.DATABASE_URL = DATABASE_URL;

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error(
    'REDIS_URL is not set. Run: pnpm dev:redis, then export REDIS_URL="$(bash scripts/redis-local.sh url)" from the repo root.',
  );
}

const API_URL = 'http://localhost:3000';
const WEB_URL = 'http://localhost:5173';
const WORKER_PORT = 3101;
const SESSION_SECRET = 'a-long-e2e-only-secret-0123456789abcdef';

export default defineConfig({
  testDir: path.join(here, 'e2e'),
  globalSetup: path.join(here, 'e2e', 'global-setup.ts'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../api/dist/server.js',
      cwd: here,
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        DATABASE_URL,
        AUTH_MODE: 'mock',
        API_BASE_URL: API_URL,
        WEB_ORIGIN: WEB_URL,
        SESSION_SECRET,
        REDIS_URL,
        PORT: '3000',
        LOG_LEVEL: 'warn',
        // Uploaded files go to a temp directory, never into the repository.
        DATA_DIR: path.join(os.tmpdir(), 'creatorops-web-e2e-media'),
      },
    },
    {
      // The worker runs generation jobs. It has no HTTP port, so a small wrapper opens a bare TCP
      // port for Playwright to wait on and then starts the worker.
      command: 'node e2e/start-worker.mjs',
      cwd: here,
      port: WORKER_PORT,
      reuseExistingServer: false,
      env: {
        DATABASE_URL,
        AUTH_MODE: 'mock',
        API_BASE_URL: API_URL,
        WEB_ORIGIN: WEB_URL,
        SESSION_SECRET,
        REDIS_URL,
        LOG_LEVEL: 'warn',
        WORKER_PORT: String(WORKER_PORT),
        // The worker writes export packages that the API serves, so both use one directory.
        DATA_DIR: path.join(os.tmpdir(), 'creatorops-web-e2e-media'),
      },
    },
    {
      command: 'vite preview --port 5173 --strictPort',
      cwd: here,
      url: WEB_URL,
      reuseExistingServer: false,
    },
  ],
});
