// Captures real screenshots of the running dashboard and the extension side panel into
// docs/screenshots. It uses its own throw-away database (creatorops_e2e) and a temp media folder.
//
// Usage (after `pnpm build` and an extension e2e build, `apps/extension/dist-e2e`, which has mock
// sign-in and the optional site permissions granted; `pnpm --filter @creatorops/extension e2e`
// makes it). Needs PostgreSQL and Redis running (`pnpm dev:db`, `pnpm dev:redis`):
//   export DATABASE_URL="$(bash scripts/pg-local.sh url)"
//   export REDIS_URL="$(bash scripts/redis-local.sh url)"
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/capture-screenshots.mjs
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFrom = (pkg) => createRequire(path.join(root, pkg, 'package.json'));
const { chromium } = requireFrom('apps/web')('@playwright/test');
const sharp = requireFrom('apps/api')('sharp');

const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = path.join(root, 'docs', 'screenshots');
const devKey = JSON.parse(
  await readFile(path.join(root, 'apps/extension/dev-extension-key.json'), 'utf8'),
);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
if (!process.env.REDIS_URL) throw new Error('REDIS_URL is not set.');
const dbUrl = new URL(process.env.DATABASE_URL);
dbUrl.pathname = '/creatorops_e2e';

execFileSync(process.execPath, [path.join(root, 'scripts/e2e-db.mjs')], {
  env: process.env,
  stdio: 'inherit',
});

const children = [];
function start(cmd, args, cwd, env) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  children.push(child);
}
async function waitFor(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'creatorops-shots-'));
start(process.execPath, ['apps/api/dist/server.js'], root, {
  DATABASE_URL: dbUrl.toString(),
  AUTH_MODE: 'mock',
  API_BASE_URL: API,
  WEB_ORIGIN: WEB,
  EXTENSION_ORIGIN: `chrome-extension://${devKey.id}`,
  SESSION_SECRET: 'a-long-screenshot-only-secret-0123456789abcdef',
  // Screenshot-only key (32 zero bytes) so Settings shows its normal form, not the missing-key notice.
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  PORT: '3000',
  LOG_LEVEL: 'warn',
  DATA_DIR: dataDir,
  REDIS_URL: process.env.REDIS_URL,
});
start(process.execPath, ['apps/api/dist/worker.js'], root, {
  DATABASE_URL: dbUrl.toString(),
  REDIS_URL: process.env.REDIS_URL,
  AUTH_MODE: 'mock',
  API_BASE_URL: API,
  WEB_ORIGIN: WEB,
  EXTENSION_ORIGIN: `chrome-extension://${devKey.id}`,
  SESSION_SECRET: 'a-long-screenshot-only-secret-0123456789abcdef',
  // Screenshot-only key (32 zero bytes) so Settings shows its normal form, not the missing-key notice.
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  LOG_LEVEL: 'warn',
  DATA_DIR: dataDir,
});
start(
  path.join(root, 'apps/web/node_modules/.bin/vite'),
  ['preview', '--port', '5173', '--strictPort'],
  path.join(root, 'apps/web'),
  {},
);

async function api(token, method, url, body) {
  const response = await fetch(`${API}/api/v1${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status}`);
  return response.json();
}

