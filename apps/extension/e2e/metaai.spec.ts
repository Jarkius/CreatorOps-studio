import { createRequire } from 'node:module';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';

const API_URL = 'http://localhost:3000';
const here = path.dirname(fileURLToPath(import.meta.url));
// `pg` belongs to the API package; the suite uses it only to put a finished draft in place,
// because this suite runs no worker.
const { Client } = createRequire(path.resolve(here, '..', '..', 'api', 'package.json'))('pg') as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  };
};

/** A real 300x300 PNG with correct checksums (a hand-made one with a bad CRC is rejected). */
function pngBytes(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_v, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const size = 300;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x7f)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FAKE_PAGE = `<!doctype html><html><head><title>Meta AI</title></head><body><main>
<textarea placeholder="Ask Meta AI anything"></textarea><button aria-label="Send">Send</button>
<div id="out"></div></main>
<script>
document.querySelector('button').addEventListener('click', function () {
  if (!document.querySelector('textarea').value) return;
  setTimeout(function () {
    var img = document.createElement('img');
    img.alt = 'generated image'; img.width = 300; img.src = 'https://www.meta.ai/generated/one.png';
    document.getElementById('out').appendChild(img);
  }, 600);
});
</script></body></html>`;

const LOGIN_PAGE = `<!doctype html><html><head><title>Meta AI</title></head><body><p>Log in to continue</p></body></html>`;

/** Serves a fake meta.ai: no network, no real site. */
async function fakeMetaAi(context: BrowserContext, html: string): Promise<void> {
  await context.route('https://www.meta.ai/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.png')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: pngBytes() });
    } else {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
  });
}

async function api<T>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST',
  route: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${API_URL}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** A campaign whose generate job succeeded and whose draft holds four storyboard lines. */
async function finishedCampaign(
  request: APIRequestContext,
  name: string,
): Promise<{ token: string; workspaceId: string; draftId: string }> {
  const { token } = (await (await request.post(`${API_URL}/api/v1/auth/mock-token`)).json()) as {
    token: string;
  };
  const me = await api<{ user: { id: string }; workspaces: { id: string }[] }>(
    request,
    token,
    'GET',
    '/api/v1/me',
  );
  const workspaceId = me.workspaces[0]?.id as string;
  const ws = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`;
  const product = await api<{ id: string }>(request, token, 'POST', `${ws}/products`, {
    name: `สินค้า ${name}`,
  });
  const templates = await api<{ items: { id: string; version: number }[] }>(
    request,
    token,
    'GET',
    `${ws}/templates`,
  );
  const template = templates.items[0] as { id: string; version: number };
  const campaign = await api<{ id: string }>(request, token, 'POST', `${ws}/campaigns`, {
    productId: product.id,
    templateId: template.id,
    templateVersion: template.version,
    name,
    language: 'th',
    platform: 'tiktok',
    variants: 1,
  });

  const sections = {
    title: 'Title',
    hook: 'Hook',
    script: 'Script',
    storyboard: ['hero prompt', 'detail prompt', 'usage prompt', 'final prompt'],
    caption: 'Caption',
    hashtags: [],
    callToAction: 'Call to action',
  };
  const sectionState = Object.fromEntries(
    Object.keys(sections).map((key) => [key, { rev: 1, origin: 'generated', jobId: null }]),
  );
  const db = new Client({ connectionString: process.env.DATABASE_URL as string });
  await db.connect();
  try {
    const draft = await db.query(
      `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state)
       values ($1, $2, $3, $4, $5) returning id`,
      [workspaceId, campaign.id, product.id, sections, sectionState],
    );
    await db.query(
      `insert into jobs (workspace_id, type, status, input, created_by, idempotency_key, request_hash,
                         campaign_id, attempts, started_at, finished_at, output)
       values ($1, 'generate_brief', 'succeeded', '{}', $2, $3, repeat('a', 64), $4, 1, now(), now(), $5)`,
      [
        workspaceId,
        me.user.id,
        `seed-${campaign.id}`,
        campaign.id,
        { draftIds: [draft.rows[0]?.id] },
      ],
    );
    return { token, workspaceId, draftId: draft.rows[0]?.id as string };
  } finally {
    await db.end();
  }
}

async function openScenes(page: Page, extensionId: string, name: string) {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const region = page.getByRole('region', { name: 'Campaigns' });
  const row = region.getByRole('listitem').filter({ hasText: name });
  await row.getByRole('button', { name: `Show scenes for ${name}` }).click();
  await expect(page.getByLabel('1. Product Hero')).toHaveValue('hero prompt');
  return row;
}

test('Generate in Meta AI types the prompt into the owner tab and saves the image to the scene', async ({
  context,
  extensionId,
  request,
}) => {
  const name = `E2E Meta AI ${Date.now()}`;
  const seeded = await finishedCampaign(request, name);
  await fakeMetaAi(context, FAKE_PAGE);

  const panel = await context.newPage();
  await openScenes(panel, extensionId, name);
  await panel.getByLabel('2. Detail').fill('my own detail prompt');
  await panel.getByRole('button', { name: 'Generate Detail in Meta AI' }).click();

  await expect(
    panel.getByRole('status').filter({ hasText: 'Saved the image to Detail.' }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/File: meta-ai-detail-\d{8}T\d{6}\.png/)).toBeVisible();

  // The helper typed the edited prompt into the fake site's own tab.
  const site = context.pages().find((page) => page.url().startsWith('https://www.meta.ai/'));
  expect(site).toBeDefined();
  await expect(site?.locator('textarea')).toHaveValue('my own detail prompt');

  // The file is on the server, attached to the scene and labelled as AI-generated by Meta AI.
  const attached = await api<{
    items: {
      scene: string;
      aiGenerated: boolean;
      generator: string;
      asset: { mimeType: string };
    }[];
  }>(
    request,
    seeded.token,
    'GET',
    `/api/v1/workspaces/${encodeURIComponent(seeded.workspaceId)}/drafts/${seeded.draftId}/assets`,
  );
  expect(attached.items).toHaveLength(1);
  expect(attached.items[0]).toMatchObject({
    scene: 'detail',
    aiGenerated: true,
    generator: 'Meta AI',
    asset: { mimeType: 'image/png' },
  });
});

test('Generate in Meta AI stops on a sign-in page and offers diagnostics', async ({
  context,
  extensionId,
  request,
}) => {
  const name = `E2E Meta AI login ${Date.now()}`;
  await finishedCampaign(request, name);
  await fakeMetaAi(context, LOGIN_PAGE);

  const panel = await context.newPage();
  await openScenes(panel, extensionId, name);
  await panel.getByRole('button', { name: 'Generate Usage in Meta AI' }).click();
  await expect(panel.getByRole('alert')).toContainText('asking you to sign in', {
    timeout: 30_000,
  });
  await expect(panel.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible();
  await expect(panel.getByText(/File: /)).toHaveCount(0);
});
