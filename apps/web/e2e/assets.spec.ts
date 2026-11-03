import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

const API = 'http://localhost:3000/api/v1';
const API_ORIGIN = 'http://localhost:3000';
const THAI = 'พัดลมตั้งโต๊ะ';

/**
 * A 1x1 PNG whose chunks all have valid CRCs. (The commonly quoted one with `...R4nGP4z8...` has a
 * bad IDAT CRC: libpng rejects it, so the server correctly refuses it as unreadable.)
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** An MP4 stub: a 24-byte ftyp box, then padding. Enough for the server's type check. */
const MP4_STUB = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(256),
]);

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

/**
 * The dev user's first workspace (the seeded one). Tests do not create workspaces: the account has a
 * limit of 20, and each test here uses unique file and product names instead.
 */
async function seededWorkspace(request: APIRequestContext, auth: Auth): Promise<string> {
  const response = await request.get(`${API}/workspaces`, { headers: auth.headers });
  const body = (await response.json()) as { items: { id: string }[] };
  const first = body.items[0];
  if (first === undefined) throw new Error('The dev user has no workspace; run the seed first.');
  return first.id;
}

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
  return (await response.json()) as { id: string; version: number; primaryAssetId: string | null };
}

async function getProduct(
  request: APIRequestContext,
  auth: Auth,
  workspaceId: string,
  productId: string,
) {
  const response = await request.get(`${API}/workspaces/${workspaceId}/products/${productId}`, {
    headers: auth.headers,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; version: number; primaryAssetId: string | null };
}

/** Uploads bytes through the real three steps and returns the asset. */
async function createAsset(
  request: APIRequestContext,
  auth: Auth,
  workspaceId: string,
  file: { name: string; mimeType: string; bytes: Buffer; productId?: string },
) {
  const intent = await request.post(`${API}/workspaces/${workspaceId}/assets/upload-intent`, {
    headers: auth.headers,
    data: {
      filename: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
      ...(file.productId === undefined ? {} : { productId: file.productId }),
    },
  });
  expect(intent.status()).toBe(201);
  const { intentId, uploadUrl, contentType } = (await intent.json()) as {
    intentId: string;
    uploadUrl: string;
    contentType: string;
  };

  const put = await request.put(new URL(uploadUrl, API_ORIGIN).toString(), {
    headers: { 'content-type': contentType },
    data: file.bytes,
  });
  expect(put.status()).toBe(204);

  const completed = await request.post(`${API}/workspaces/${workspaceId}/assets/complete-upload`, {
    headers: auth.headers,
    data: { intentId },
  });
  expect(completed.ok()).toBe(true);
  return (await completed.json()) as { id: string; originalFilename: string };
}

/** Moves keyboard focus with Tab until the locator is focused, failing after a bounded number of tries. */
async function tabTo(page: Page, target: Locator, maxTabs = 60): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('The target was not reachable with Tab.');
}

/** The file input is labelled; it is the same control the Choose files button opens. */
const fileInput = (page: Page) => page.getByLabel('Upload files');

/** The gallery tile for a file. Scoped to the gallery, because the queue has a Remove button per file too. */
const galleryTile = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Files' }).getByRole('button', { name });

