import type { Page } from '@playwright/test';

import devKey from '../dev-extension-key.json' with { type: 'json' };
import { expect, test } from './fixtures.js';

const TOKEN_KEY = 'creatorops.devToken';

async function openPanel(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
}

function countMockTokenRequests(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/mock-token')) count += 1;
  });
  return () => count;
}

test('loads with the pinned development id and exactly the allowed permissions', async ({
  context,
  extensionId,
}) => {
  expect(extensionId).toBe(devKey.id);

  const page = await context.newPage();
  await openPanel(page, extensionId);
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  expect([...(manifest.permissions ?? [])].sort()).toEqual(['scripting', 'sidePanel', 'storage']);
  // This build is the end-to-end build, which grants the Meta AI host at install because a test
  // cannot click Chrome's prompt; a release build lists it only as an optional host permission
  // (manifest tests and the built-manifest test check that).
  expect(manifest.host_permissions).toEqual(['http://localhost:3000/*', 'https://www.meta.ai/*']);
  expect(manifest.optional_host_permissions).toEqual(['https://www.meta.ai/*']);
  expect(manifest).not.toHaveProperty('content_scripts');
  expect(manifest.manifest_version).toBe(3);
});

test('signs in through the API and shows the user, keeping the token only in session storage', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openPanel(page, extensionId);
  await expect(page.getByText('Dev User')).toBeVisible();
  await expect(page.getByText('dev@creatorops.local')).toBeVisible();
  // The workspace selector repeats names once the user has several; the list comes first.
  await expect(page.getByText('Dev Workspace').first()).toBeVisible();

  const stored = await page.evaluate(async (key) => {
    const session = (await chrome.storage.session.get(key))[key] as unknown;
    return {
      sessionToken: typeof session === 'string' ? session : null,
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
      localStorageLength: window.localStorage.length,
      sessionStorageLength: window.sessionStorage.length,
      cookie: document.cookie,
    };
  }, TOKEN_KEY);
  expect(stored.sessionToken).toMatch(/^v1\./);
  expect(stored.local).toEqual({});
  expect(stored.sync).toEqual({});
  expect(stored.localStorageLength).toBe(0);
  expect(stored.sessionStorageLength).toBe(0);
  expect(stored.cookie).toBe('');
});

test('the service worker makes the toolbar icon open the side panel', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openPanel(page, extensionId);
  await expect
    .poll(() => page.evaluate(() => chrome.sidePanel.getPanelBehavior()))
    .toEqual({ openPanelOnActionClick: true });
});

test('reuses the stored token on reload instead of asking for a new one', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const mockTokenRequests = countMockTokenRequests(page);
  await openPanel(page, extensionId);
  await expect(page.getByText('Dev User')).toBeVisible();
  expect(mockTokenRequests()).toBe(1);

  await page.reload();
  await expect(page.getByText('Dev User')).toBeVisible();
  expect(mockTokenRequests()).toBe(1);
});

test('replaces a rejected token exactly once and recovers', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const mockTokenRequests = countMockTokenRequests(page);
  await openPanel(page, extensionId);
  await expect(page.getByText('Dev User')).toBeVisible();

  await page.evaluate(
    (key) => chrome.storage.session.set({ [key]: 'v1.garbage.garbage' }),
    TOKEN_KEY,
  );
  await page.reload();
  await expect(page.getByText('Dev User')).toBeVisible();
  expect(mockTokenRequests()).toBe(2);
});

test('keeps working after the service worker is stopped', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await openPanel(page, extensionId);
  await expect(page.getByText('Dev User')).toBeVisible();

  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');

  await page.reload();
  await expect(page.getByText('Dev User')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => chrome.sidePanel.getPanelBehavior()))
    .toEqual({ openPanelOnActionClick: true });
});

test('shows an error with a working retry when the API is unreachable', async ({
  context,
  extensionId,
}) => {
  await context.route('http://localhost:3000/**', (route) => route.abort());
  const page = await context.newPage();
  await openPanel(page, extensionId);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not reach the server');

  await context.unroute('http://localhost:3000/**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Dev User')).toBeVisible();
});

test('fits a narrow side panel without horizontal scrolling', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await openPanel(page, extensionId);
  await expect(page.getByText('Dev User')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the dashboard link opens in a new tab and does not hand the panel to the page', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openPanel(page, extensionId);
  const link = page.getByRole('link', { name: 'Open dashboard' });
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await link.getAttribute('rel')).toContain('noopener');
});
