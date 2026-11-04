import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, test as base, type BrowserContext } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '..', 'dist-e2e');

interface Fixtures {
  /** A fresh Chromium profile with the built extension loaded. */
  context: BrowserContext;
  /** The id Chrome assigned to the loaded extension. */
  extensionId: string;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'creatorops-ext-'));
    // Extensions need the full Chromium build (new headless mode), not the headless shell.
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
});

export { expect } from '@playwright/test';