test.describe('asset library', () => {
  test('uploads a PNG through the file input and shows it with a really loaded thumbnail', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const name = `Desk lamp ${Date.now()}.png`;

    await page.goto(`/w/${workspaceId}/assets`);
    await expect(page.getByRole('heading', { name: 'Asset library' })).toBeVisible();
    await fileInput(page).setInputFiles({ name, mimeType: 'image/png', buffer: PNG_1X1 });

    await expect(galleryTile(page, name)).toBeVisible();
    await expect(page.locator('[aria-live="polite"]')).toContainText(`${name} uploaded.`);
    const thumbnail = page.getByRole('img', { name, exact: true });
    await expect
      .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('keeps a Thai file name whole in the queue and the gallery', async ({ page, request }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const name = `${THAI} ${Date.now()}.png`;

    await page.goto(`/w/${workspaceId}/assets`);
    await fileInput(page).setInputFiles({ name, mimeType: 'image/png', buffer: PNG_1X1 });

    await expect(galleryTile(page, name)).toBeVisible();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test('uploads an MP4 stub and shows it as a video tile', async ({ page, request }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const name = `Clip ${Date.now()}.mp4`;

    await page.goto(`/w/${workspaceId}/assets`);
    await fileInput(page).setInputFiles({ name, mimeType: 'video/mp4', buffer: MP4_STUB });

    const tile = galleryTile(page, name);
    await expect(tile).toBeVisible();
    await expect(tile).toContainText('Video');
  });

  test('opens the preview with focus inside, and Escape closes it and returns focus', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const file = await createAsset(request, auth, workspaceId, {
      name: `Preview ${Date.now()}.png`,
      mimeType: 'image/png',
      bytes: PNG_1X1,
    });

    await page.goto(`/w/${workspaceId}/assets`);
    const tile = galleryTile(page, file.originalFilename);
    await tile.click();

    const dialog = page.getByRole('dialog', { name: file.originalFilename });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(tile).toBeFocused();
  });

  test('a text file named fake.png is refused by the server, shown as failed, and can be retried or removed', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const statuses: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/uploads/')) statuses.push(response.status());
    });

    await page.goto(`/w/${workspaceId}/assets`);
    await fileInput(page).setInputFiles({
      name: 'fake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is plain text, not a picture'),
    });

    const row = page.getByRole('listitem').filter({ hasText: 'fake.png' });
    await expect(row.getByText(/^Failed: /)).toBeVisible();
    await expect(row.getByRole('button', { name: 'Retry fake.png' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Remove fake.png' })).toBeVisible();
    await expect.poll(() => statuses).toContain(415);
    await expect(page.locator('[aria-live="polite"]')).toContainText('fake.png failed:');

    await row.getByRole('button', { name: 'Remove fake.png' }).click();
    await expect(row).toHaveCount(0);
  });

  test('a 16 MB image is refused in the browser with no request to the API', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);

    await page.goto(`/w/${workspaceId}/assets`);
    // The library may already hold files from earlier runs; wait for it to finish loading.
    await expect(
      page
        .getByRole('list', { name: 'Files' })
        .or(page.getByRole('heading', { name: 'No files yet' })),
    ).toBeVisible();

    const apiRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().startsWith(API_ORIGIN)) apiRequests.push(req.url());
    });
    const name = `Too big ${Date.now()}.png`;
    await fileInput(page).setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: Buffer.alloc(16 * 1024 * 1024 + 1),
    });

    const row = page.getByRole('listitem').filter({ hasText: name });
    await expect(row.getByText(/Failed: Images can be up to 15\.0 MB/)).toBeVisible();
    expect(apiRequests).toEqual([]);
  });

  test('an SVG is refused in the browser with no request to the API', async ({ page, request }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);

    await page.goto(`/w/${workspaceId}/assets`);
    // The library may already hold files from earlier runs; wait for it to finish loading.
    await expect(
      page
        .getByRole('list', { name: 'Files' })
        .or(page.getByRole('heading', { name: 'No files yet' })),
    ).toBeVisible();

    const apiRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().startsWith(API_ORIGIN)) apiRequests.push(req.url());
    });
    await fileInput(page).setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });

    const row = page.getByRole('listitem').filter({ hasText: 'logo.svg' });
    await expect(row.getByText(/Failed: This file type is not supported/)).toBeVisible();
    expect(apiRequests).toEqual([]);
  });

  test('the Choose files button is reachable by Tab and opens the file picker', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);

    await page.goto(`/w/${workspaceId}/assets`);
    const choose = page.getByRole('button', { name: 'Choose files' });
    await tabTo(page, choose);
    await expect(choose).toBeFocused();

    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    expect(await chooser).toBeTruthy();
  });

  test('the library has no WCAG 2.0 A/AA violations, with files and a failed row', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const file = await createAsset(request, auth, workspaceId, {
      name: `Audit ${Date.now()}.png`,
      mimeType: 'image/png',
      bytes: PNG_1X1,
    });

    await page.goto(`/w/${workspaceId}/assets`);
    await expect(galleryTile(page, file.originalFilename)).toBeVisible();
    await fileInput(page).setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect(page.getByText(/Failed: This file type is not supported/)).toBeVisible();

    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations;
    expect(violations.map((violation) => violation.id)).toEqual([]);
  });
});

test.describe('product images', () => {
  test('sets a picture as the cover, then deleting the cover clears it', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const product = await createProduct(request, auth, workspaceId, `Lamp ${Date.now()}`);
    const file = await createAsset(request, auth, workspaceId, {
      name: `Lamp shot ${Date.now()}.png`,
      mimeType: 'image/png',
      bytes: PNG_1X1,
      productId: product.id,
    });

    await page.goto(`/w/${workspaceId}/products/${product.id}`);
    await galleryTile(page, file.originalFilename).click();

    const dialog = page.getByRole('dialog', { name: file.originalFilename });
    await dialog.getByRole('button', { name: 'Use as cover' }).click();

    await expect(dialog.getByText('Cover', { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await getProduct(request, auth, workspaceId, product.id)).primaryAssetId)
      .toBe(file.id);
    await expect(
      galleryTile(page, file.originalFilename).getByText('Cover', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: `Cover: ${file.originalFilename}` })).toBeVisible();

    await dialog.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();

    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await getProduct(request, auth, workspaceId, product.id)).primaryAssetId)
      .toBeNull();
    await expect(page.getByRole('img', { name: /^Cover:/ })).toHaveCount(0);
  });

  test('the Images and videos section has no WCAG 2.0 A/AA violations', async ({
    page,
    request,
  }) => {
    const auth = await authFor(request);
    const workspaceId = await seededWorkspace(request, auth);
    const product = await createProduct(request, auth, workspaceId, `Mic ${Date.now()}`);
    const mic = await createAsset(request, auth, workspaceId, {
      name: `Mic front ${Date.now()}.png`,
      mimeType: 'image/png',
      bytes: PNG_1X1,
      productId: product.id,
    });

    await page.goto(`/w/${workspaceId}/products/${product.id}`);
    await expect(galleryTile(page, mic.originalFilename)).toBeVisible();

    const violations = (
      await new AxeBuilder({ page })
        .include('#product-images')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()
    ).violations;
    expect(violations.map((violation) => violation.id)).toEqual([]);
  });
});
