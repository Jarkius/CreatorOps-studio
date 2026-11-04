import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';

const API_URL = 'http://localhost:3000';

async function devToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_URL}/api/v1/auth/mock-token`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { token: string }).token;
}

async function api<T>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

async function firstWorkspaceId(request: APIRequestContext, token: string): Promise<string> {
  const me = await api<{ workspaces: { id: string }[] }>(request, token, 'GET', '/api/v1/me');
  const first = me.workspaces[0];
  if (!first) throw new Error('The development user has no workspace');
  return first.id;
}

const createRegion = (page: Page) => page.getByRole('region', { name: 'Create content' });

test('Create content makes a campaign and starts its job, shown under Campaigns', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const workspaceId = await firstWorkspaceId(request, token);
  const productName = `พัดลม e2e ${Date.now()}`;
  await api(request, token, 'POST', `/api/v1/workspaces/${workspaceId}/products`, {
    name: productName,
    sellingPoints: ['ลมแรง'],
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const region = createRegion(page);
  await expect(region.getByRole('button', { name: 'Create content' })).toBeDisabled();
  await region.getByRole('combobox', { name: 'Product' }).selectOption({ label: productName });
  await expect(region.getByRole('radio').first()).toBeChecked();
  await expect(region.getByText('Scene images in Meta AI (tick Full Auto)')).toBeVisible();

  await region.getByRole('button', { name: 'Create content' }).click();
  await expect(region.getByText(/Started\. Follow it under Campaigns below/)).toBeVisible();

  // No worker runs in this suite, so the job stays queued; the campaign row shows it.
  const campaigns = page.getByRole('region', { name: 'Campaigns' });
  const row = campaigns.getByRole('listitem').filter({ hasText: productName });
  await expect(row.getByText('Waiting to start')).toBeVisible();

  // The campaign and its single job exist on the server, in the product and mode we picked.
  const list = await api<{
    items: { name: string; productId: string; platform: string; variants: number }[];
  }>(request, token, 'GET', `/api/v1/workspaces/${workspaceId}/campaigns?limit=100`);
  const made = list.items.filter((item) => item.name.startsWith(productName));
  expect(made).toHaveLength(1);
  expect(made[0]).toMatchObject({ platform: 'tiktok', variants: 1 });
});

test('a workspace with no product asks for one first', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const created = await api<{ id: string }>(request, token, 'POST', '/api/v1/workspaces', {
    name: `E2E create empty ${Date.now()}`,
    defaultLanguage: 'th',
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption(created.id);
  await expect(createRegion(page).getByText('Add a product first')).toBeVisible();
});
