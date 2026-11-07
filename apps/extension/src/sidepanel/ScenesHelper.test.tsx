import type { ApiClient, CampaignListItem, Draft, DraftAsset, Job } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CampaignsPanel } from './CampaignsPanel.js';
import type { PageProbe } from './metaai/page.js';
import type { MetaAiBrowser, PageFunctions } from './metaai/runner.js';
import type { HelperDeps } from './metaai/useMetaAi.js';

const NOW = '2026-01-01T00:00:00.000Z';
const JOB = { id: 'j1', status: 'succeeded', campaignId: 'c1', type: 'generate_brief' } as Job;
const CAMPAIGN = {
  id: 'c1',
  name: 'Hero launch',
  platform: 'tiktok',
  status: 'draft',
  latestGenerateJob: JOB,
  createdAt: NOW,
} as unknown as CampaignListItem;
const DRAFT = {
  id: 'd1',
  productId: 'p1',
  sections: {
    hook: 'HOOK',
    callToAction: 'CTA',
    storyboard: ['hero text', 'detail text', 'usage text', 'final text'],
  },
  version: 1,
} as unknown as Draft;

const READY: PageProbe = {
  title: 'Meta AI',
  path: '/',
  state: 'ready',
  promptBoxIndex: 0,
  sendButtonIndex: 0,
  mediaCount: 0,
};

function fakeHelper(options: {
  permission?: boolean;
  grant?: boolean;
  probe?: PageProbe | 'hang';
  hangSleep?: boolean;
}) {
  let mediaCalls = 0;
  const calls = { request: 0, submit: 0, probe: 0 };
  const page: PageFunctions = {
    probePage: () => {
      calls.probe += 1;
      if (options.probe === 'hang') return new Promise(() => undefined) as never;
      return options.probe ?? READY;
    },
    submitPrompt: () => {
      calls.submit += 1;
      return { ok: true, how: 'button' };
    },
    listMedia: () => (mediaCalls++ === 0 ? [] : ['https://cdn.test/a.png']),
    stashMedia: () => Promise.resolve({ size: 3, type: 'image/png' }),
    readStash: () => Promise.resolve(btoa('abc')),
    clearStash: () => true,
  };
  const browser: MetaAiBrowser = {
    hasPermission: () => Promise.resolve(options.permission ?? true),
    requestPermission: () => {
      calls.request += 1;
      return Promise.resolve(options.grant ?? false);
    },
    findTab: () => Promise.resolve(4),
    openTab: () => Promise.resolve(4),
    run: (_tab, func, args) =>
      Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never,
  };
  const deps: HelperDeps = {
    browser,
    page,
    sleep: () => (options.hangSleep ? new Promise(() => undefined) : Promise.resolve()),
    fetchImpl: (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch,
  };
  return { deps, calls };
}

function setup(deps: HelperDeps, canStart = true) {
  const listAssets = vi.fn(() => Promise.resolve({ items: [] as DraftAsset[] }));
  const setAssets = vi.fn(() => Promise.resolve({ items: [] }));
  const api = {
    campaigns: { list: () => Promise.resolve({ items: [CAMPAIGN], nextCursor: null }) },
    jobs: {},
    drafts: {
      list: () => Promise.resolve({ items: [DRAFT], nextCursor: null }),
      listAssets,
      setAssets,
    },
    assets: {
      createUploadIntent: () =>
        Promise.resolve({
          intentId: 'i1',
          uploadUrl: '/u',
          method: 'PUT',
          contentType: 'image/png',
        }),
      completeUpload: () => Promise.resolve({ id: 'asset-1' }),
    },
    resolveUrl: (path: string) => `http://api.test${path}`,
  } as unknown as ApiClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CampaignsPanel
        api={api}
        workspaceId="w1"
        dashboardUrl="http://dash.test"
        canStart={canStart}
        helper={deps}
      />
    </QueryClientProvider>,
  );
  return { listAssets, setAssets };
}

async function openScenes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
  await screen.findByLabelText('3. Usage');
}

function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

