import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';
import { api, finishedCampaign } from './seed.js';

/** The first bytes of an MP4 the server accepts (a `ftyp` box with the `isom` brand). */
const MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
]);

const FAKE_FLOW = `<!doctype html><html><head><title>Flow</title></head><body><main>
<textarea placeholder="What do you want to create?"></textarea><button aria-label="Generate">Generate</button>
<div id="out"></div></main>
<script>
window.__n = 0;
document.querySelector('button').addEventListener('click', function () {
  if (!document.querySelector('textarea').value) return;
  setTimeout(function () {
    var video = document.createElement('video');
    video.src = 'https://labs.google/fx/tools/flow/generated/' + (++window.__n) + '.mp4';
    document.getElementById('out').appendChild(video);
  }, 600);
});
</script></body></html>`;

const FLOW_LIMIT = `<!doctype html><html><head><title>Flow</title></head><body>
<textarea placeholder="What do you want to create?"></textarea><p>You are out of credits for today</p></body></html>`;

/** Serves a fake Google Flow: no network, no real site. */
async function fakeFlow(context: BrowserContext, html: string) {
  await context.route(/^https:\/\/labs\.google\/fx\/tools\/flow/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.mp4')) {
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: MP4_BYTES });
    } else {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
  });
}

async function openScenes(page: Page, extensionId: string, name: string) {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const region = page.getByRole('region', { name: 'Campaigns' });
  const row = region.getByRole('listitem').filter({ hasText: name });
  await row.getByRole('button', { name: `Show scenes for ${name}` }).click();
  await expect(page.getByLabel('1. Product Hero')).toHaveValue('hero prompt');
}

type Attached = {
  items: {
    scene: string;
    aiGenerated: boolean;
    generator: string;
    asset: { mimeType: string; type: string };
  }[];
};

test('Make video in Flow types the prompt into the owner tab and saves the clip to the scene', async ({
  context,
  extensionId,
  request,
}) => {
  const name = `E2E Flow ${Date.now()}`;
  const seeded = await finishedCampaign(request, name);
  await fakeFlow(context, FAKE_FLOW);

  const panel = await context.newPage();
  await openScenes(panel, extensionId, name);
  await panel.getByLabel('3. Usage').fill('my own usage prompt');
  await panel.getByRole('button', { name: 'Make video for Usage in Flow' }).click();

  await expect(
    panel.getByRole('status').filter({ hasText: 'Saved the video to Usage.' }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/Video: flow-usage-\d{8}T\d{6}\.mp4/)).toBeVisible();

  const site = context.pages().find((page) => page.url().startsWith('https://labs.google/'));
  expect(site).toBeDefined();
  await expect(site?.locator('textarea')).toHaveValue('my own usage prompt');

  const attached = await api<Attached>(
    request,
    seeded.token,
    'GET',
    `/api/v1/workspaces/${encodeURIComponent(seeded.workspaceId)}/drafts/${seeded.draftId}/assets`,
  );
  expect(attached.items).toHaveLength(1);
  expect(attached.items[0]).toMatchObject({
    scene: 'usage',
    aiGenerated: true,
    generator: 'Google Flow',
    asset: { mimeType: 'video/mp4', type: 'video' },
  });
});

test('Flow stops with a plain message when it is out of credits, and types nothing', async ({
  context,
  extensionId,
  request,
}) => {
  const name = `E2E Flow limit ${Date.now()}`;
  await finishedCampaign(request, name);
  await fakeFlow(context, FLOW_LIMIT);

  const panel = await context.newPage();
  await openScenes(panel, extensionId, name);
  await panel.getByRole('button', { name: 'Make video for Detail in Flow' }).click();

  await expect(
    panel.getByRole('alert').filter({ hasText: /Google Flow says you have hit a limit/ }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible();
  const site = context.pages().find((page) => page.url().startsWith('https://labs.google/'));
  await expect(site?.locator('textarea')).toHaveValue('');
});
