import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3000/api/v1';

interface Auth {
  headers: Record<string, string>;
}

async function authFor(request: APIRequestContext): Promise<Auth> {
  const response = await request.post(`${API}/auth/mock-token`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { token: string };
  return { headers: { authorization: `Bearer ${body.token}` } };
}

async function firstWorkspaceId(request: APIRequestContext, auth: Auth): Promise<string> {
  const response = await request.get(`${API}/workspaces`, { headers: auth.headers });
  const body = (await response.json()) as { items: { id: string }[] };
  const first = body.items[0];
  if (first === undefined) throw new Error('The dev user has no workspace; run the seed first.');
  return first.id;
}

/** A product and a one-variant Thai campaign on it, created through the API. */
async function createCampaign(
  request: APIRequestContext,
  auth: Auth,
  workspaceId: string,
  name: string,
  productName = `สินค้า ${name}`,
): Promise<{ id: string }> {
  const base = `${API}/workspaces/${workspaceId}`;
  const productResponse = await request.post(`${base}/products`, {
    headers: auth.headers,
    data: { name: productName, sellingPoints: ['ลมแรง เงียบ'], restrictedClaims: [] },
  });
  expect(productResponse.status()).toBe(201);
  const product = (await productResponse.json()) as { id: string };
  const templatesResponse = await request.get(`${base}/templates`, { headers: auth.headers });
  const templates = (await templatesResponse.json()) as {
    items: { id: string; version: number }[];
  };
  const template = templates.items[0];
  if (template === undefined) throw new Error('No template is available');
  const response = await request.post(`${base}/campaigns`, {
    headers: auth.headers,
    data: {
      productId: product.id,
      templateId: template.id,
      templateVersion: template.version,
      name,
      language: 'th',
      platform: 'tiktok',
      variants: 1,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

test.describe('campaigns and drafts (real API, worker and Redis)', () => {
  test('Generate runs through the worker, the draft opens, a section is edited and saved', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);
    const name = `e2e ${Date.now()}`;
    const campaign = await createCampaign(request, auth, workspaceId, name);

    await page.goto(`/w/${workspaceId}/campaigns/${campaign.id}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('No drafts yet')).toBeVisible();

    await page.getByRole('button', { name: 'Generate content' }).click();

    // The worker picks the job up and writes the draft; the page polls until it appears.
    const drafts = page.getByRole('list', { name: 'Drafts' });
    await expect(drafts).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Generation job' })).toContainText(
      /succeeded|done|ready/i,
    );

    await drafts.getByRole('link', { name: 'Variant 1' }).click();
    await expect(page).toHaveURL(/\/drafts\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Variant 1' })).toBeVisible();

    const caption = page.getByRole('region', { name: 'Caption' });
    await caption.getByRole('button', { name: 'Edit' }).click();
    const edited = `แก้ไขข้อความ ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Caption' }).fill(edited);
    await caption.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(caption).toContainText(edited);

    // Regenerating a different section runs through the worker and leaves the edited caption alone.
    const hook = page.getByRole('region', { name: 'Hook' });
    await hook.getByRole('button', { name: 'Regenerate' }).click();
    await expect(hook.getByRole('button', { name: 'Regenerate' })).toBeEnabled({ timeout: 30_000 });
    await expect(caption).toContainText(edited);

    // The edit is durable: it is still there after a reload.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Caption' })).toContainText(edited);
  });

  test('a refused generation fails at once with a plain message and offers Try again', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);
    const name = `e2e refused ${Date.now()}`;
    // The mock provider refuses a product whose text carries this marker: a permanent error, so
    // the worker must not retry it.
    const campaign = await createCampaign(
      request,
      auth,
      workspaceId,
      name,
      'สินค้าทดสอบ [[mock:refused]]',
    );

    await page.goto(`/w/${workspaceId}/campaigns/${campaign.id}`);
    await page.getByRole('button', { name: 'Generate content' }).click();

    const job = page.getByRole('region', { name: 'Generation job' });
    await expect(job).toContainText('The text provider refused to generate this content.', {
      timeout: 30_000,
    });
    await expect(job.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('No drafts yet')).toBeVisible();

    // One attempt only: a permanent error is never retried.
    const jobs = await request.get(
      `${API}/workspaces/${workspaceId}/jobs?campaignId=${campaign.id}`,
      {
        headers: auth.headers,
      },
    );
    const body = (await jobs.json()) as { items: { status: string; attempts: number }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });
});
