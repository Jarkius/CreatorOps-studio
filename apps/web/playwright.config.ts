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

const API_URL = 'http://localhost:3000';
const WEB_URL = 'http://localhost:5173';

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
        SESSION_SECRET: 'a-long-e2e-only-secret-0123456789abcdef',
        PORT: '3000',
        LOG_LEVEL: 'warn',
        // Uploaded files go to a temp directory, never into the repository.
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
