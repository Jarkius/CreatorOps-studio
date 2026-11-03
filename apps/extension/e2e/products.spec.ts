import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';

const API_URL = 'http://localhost:3000';
/** Default dashboard origin; the e2e build does not set VITE_DASHBOARD_URL. */
const DASHBOARD_URL = 'http://localhost:5173';
const PRODUCTS_ROUTE = '**/api/v1/workspaces/*/products*';

interface Workspace {
  id: string;
  name: string;
}

async function devToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_URL}/api/v1/auth/mock-token`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { token: string }).token;
}

async function apiPost<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
): Promise<T> {
  const response = await request.post(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** The development user's first workspace, which is the one the panel selects by default. */
async function firstWorkspace(request: APIRequestContext, token: string): Promise<Workspace> {
  const response = await request.get(`${API_URL}/api/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { workspaces: Workspace[] };
  const workspace = body.workspaces[0];
  if (!workspace) throw new Error('The development user has no workspace');
  return workspace;
}

async function createWorkspace(request: APIRequestContext, token: string, name: string) {
  return apiPost<Workspace>(request, token, '/api/v1/workspaces', { name, defaultLanguage: 'th' });
}

async function createProduct(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  body: { name: string; priceAmount?: string; currency?: string },
) {
  return apiPost<{ id: string; name: string }>(
    request,
    token,
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products`,
    body,
  );
}

async function openPanel(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
}

function productsRegion(page: Page) {
  return page.getByRole('region', { name: 'Products' });
}

test('a product created through the API appears in the panel', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const workspace = await firstWorkspace(request, token);
  const name = `สินค้าทดสอบ ${Date.now()}`;
  await createProduct(request, token, workspace.id, {
    name,
    priceAmount: '1290.50',
    currency: 'THB',
  });

  const page = await context.newPage();
  await openPanel(page, extensionId);
  await expect(productsRegion(page).getByText(name, { exact: true })).toBeVisible();
});

test('a brand-new workspace selected in the dropdown shows the empty state', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const created = await createWorkspace(request, token, `E2E empty ${Date.now()}`);

  const page = await context.newPage();
  await openPanel(page, extensionId);
  const selector = page.getByRole('combobox', { name: 'Workspace' });
  await expect(selector).toBeVisible();
  await selector.selectOption(created.id);

  await expect(productsRegion(page).getByText('No products yet')).toBeVisible();
  await expect(productsRegion(page).getByRole('link', { name: 'Create product' })).toHaveAttribute(
    'href',
    `${DASHBOARD_URL}/w/${encodeURIComponent(created.id)}/products/new`,
  );
});

test('a failed product request shows the error, and Try again shows the list once requests work', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const workspace = await firstWorkspace(request, token);
  const name = `E2E retry ${Date.now()}`;
  await createProduct(request, token, workspace.id, { name });

  await context.route(PRODUCTS_ROUTE, (route) => route.abort());
  const page = await context.newPage();
  await openPanel(page, extensionId);

  const region = productsRegion(page);
  await expect(region.getByRole('alert')).toContainText('Could not reach the server');

  await context.unroute(PRODUCTS_ROUTE);
  await region.getByRole('button', { name: 'Try again' }).click();
  await expect(region.getByText(name, { exact: true })).toBeVisible();
});

test('the product list fits a 320px panel without horizontal scrolling', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const workspace = await firstWorkspace(request, token);
  const name = `ชื่อสินค้ายาวมากมากมากมาก ${'LongEnglishNameWithoutSpaces'.repeat(4)} ${Date.now()}`;
  await createProduct(request, token, workspace.id, {
    name,
    priceAmount: '99999999.99',
    currency: 'THB',
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await openPanel(page, extensionId);

  const region = productsRegion(page);
  await expect(region.getByRole('link', { name: /^Open / }).first()).toBeVisible();
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(documentOverflow).toBeLessThanOrEqual(0);
  const regionOverflow = await region.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(regionOverflow).toBeLessThanOrEqual(0);
});

test('product links open the dashboard in a new tab', async ({ context, extensionId, request }) => {
  const token = await devToken(request);
  const workspace = await firstWorkspace(request, token);
  const name = `E2E link ${Date.now()}`;
  const product = await createProduct(request, token, workspace.id, { name });

  // The dashboard is not running during this test; answer its pages so the new tab has a URL.
  await context.route(`${DASHBOARD_URL}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Dashboard</title><p>Dashboard</p>',
    }),
  );

  const page = await context.newPage();
  await openPanel(page, extensionId);
  const link = productsRegion(page).getByRole('link', { name: `Open ${name}` });
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await link.getAttribute('rel')).toContain('noopener');
  expect(await link.getAttribute('rel')).toContain('noreferrer');

  const expectedHref = `${DASHBOARD_URL}/w/${encodeURIComponent(workspace.id)}/products/${encodeURIComponent(product.id)}`;
  await expect(link).toHaveAttribute('href', expectedHref);

  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await expect(popup).toHaveURL(expectedHref);
});