describe('Meta AI helper in the scene list (A3)', () => {
  it('shows Generate in Meta AI only to people who can start work', async () => {
    const user = userEvent.setup();
    setup(fakeHelper({}).deps, false);
    await openScenes(user);
    expect(screen.queryByRole('button', { name: /in Meta AI/ })).not.toBeInTheDocument();
  });

  it('asks Chrome for permission when it is missing, and stops with a clear message when refused', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({ permission: false, grant: false });
    setup(t.deps);
    await openScenes(user);
    await user.click(screen.getByRole('button', { name: 'Generate Usage in Meta AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Meta AI was not allowed');
    expect(t.calls.request).toBe(1);
    expect(t.calls.probe).toBe(0);
    expect(t.calls.submit).toBe(0);
  });

  it('runs the helper with the edited prompt, saves the file to the scene, and says so', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({});
    const submit = vi.spyOn(t.deps.page, 'submitPrompt');
    const api = setup(t.deps);
    await openScenes(user);
    const box = screen.getByLabelText('3. Usage');
    await user.clear(box);
    await user.type(box, 'my usage prompt');
    await user.click(screen.getByRole('button', { name: 'Generate Usage in Meta AI' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved the image to Usage.');
    expect(submit).toHaveBeenCalledWith(expect.anything(), 'Imagine my usage prompt');
    expect(api.setAssets).toHaveBeenCalledWith('w1', 'd1', {
      assets: [
        {
          assetId: 'asset-1',
          role: 'media',
          scene: 'usage',
          aiGenerated: true,
          generator: 'Meta AI',
        },
      ],
    });
    // The file status is read again after the run.
    await waitFor(() => expect(api.listAssets.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('Generate all makes the scenes without a file, with the prompts as the owner edited them', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({});
    const prompts: string[] = [];
    let n = 0;
    t.deps.page.submitPrompt = (_sel, prompt) => {
      prompts.push(prompt);
      return { ok: true, how: 'button' };
    };
    // Every scene gets a new image address after it was sent, as the real chat does.
    t.deps.page.listMedia = () =>
      Array.from({ length: prompts.length }, (_v, i) => `https://cdn.test/${i}.png`);
    t.deps.page.clearStash = () => ((n += 1), true);
    setup(t.deps);
    await openScenes(user);
    const box = screen.getByLabelText('2. Detail');
    await user.clear(box);
    await user.type(box, 'my detail');
    await user.click(screen.getByRole('button', { name: 'Generate all scenes in Meta AI' }));
    expect(await screen.findByText('Saved 4 scene images.')).toBeInTheDocument();
    expect(prompts).toEqual([
      'Imagine hero text',
      'Imagine my detail',
      'Imagine usage text',
      'Imagine final text',
    ]);
    expect(n).toBe(4);
  });

  it('leaves out a scene whose prompt the owner emptied', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({});
    const prompts: string[] = [];
    t.deps.page.submitPrompt = (_sel, prompt) => {
      prompts.push(prompt);
      return { ok: true, how: 'button' };
    };
    t.deps.page.listMedia = () =>
      Array.from({ length: prompts.length }, (_v, i) => `https://cdn.test/${i}.png`);
    setup(t.deps);
    await openScenes(user);
    await user.clear(screen.getByLabelText('3. Usage'));
    await user.click(
      screen.getByRole('button', { name: 'Generate the 3 missing scenes in Meta AI' }),
    );
    expect(await screen.findByText('Saved 3 scene images.')).toBeInTheDocument();
    expect(prompts).toEqual(['Imagine hero text', 'Imagine detail text', 'Imagine final text']);
  });

  it('hides Generate all from people who cannot start work', async () => {
    const user = userEvent.setup();
    setup(fakeHelper({}).deps, false);
    await openScenes(user);
    expect(
      screen.queryByRole('button', { name: /Generate all|missing scene/ }),
    ).not.toBeInTheDocument();
  });

  it('tells the owner it is waiting for sign-in, and can be cancelled meanwhile', async () => {
    const user = userEvent.setup();
    setup(
      fakeHelper({
        probe: { ...READY, state: 'login', promptBoxIndex: -1 },
        hangSleep: true,
      }).deps,
    );
    await openScenes(user);
    await user.click(screen.getByRole('button', { name: 'Generate Usage in Meta AI' }));
    expect(await screen.findByText(/Waiting for you to sign in in the Meta AI tab/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancelled.');
  });

  it('stops when nobody signs in in time, with a plain message and a Copy diagnostics button', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    setup(fakeHelper({ probe: { ...READY, state: 'login', promptBoxIndex: -1 } }).deps);
    await openScenes(user);
    await user.click(screen.getByRole('button', { name: 'Generate Detail in Meta AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not signed in within 5 minutes');
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text).toContain('result: LOGIN_REQUIRED');
    expect(text).toContain('scene: detail');
    expect(text).not.toContain('detail text');
  });

  it('can be cancelled while it works, and lets the owner start again after closing', async () => {
    const user = userEvent.setup();
    setup(fakeHelper({ probe: 'hang' }).deps);
    await openScenes(user);
    await user.click(screen.getByRole('button', { name: 'Generate Usage in Meta AI' }));
    const helper = await screen.findByRole('region', { name: 'Meta AI helper' });
    expect(within(helper).getByText('Checking the page')).toBeInTheDocument();
    // One run at a time: every Generate button is off while it works.
    expect(screen.getByRole('button', { name: 'Generate Detail in Meta AI' })).toBeDisabled();
    await user.click(within(helper).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancelled.');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Meta AI helper' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Detail in Meta AI' })).toBeEnabled();
  });
});
