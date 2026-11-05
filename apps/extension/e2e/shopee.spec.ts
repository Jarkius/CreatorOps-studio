import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';
import { api, API_URL } from './seed.js';

const card = (id: number, name: string, price: string, commission: string, sold: string) => `
  <div class="offer">
    <a href="https://shopee.co.th/${encodeURIComponent(name)}-i.777.${id}?sp_atk=token"><img alt="${name}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>
    <div><span>${name}</span></div>
    <div><span>฿${price}</span></div>
    <div><span>ค่าคอมมิชชั่น</span><span>${commission}%</span></div>
    <div><span>ขายแล้ว ${sold}</span></div>
  </div>`;

const FAKE_LIST = `<!doctype html><html><head><title>Shopee Affiliate</title></head><body>
<header><button>เข้าสู่ระบบ</button></header><main>
${card(1, 'พัดลมพกพา', '199', '6', '10k')}
${card(2, 'เครื่องชงกาแฟพกพา', '1,290', '12.5', '1.2พัน')}
${card(3, 'แก้วเก็บความเย็น', '350', '9', '87')}
</main></body></html>`;

const TRAFFIC_CHECK = `<!doctype html><html><head><title>Shopee</title></head><body>
<p>เข้าสู่หน้าที่ต้องการไม่สำเร็จ</p></body></html>`;

/** Serves a fake Shopee Affiliate site: no network, no real site. */
async function fakeShopee(context: BrowserContext, html: string): Promise<Page> {
  await context.route('https://affiliate.shopee.co.th/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
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
  const region = panel.getByRole('region', { name: 'Shopee products' });
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
  const region = panel.getByRole('region', { name: 'Shopee products' });
  await region.getByRole('button', { name: 'Import from Shopee affiliate page' }).click();
  await expect(region.getByRole('alert')).toContainText('Shopee is showing a check');
  await expect(region.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible();
});
