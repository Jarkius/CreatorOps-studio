import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

import devKey from './dev-extension-key.json' with { type: 'json' };

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

export const API_URL = 'http://localhost:3000';

export default defineConfig({
  testDir: path.join(here, 'e2e'),
  globalSetup: path.join(here, 'e2e', 'global-setup.ts'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node ../api/dist/server.js',
    cwd: here,
    url: `${API_URL}/api/v1/health`,
    reuseExistingServer: false,
    env: {
      DATABASE_URL,
      AUTH_MODE: 'mock',
      API_BASE_URL: API_URL,
      WEB_ORIGIN: 'http://localhost:5173',
      EXTENSION_ORIGIN: `chrome-extension://${devKey.id}`,
      SESSION_SECRET: 'a-long-e2e-only-secret-0123456789abcdef',
      PORT: '3000',
      LOG_LEVEL: 'warn',
      // The suite signs in and polls many times a minute from one address; the limiter itself is
      // tested in the API package.
      RATE_LIMIT_MAX: '5000',
    },
  },
});
