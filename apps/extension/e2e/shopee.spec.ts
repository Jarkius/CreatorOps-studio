import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';
import { pngBytes } from './png.js';
import { api, API_URL } from './seed.js';

const card = (id: number, name: string, price: string, commission: string, sold: string) => `
  <div class="offer">
    <a href="https://shopee.co.th/${encodeURIComponent(name)}-i.777.${id}?sp_atk=token"><img alt="${name}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>
    <div><span>${name}</span></div>
    <div><span>฿${price}</span></div>
    <div><span>ค่าคอมมิชชั่น</span><span>${commission}%</span></div>
    <div><span>ขายแล้ว ${sold}</span></div>
  </div>`;

const FAKE_LIST = `<!doctype html><html><head><meta charset="utf-8"><title>Shopee Affiliate</title></head><body>
<header><button>เข้าสู่ระบบ</button></header><main>
${card(1, 'พัดลมพกพา', '199', '6', '10k')}
${card(2, 'เครื่องชงกาแฟพกพา', '1,290', '12.5', '1.2พัน')}
${card(3, 'แก้วเก็บความเย็น', '350', '9', '87')}
</main></body></html>`;

const TRAFFIC_CHECK = `<!doctype html><html><head><meta charset="utf-8"><title>Shopee</title></head><body>
<p>เข้าสู่หน้าที่ต้องการไม่สำเร็จ</p></body></html>`;