async function waitForJob(token, workspaceId, jobId) {
  for (let i = 0; i < 60; i += 1) {
    const job = await api(token, 'GET', `/workspaces/${workspaceId}/jobs/${jobId}`);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`Job ${jobId} ${job.status}: ${job.errorCode ?? ''}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

async function startJob(token, workspaceId, route, body) {
  const response = await fetch(`${API}/api/v1/workspaces/${workspaceId}/jobs/${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `shots-${route}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${route} -> ${response.status}`);
  return response.json();
}

async function photo(r, g, b) {
  return sharp({ create: { width: 900, height: 700, channels: 3, background: { r, g, b } } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="900" height="700"><circle cx="450" cy="350" r="200" fill="rgb(255,255,255)" fill-opacity="0.35"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
}

let exitCode = 0;
try {
  await waitFor(`${API}/api/v1/health`);
  await waitFor(WEB);
  await mkdir(OUT, { recursive: true });

  const { token } = await (await fetch(`${API}/api/v1/auth/mock-token`, { method: 'POST' })).json();
  const { items } = await api(token, 'GET', '/workspaces');
  const ws = items[0];
  const products = [
    {
      name: 'โคมไฟตั้งโต๊ะ LED ถนอมสายตา',
      description: 'โคมไฟปรับแสงได้ 3 ระดับ เหมาะกับการอ่านหนังสือและทำงานตอนกลางคืน',
      priceAmount: '590',
      currency: 'THB',
      sellingPoints: ['ปรับความสว่างได้ 3 ระดับ', 'ไม่มีแสงกะพริบ', 'ชาร์จผ่าน USB-C'],
      targetAudience: 'นักศึกษาและคนทำงานที่ทำงานตอนกลางคืน',
      brandTone: 'เป็นกันเอง กระชับ',
      restrictedClaims: ['รักษาสายตาสั้น'],
    },
    { name: 'กระบอกน้ำเก็บอุณหภูมิ 500 ml', priceAmount: '349', currency: 'THB' },
    { name: 'Canvas tote bag', priceAmount: '259', currency: 'THB' },
  ];
  let first;
  for (const p of products) {
    const created = await api(token, 'POST', `/workspaces/${ws.id}/products`, p);
    first ??= created;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  await page.goto(`${WEB}/`);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await shot('web-overview.png');

  await page.goto(`${WEB}/w/${ws.id}/products`);
  await page.getByText(products[0].name).first().waitFor();
  await shot('web-products.png');

  await page.goto(`${WEB}/w/${ws.id}/products/${first.id}`);
  await page.getByText(products[0].name).first().waitFor();
  await shot('web-product-detail.png');

  // Upload through the real UI, then show the library.
  await page.goto(`${WEB}/w/${ws.id}/assets`);
  await page.locator('input[type="file"]').first().waitFor({ state: 'attached' });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: 'โคมไฟ-หน้าตรง.png', mimeType: 'image/png', buffer: await photo(30, 90, 160) },
      { name: 'โคมไฟ-ใช้งานจริง.png', mimeType: 'image/png', buffer: await photo(160, 90, 40) },
    ]);
  await page.getByText('โคมไฟ-หน้าตรง.png').first().waitFor();
  await page.waitForTimeout(2500);
  await shot('web-asset-library.png');

  // A campaign made by the real worker (mock text provider), its draft, four video prompts and
  // an attached picture, so the draft page shows the whole result.
  const templates = await api(token, 'GET', `/workspaces/${ws.id}/templates`);
  const template = templates.items[0];
  const campaign = await api(token, 'POST', `/workspaces/${ws.id}/campaigns`, {
    productId: first.id,
    templateId: template.id,
    templateVersion: template.version,
    name: 'โคมไฟ · คลิปสั้น',
    language: 'th',
    platform: 'tiktok',
    durationSeconds: 30,
    variants: 1,
  });
  await waitForJob(
    token,
    ws.id,
    (await startJob(token, ws.id, 'generate-brief', { campaignId: campaign.id })).id,
  );
  const drafts = await api(token, 'GET', `/workspaces/${ws.id}/drafts?campaignId=${campaign.id}`);
  const draft = drafts.items[0];
  await waitForJob(
    token,
    ws.id,
    (
      await startJob(token, ws.id, 'generate-video-prompts', {
        draftId: draft.id,
        draftVersion: draft.version,
      })
    ).id,
  );
  await page.goto(`${WEB}/w/${ws.id}/campaigns/${campaign.id}`);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await page.getByText('Variant 1').first().waitFor();
  await page.screenshot({ path: path.join(OUT, 'web-campaign-page.png'), fullPage: true });
  await page.goto(`${WEB}/w/${ws.id}/drafts/${draft.id}`);
  await page.getByRole('heading', { name: 'Video prompts' }).waitFor();
  await page
    .getByText(/Voiceover:/)
    .first()
    .waitFor();
  await page.screenshot({ path: path.join(OUT, 'web-draft-results.png'), fullPage: true });
  await page.goto(`${WEB}/w/${ws.id}/settings`);
  await page.getByLabel('Model').waitFor();
  await page.getByText('Loading usage').waitFor({ state: 'detached' });
  await shot('web-settings.png');

  await page.goto(`${WEB}/workspaces/new`);
  await page.getByLabel('Name', { exact: true }).fill('ร้านสมชาย');
  await shot('web-new-workspace.png');

  await browser.close();

  // The extension side panel, loaded as a tab (Playwright cannot open the real side panel).
  const profile = await mkdtemp(path.join(os.tmpdir(), 'creatorops-shots-profile-'));
  const dist = path.join(root, 'apps/extension/dist-e2e');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 400, height: 760 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('region', { name: 'Products' }).getByText(products[0].name).waitFor();
  await panel.screenshot({ path: path.join(OUT, 'extension-side-panel.png') });

  // The Create tab (A1): choose a product, then press the button (a worker runs here, so the job
  // may already be running when the picture is taken).
  const create = panel.getByRole('region', { name: 'Create content' });
  await create.getByRole('combobox', { name: 'Product' }).selectOption({ label: products[0].name });
  await panel.screenshot({ path: path.join(OUT, 'extension-create.png'), fullPage: true });
  await create.getByRole('button', { name: 'Create content' }).click();
  await panel.getByText(/Started\. Follow it under Campaigns below/).waitFor();
  await panel.screenshot({ path: path.join(OUT, 'extension-create-started.png'), fullPage: true });

  // The Shopee Affiliate section against a fake page (no network, no real site), with the
  // "Load more" tick, as in the extension e2e.
  const offer = (id, name, price, commission, sold) =>
    `<div class="offer"><a href="https://shopee.co.th/${id}-i.7.${id}"><img alt="${name}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a><div><span>${name}</span></div><div><span>฿${price}</span></div><div><span>ค่าคอมมิชชั่น</span><span>${commission}%</span></div><div><span>ขายแล้ว ${sold}</span></div></div>`;
  await context.route('https://affiliate.shopee.co.th/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta charset="utf-8"><title>Shopee Affiliate</title></head><body><main>${offer(1, 'พัดลมพกพา', '199', '6', '10k')}${offer(2, 'เครื่องชงกาแฟพกพา', '1,290', '12.5', '1.2พัน')}${offer(3, 'แก้วเก็บความเย็น', '350', '9', '87')}</main></body></html>`,
    }),
  );
  const shopee = await context.newPage();
  await shopee.goto('https://affiliate.shopee.co.th/offer/product_offer');
  await panel.bringToFront();
  const shopeeRegion = panel.getByRole('region', { name: 'Shopee Affiliate' });
  await shopeeRegion.getByRole('checkbox', { name: /Load more of the list/ }).check();
  await shopeeRegion.getByRole('button', { name: 'Import from Shopee affiliate page' }).click();
  await shopeeRegion.getByRole('list', { name: 'Shopee offers' }).waitFor();
  await shopeeRegion.screenshot({ path: path.join(OUT, 'extension-shopee.png') });
  await context.close();

  console.log(`Screenshots written to ${OUT}`);
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  for (const child of children) child.kill();
}
process.exit(exitCode);
