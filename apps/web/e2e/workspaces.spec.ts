import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

const API = 'http://localhost:3000/api/v1';
const THAI = 'ร้านสมชาย';

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

/** Moves keyboard focus with Tab until the locator is focused, failing after a bounded number of tries. */
async function tabTo(page: Page, target: Locator, maxTabs = 60): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('The target was not reachable with Tab.');
}

test.describe('workspaces', () => {
  test('creates a workspace with a Thai name from the sidebar and lands on its empty products page', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const seededId = await firstWorkspaceId(request, auth);
    const name = `${THAI} ${Date.now()}`;

    await page.goto(`/w/${seededId}/products`);
    await page.getByRole('link', { name: 'New workspace' }).click();
    await expect(page.getByRole('heading', { name: 'New workspace', level: 1 })).toBeVisible();

    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect(page).toHaveURL(/\/w\/[^/]+\/products$/);
    const newId = new URL(page.url()).pathname.split('/')[2];
    expect(newId).not.toBe(seededId);
    await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible();

    const switcher = page.getByRole('combobox', { name: 'Workspace' });
    await expect(switcher).toHaveValue(newId ?? '');
    await expect(switcher.getByRole('option', { name, exact: true })).toHaveCount(1);
  });

  test('the new workspace can be selected in the switcher', async ({ page, request }) => {
    const auth = await authFor(request);
    const seededId = await firstWorkspaceId(request, auth);
    const name = `${THAI} ${Date.now()}`;
    const created = await request.post(`${API}/workspaces`, {
      headers: auth.headers,
      data: { name, defaultLanguage: 'th' },
    });
    expect(created.status()).toBe(201);
    const { id: newId } = (await created.json()) as { id: string };

    await page.goto(`/w/${seededId}/products`);
    const switcher = page.getByRole('combobox', { name: 'Workspace' });
    await expect(switcher.getByRole('option', { name, exact: true })).toHaveCount(1);

    await switcher.selectOption(newId);
    await expect(page).toHaveURL(new RegExp(`/w/${newId}/products$`));
    await expect(switcher).toHaveValue(newId);
    await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible();
  });

  test('an empty name shows the required message and sends nothing', async ({ page }) => {
    await page.goto('/workspaces/new');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect(page.getByText('Enter a workspace name.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/workspaces\/new$/);
  });

  test('the form, and the form with errors, have no WCAG 2.0 A/AA violations', async ({ page }) => {
    const audit = async () =>
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(
        (violation) => violation.id,
      );

    await page.goto('/workspaces/new');
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    expect(await audit()).toEqual([]);

    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByText('Enter a workspace name.')).toBeVisible();
    expect(await audit()).toEqual([]);
  });

  test('a workspace is created with the keyboard only', async ({ page }) => {
    const name = `Keyboard ${THAI} ${Date.now()}`;

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    const newLink = page.getByRole('link', { name: 'New workspace' });
    await tabTo(page, newLink);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'New workspace', level: 1 })).toBeVisible();

    const nameInput = page.getByLabel('Name', { exact: true });
    await tabTo(page, nameInput);
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/w\/[^/]+\/products$/);
    await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible();
  });
});
