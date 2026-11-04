import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';

const API_URL = 'http://localhost:3000';
/** Default dashboard origin; the e2e build does not set VITE_DASHBOARD_URL. */
const DASHBOARD_URL = 'http://localhost:5173';

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

async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** The development user's first workspace, which is the one the panel selects by default. */
async function firstWorkspace(request: APIRequestContext, token: string): Promise<Workspace> {
  const body = await apiGet<{ workspaces: Workspace[] }>(request, token, '/api/v1/me');
  const workspace = body.workspaces[0];
  if (!workspace) throw new Error('The development user has no workspace');
  return workspace;
}

/** A product and a campaign on it, created through the API, so the panel has something to show. */
async function createCampaign(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const ws = encodeURIComponent(workspaceId);
  const product = await apiPost<{ id: string }>(
    request,
    token,
    `/api/v1/workspaces/${ws}/products`,
    { name: `สินค้า ${name}` },
  );
  const templates = await apiGet<{ items: { id: string; version: number }[] }>(
    request,
    token,
    `/api/v1/workspaces/${ws}/templates`,
  );
  const template = templates.items[0];
  if (!template) throw new Error('No template is available');
  return apiPost<{ id: string; name: string }>(
    request,
    token,
    `/api/v1/workspaces/${ws}/campaigns`,
    {
      productId: product.id,
      templateId: template.id,
      templateVersion: template.version,
      name,
      language: 'th',
      platform: 'tiktok',
      variants: 1,
    },
  );
}

async function openPanel(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
}

function campaignsRegion(page: Page) {
  return page.getByRole('region', { name: 'Campaigns' });
}

test('Generate queues a job in the panel, and Cancel stops it', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const workspace = await firstWorkspace(request, token);
  const name = `E2E generate ${Date.now()}`;
  const campaign = await createCampaign(request, token, workspace.id, name);

  const page = await context.newPage();
  await openPanel(page, extensionId);
  const region = campaignsRegion(page);
  // Each campaign is one list item; the status pill and the status text both say the state, so
  // assertions stay inside the row.
  const row = region.getByRole('listitem').filter({ hasText: name });
  await expect(row.getByText(name, { exact: true })).toBeVisible();

  // No worker runs in the e2e suite, so the job stays queued until it is cancelled.
  await row.getByRole('button', { name: `Generate ${name}` }).click();
  await expect(row.getByText('Waiting to start')).toBeVisible();
  await expect(row.getByRole('button', { name: `Generating… ${name}` })).toBeDisabled();

  await row.getByRole('button', { name: `Cancel generation for ${name}` }).click();
  await expect(row.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  await expect(row.getByRole('button', { name: `Try again ${name}` })).toBeEnabled();
  await expect(region.getByRole('link', { name: `Open ${name} in the dashboard` })).toHaveAttribute(
    'href',
    `${DASHBOARD_URL}/w/${encodeURIComponent(workspace.id)}/campaigns/${encodeURIComponent(campaign.id)}`,
  );
});

test('an empty workspace shows the campaigns empty state with a dashboard link', async ({
  context,
  extensionId,
  request,
}) => {
  const token = await devToken(request);
  const created = await apiPost<Workspace>(request, token, '/api/v1/workspaces', {
    name: `E2E campaigns empty ${Date.now()}`,
    defaultLanguage: 'th',
  });

  const page = await context.newPage();
  await openPanel(page, extensionId);
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption(created.id);

  const region = campaignsRegion(page);
  await expect(region.getByText('No campaigns yet')).toBeVisible();
  await expect(region.getByRole('link', { name: 'Create campaign' })).toHaveAttribute(
    'href',
    `${DASHBOARD_URL}/w/${encodeURIComponent(created.id)}/campaigns/new`,
  );
});