/** Serves a fake Shopee Affiliate site: no network, no real site. */
async function fakeShopee(context: BrowserContext, html: string): Promise<Page> {
  await context.route('https://affiliate.shopee.co.th/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  // The owner's own tab, already open on the product list.
  const tab = await context.newPage();
  await tab.goto('https://affiliate.shopee.co.th/offer/product_offer');
  return tab;
}

test('Import from Shopee lists the products by commission and creates a product from one', async ({
  context,
  extensionId,
  request,
}) => {
  const shopee = await fakeShopee(context, FAKE_LIST);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const region = panel.getByRole('region', { name: 'Shopee Affiliate' });
  await region.getByRole('button', { name: 'Import from Shopee affiliate page' }).click();

  const list = region.getByRole('list', { name: 'Shopee offers' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('listitem').first()).toContainText('เครื่องชงกาแฟพกพา');
  await expect(list.getByRole('listitem').first()).toContainText('Commission 12.5%');

  await region.getByRole('button', { name: 'Create product from เครื่องชงกาแฟพกพา' }).click();
  await expect(region.getByRole('link', { name: 'Product created: open it' })).toBeVisible();

  // The product is on the server with the price in baht and the clean Shopee link.
  const { token } = (await (await request.post(`${API_URL}/api/v1/auth/mock-token`)).json()) as {
    token: string;
  };
  const me = await api<{ workspaces: { id: string }[] }>(request, token, 'GET', '/api/v1/me');
  const products = await api<{
    items: { name: string; priceAmount: string; currency: string; sourceUrl: string }[];
  }>(request, token, 'GET', `/api/v1/workspaces/${me.workspaces[0]?.id}/products?limit=5`);
  const made = products.items.find((item) => item.name === 'เครื่องชงกาแฟพกพา');
  expect(made).toMatchObject({ priceAmount: '1290.00', currency: 'THB' });
  expect(made?.sourceUrl).toBe(
    `https://shopee.co.th/${encodeURIComponent('เครื่องชงกาแฟพกพา')}-i.777.2`,
  );

  // The importer only read the page: nothing was typed or changed there.
  await expect(shopee.locator('main .offer')).toHaveCount(3);
});

test("Import from Shopee stops on Shopee's traffic check and says so", async ({
  context,
  extensionId,
}) => {
  await fakeShopee(context, TRAFFIC_CHECK);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const region = panel.getByRole('region', { name: 'Shopee Affiliate' });
  await region.getByRole('button', { name: 'Import from Shopee affiliate page' }).click();
  await expect(region.getByRole('alert')).toContainText('Shopee is showing a check');
  await expect(region.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible();
});

/**
 * A fake paged list: two products per page, a tall page (so the first step is a scroll), and a
 * Next button at the bottom that swaps the products. `checkOnPage` makes that page show Shopee's
 * traffic check instead of products.
 */
function pagedList(pages: number, checkOnPage = 0): string {
  const cards = (page: number) =>
    [1, 2]
      .map((n) => {
        const id = page * 10 + n;
        return card(id, `สินค้าหน้า${page}-${n}`, `${100 + id}`, `${page + n}`, '5');
      })
      .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Shopee Affiliate</title></head><body>
<main id="list"></main><div style="height:2500px"></div>
<button id="next" aria-label="Next" style="display:block;width:60px;height:30px">›</button>
<script>
  const cards = ${JSON.stringify([1, 2, 3, 4, 5].slice(0, pages).map((page) => cards(page)))};
  let page = 1;
  const show = () => {
    if (page === ${checkOnPage}) {
      document.body.innerHTML = '<p>เข้าสู่หน้าที่ต้องการไม่สำเร็จ</p>';
      return;
    }
    document.getElementById('list').innerHTML = cards[page - 1];
    document.getElementById('next').disabled = page >= cards.length;
  };
  document.getElementById('next').addEventListener('click', () => { page += 1; show(); });
  show();
</script></body></html>`;
}

async function importWithLoadMore(context: BrowserContext, extensionId: string, html: string) {
  await fakeShopee(context, html);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const region = panel.getByRole('region', { name: 'Shopee Affiliate' });
  await region.getByRole('checkbox', { name: /Load more of the list/ }).check();
  await region.getByRole('button', { name: 'Import from Shopee affiliate page' }).click();
  return region;
}

test('Load more scrolls, presses Next, merges every page and stops at the end of the list', async ({
  context,
  extensionId,
}) => {
  const region = await importWithLoadMore(context, extensionId, pagedList(3));
  // The first step is a scroll, then Next is pressed twice; the button is then disabled.
  await expect(region.getByRole('status').filter({ hasText: 'Reached the end' })).toBeVisible({
    timeout: 30_000,
  });
  const list = region.getByRole('list', { name: 'Shopee offers' });
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await expect(list).toContainText('สินค้าหน้า1-1');
  await expect(list).toContainText('สินค้าหน้า3-2');
});

test('Load more stops at a Shopee check, keeps the products already read and does not go on', async ({
  context,
  extensionId,
}) => {
  const region = await importWithLoadMore(context, extensionId, pagedList(3, 2));
  await expect(
    region.getByRole('status').filter({ hasText: 'Shopee is showing a check' }),
  ).toBeVisible({ timeout: 30_000 });
  const list = region.getByRole('list', { name: 'Shopee offers' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('สินค้าหน้า1-1');
});

/** The photo lives on a separate CDN-style host, like Shopee's, so the download is cross-origin. */
const CDN_PHOTO = 'https://down-th.img.susercontent.com/file/fake-mug';
const photoList = (
  name: string,
) => `<!doctype html><html><head><meta charset="utf-8"><title>Shopee Affiliate</title></head><body><main>
  <div class="offer">
    <a href="https://shopee.co.th/mug-i.777.9"><img alt="${name}" src="${CDN_PHOTO}"></a>
    <div><span>${name}</span></div><div><span>฿159</span></div>
    <div><span>ค่าคอมมิชชั่น</span><span>10%</span></div>
  </div></main></body></html>`;

async function createWithPhoto(
  context: BrowserContext,
  extensionId: string,
  allowed: boolean,
  name: string,
) {
  // A fulfilled route passes Chrome's CORS check even without the header (checked 2026-11-08), so
  // a refused download is modelled as a failed request, which is what fetch sees on a CORS refusal.
  // Whether Shopee's real CDN allows the download is only known from the owner's run.
  await context.route(CDN_PHOTO, (route) =>
    allowed
      ? route.fulfill({
          status: 200,
          contentType: 'image/png',
          headers: { 'access-control-allow-origin': '*' },
          body: pngBytes(),
        })
      : route.abort('failed'),
  );
  await fakeShopee(context, photoList(name));
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const region = panel.getByRole('region', { name: 'Shopee Affiliate' });
  await region.getByRole('button', { name: 'Import from Shopee affiliate page' }).click();
  await region.getByRole('button', { name: `Create product from ${name}` }).click();
  await expect(region.getByRole('link', { name: 'Product created: open it' })).toBeVisible();
  return region;
}

async function productNamed(request: Parameters<typeof api>[0], name: string) {
  const { token } = (await (await request.post(`${API_URL}/api/v1/auth/mock-token`)).json()) as {
    token: string;
  };
  const me = await api<{ workspaces: { id: string }[] }>(request, token, 'GET', '/api/v1/me');
  const products = await api<{ items: { name: string; primaryAssetId: string | null }[] }>(
    request,
    token,
    'GET',
    `/api/v1/workspaces/${me.workspaces[0]?.id}/products?limit=20`,
  );
  return products.items.find((item) => item.name === name);
}

test('Create product saves the Shopee photo from a CDN that allows it, as the cover', async ({
  context,
  extensionId,
  request,
}) => {
  const region = await createWithPhoto(context, extensionId, true, 'แก้วมัคมีรูป');
  await expect(region.getByText('Photo saved as the cover')).toBeVisible();
  expect((await productNamed(request, 'แก้วมัคมีรูป'))?.primaryAssetId).toBeTruthy();
});

test('when the photo download fails, the product is still created and the panel says why', async ({
  context,
  extensionId,
  request,
}) => {
  const region = await createWithPhoto(context, extensionId, false, 'แก้วมัคไม่มีรูป');
  await expect(region.getByRole('alert')).toContainText(
    'photo not saved: Shopee did not let the photo be downloaded',
  );
  const made = await productNamed(request, 'แก้วมัคไม่มีรูป');
  expect(made).toBeTruthy();
  expect(made?.primaryAssetId).toBeNull();
});
