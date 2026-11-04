// Captures real screenshots of the running dashboard and the extension side panel into
// docs/screenshots. It uses its own throw-away database (creatorops_e2e) and a temp media folder.
//
// Usage (after `pnpm build` and `pnpm --filter @creatorops/extension build`):
//   export DATABASE_URL="$(bash scripts/pg-local.sh url)"
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
  PORT: '3000',
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

  await page.goto(`${WEB}/workspaces/new`);
  await page.getByLabel('Name', { exact: true }).fill('ร้านสมชาย');
  await shot('web-new-workspace.png');

  await browser.close();

  // The extension side panel, loaded as a tab (Playwright cannot open the real side panel).
  const profile = await mkdtemp(path.join(os.tmpdir(), 'creatorops-shots-profile-'));
  const dist = path.join(root, 'apps/extension/dist');
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

  // The Create tab (A1): choose a product, then press the button (no worker runs here, so the
  // job stays queued and the campaign row shows it).
  const create = panel.getByRole('region', { name: 'Create content' });
  await create.getByRole('combobox', { name: 'Product' }).selectOption({ label: products[0].name });
  await panel.screenshot({ path: path.join(OUT, 'extension-create.png'), fullPage: true });
  await create.getByRole('button', { name: 'Create content' }).click();
  await panel.getByText(/Started\. Follow it under Campaigns below/).waitFor();
  await panel.getByText('Waiting to start').first().waitFor();
  await panel.screenshot({ path: path.join(OUT, 'extension-create-started.png'), fullPage: true });
  await context.close();

  console.log(`Screenshots written to ${OUT}`);
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  for (const child of children) child.kill();
}
process.exit(exitCode);
