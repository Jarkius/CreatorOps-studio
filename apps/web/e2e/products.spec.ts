import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

const API = 'http://localhost:3000/api/v1';
const THAI = 'พัดลมตั้งโต๊ะ';

interface Auth {
  headers: Record<string, string>;
}

/** Development token from the mock auth endpoint. The browser gets its own in-memory token. */
async function authFor(request: APIRequestContext): Promise<Auth> {
  const response = await request.post(`${API}/auth/mock-token`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { token: string };
  return { headers: { authorization: `Bearer ${body.token}` } };
}

/** The dev user's first workspace (the list is ordered by creation, so this stays the seeded one). */
async function firstWorkspaceId(request: APIRequestContext, auth: Auth): Promise<string> {
  const response = await request.get(`${API}/workspaces`, { headers: auth.headers });
  const body = (await response.json()) as { items: { id: string }[] };
  const first = body.items[0];
  if (first === undefined) throw new Error('The dev user has no workspace; run the seed first.');
  return first.id;
}

/** Creates a product straight through the API and returns the saved record. */
async function createProduct(
  request: APIRequestContext,
  auth: Auth,
  workspaceId: string,
  name: string,
) {
  const response = await request.post(`${API}/workspaces/${workspaceId}/products`, {
    headers: auth.headers,
    data: { name, sellingPoints: [], restrictedClaims: [] },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string; version: number };
}

/** Moves keyboard focus with Tab until the locator is focused, failing after a bounded number of tries. */
async function tabTo(page: Page, target: Locator, maxTabs = 60): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('The target was not reachable with Tab.');
}

test.describe('products', () => {
  test('creates a product through the form with a Thai name and two selling points', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);
    const name = `${THAI} ${Date.now()}`;

    await page.goto(`/w/${workspaceId}/products`);
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByRole('link', { name: 'Create product' }).first().click();

    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add selling point' }).click();
    await page.getByRole('button', { name: 'Add selling point' }).click();
    await page.getByLabel('Selling point 1', { exact: true }).fill('Quiet motor');
    await page.getByLabel('Selling point 2', { exact: true }).fill('Three speeds');
    await page.getByRole('button', { name: 'Create product' }).click();

    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/products/[^/]+$`));
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to products' }).click();
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(page.getByText(THAI, { exact: false }).first()).toBeVisible();
  });

  test('edits a product and the list shows the new name', async ({ page, request }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);
    const original = `Desk fan ${Date.now()}`;
    const product = await createProduct(request, auth, workspaceId, original);

    await page.goto(`/w/${workspaceId}/products`);
    await page.getByRole('link', { name: original, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${product.id}$`));

    const edited = `${THAI} ${Date.now()}`;
    await page.getByLabel('Name', { exact: true }).fill(edited);
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Product saved' })).toBeVisible();

    await page.getByRole('link', { name: 'Back to products' }).click();
    await expect(page.getByRole('link', { name: edited, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: original, exact: true })).toHaveCount(0);
  });

  test('shows validation messages for an empty name and a javascript: source URL', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);

    await page.goto(`/w/${workspaceId}/products/new`);
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page.getByText('Enter a product name.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel('Name', { exact: true }).fill(`Lamp ${Date.now()}`);
    await page.getByLabel('Source URL').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page.getByText(/Use a full link that starts with http/)).toBeVisible();
    await expect(page.getByLabel('Source URL')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/products/new$`));
  });

  test('archives through the dialog, shows it under Archived, then restores it', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);
    const name = `Ring light ${Date.now()}`;
    const product = await createProduct(request, auth, workspaceId, name);

    await page.goto(`/w/${workspaceId}/products/${product.id}`);
    await page.getByRole('button', { name: 'Archive' }).click();
    const dialog = page.getByRole('alertdialog', { name: `Archive ${name}?` });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive product' }).click();

    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/products$`));
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: 'Archived', exact: true }).click();
    await page.getByRole('link', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Product restored' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
  });

  test('a save over someone else change shows the conflict, and Load latest shows their version', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);
    const name = `Tripod ${Date.now()}`;
    const product = await createProduct(request, auth, workspaceId, name);

    await page.goto(`/w/${workspaceId}/products/${product.id}`);
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);

    // Another person saves first, so this page's version is now stale.
    const elsewhere = `${name} (elsewhere)`;
    const theirs = await request.patch(`${API}/workspaces/${workspaceId}/products/${product.id}`, {
      headers: auth.headers,
      data: { version: product.version, name: elsewhere },
    });
    expect(theirs.ok()).toBe(true);

    await page.getByLabel('Name', { exact: true }).fill(`${name} (mine)`);
    await page.getByRole('button', { name: 'Save product' }).click();

    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'This product was changed by someone else.' });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Load latest' }).click();

    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(elsewhere);
    await expect(
      page.getByRole('alert').filter({ hasText: 'changed by someone else' }),
    ).toHaveCount(0);
  });

  test('a brand-new workspace shows the empty product list', async ({ page, request }) => {
    const auth = await authFor(request);
    const created = await request.post(`${API}/workspaces`, {
      headers: auth.headers,
      data: { name: `E2E empty ${Date.now()}` },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/w/${id}/products`);

    await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create product' }).first()).toBeVisible();
  });

  test('the product list, the form and the form with errors have no WCAG 2.0 A/AA violations', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);
    const name = `Mic stand ${Date.now()}`;
    await createProduct(request, auth, workspaceId, name);

    const audit = async () =>
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(
        (violation) => violation.id,
      );

    await page.goto(`/w/${workspaceId}/products`);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    expect(await audit()).toEqual([]);

    await page.goto(`/w/${workspaceId}/products/new`);
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    expect(await audit()).toEqual([]);

    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page.getByText('Enter a product name.')).toBeVisible();
    expect(await audit()).toEqual([]);
  });

  test('the product list is reachable and operable by keyboard', async ({ page, request }) => {
    const auth = await authFor(request);
    const workspaceId = await firstWorkspaceId(request, auth);

    await page.goto(`/w/${workspaceId}/products`);
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

    const archivedTab = page.getByRole('link', { name: 'Archived', exact: true });
    await tabTo(page, archivedTab);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?status=archived$/);
    await expect(archivedTab).toHaveAttribute('aria-current', 'page');

    // The Create link comes before the tabs in the page, so start again from the top of the list.
    await page.goto(`/w/${workspaceId}/products`);
    const createLink = page.getByRole('link', { name: 'Create product' }).first();
    await tabTo(page, createLink);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'New product' })).toBeVisible();
  });
});
