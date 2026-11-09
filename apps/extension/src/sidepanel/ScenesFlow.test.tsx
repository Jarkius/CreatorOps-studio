import type { ApiClient, CampaignListItem, Draft, DraftAsset, Job } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CampaignsPanel } from './CampaignsPanel.js';
import type { PageProbe } from './metaai/page.js';
import type { MetaAiBrowser, PageFunctions } from './metaai/runner.js';
import type { HelperDeps } from './metaai/useMetaAi.js';

const JOB = { id: 'j1', status: 'succeeded', campaignId: 'c1', type: 'generate_brief' } as Job;
const CAMPAIGN = {
  id: 'c1',
  name: 'Hero launch',
  platform: 'tiktok',
  status: 'draft',
  latestGenerateJob: JOB,
  createdAt: '2026-01-01T00:00:00.000Z',
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
  title: 'Flow',
  path: '/fx/tools/flow',
  state: 'ready',
  promptBoxIndex: 0,
  sendButtonIndex: 0,
  mediaCount: 0,
};

/** A fake Flow tab that answers with one small video. */
function fakeFlow(options: { permission?: boolean; grant?: boolean } = {}) {
  let mediaCalls = 0;
  const prompts: string[] = [];
  const requested: string[] = [];
  const page: PageFunctions = {
    probePage: () => READY,
    submitPrompt: (_sel, prompt) => {
      prompts.push(prompt);
      return { ok: true, how: 'button' };
    },
    listMedia: () => (mediaCalls++ % 3 === 0 ? [] : ['https://cdn.test/clip.mp4']),
    stashMedia: () => Promise.resolve({ size: 3, type: 'video/mp4' }),
    readStash: () => Promise.resolve(btoa('abc')),
    clearStash: () => true,
  };
  const browser: MetaAiBrowser = {
    hasPermission: () => Promise.resolve(options.permission ?? true),
    requestPermission: () => {
      requested.push('flow');
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
    sleep: () => Promise.resolve(),
    fetchImpl: (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch,
  };
  return { deps, prompts, requested };
}

const asset = (id: string, scene: string, type: 'image' | 'video', name: string) =>
  ({
    assetId: id,
    scene,
    role: 'media',
    aiGenerated: true,
    generator: type === 'video' ? 'Google Flow' : 'Meta AI',
    asset: { type, originalFilename: name },
  }) as unknown as DraftAsset;

function setup(deps: HelperDeps, items: DraftAsset[] = [], canStart = true) {
  const setAssets = vi.fn(() => Promise.resolve({ items: [] }));
  const createUploadIntent = vi.fn(() =>
    Promise.resolve({ intentId: 'i1', uploadUrl: '/u', method: 'PUT', contentType: 'video/mp4' }),
  );
  const api = {
    campaigns: { list: () => Promise.resolve({ items: [CAMPAIGN], nextCursor: null }) },
    jobs: {},
    drafts: {
      list: () => Promise.resolve({ items: [DRAFT], nextCursor: null }),
      listAssets: () => Promise.resolve({ items }),
      setAssets,
    },
    assets: { createUploadIntent, completeUpload: () => Promise.resolve({ id: 'clip-1' }) },
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
  return { setAssets, createUploadIntent };
}

async function openScenes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
  await screen.findByLabelText('3. Usage');
}

describe('Google Flow helper in the scene list (D-080)', () => {
  it('shows the Flow buttons only to people who can start work', async () => {
    const user = userEvent.setup();
    setup(fakeFlow().deps, [], false);
    await openScenes(user);
    expect(screen.queryByRole('button', { name: /in Flow/ })).not.toBeInTheDocument();
  });

  it('makes a video for one scene, saves it with the Flow label and keeps the scene image', async () => {
    const user = userEvent.setup();
    const flow = fakeFlow();
    const { setAssets, createUploadIntent } = setup(flow.deps, [
      asset('img-usage', 'usage', 'image', 'usage.png'),
    ]);
    await openScenes(user);
    await user.click(screen.getByRole('button', { name: 'Make video for Usage in Flow' }));
    const panel = await screen.findByRole('region', { name: 'Google Flow helper' });
    expect(await within(panel).findByText('Saved the video to Usage.')).toBeInTheDocument();
    expect(flow.prompts).toEqual(['usage text']);
    expect(createUploadIntent).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        mimeType: 'video/mp4',
        filename: expect.stringMatching(/^flow-usage-/),
      }),
    );
    const sent = setAssets.mock.calls[0] as unknown as [string, string, { assets: unknown[] }];
    expect(sent[2].assets).toEqual([
      {
        assetId: 'img-usage',
        role: 'media',
        scene: 'usage',
        aiGenerated: true,
        generator: 'Meta AI',
      },
      {
        assetId: 'clip-1',
        role: 'media',
        scene: 'usage',
        aiGenerated: true,
        generator: 'Google Flow',
      },
    ]);
  });

  it('says which scenes already have a video and offers only the missing ones', async () => {
    const user = userEvent.setup();
    setup(fakeFlow().deps, [asset('v1', 'detail', 'video', 'flow-detail.mp4')]);
    await openScenes(user);
    const detail = (await screen.findByLabelText('2. Detail')).closest('li') as HTMLElement;
    expect(await within(detail).findByText('Video: flow-detail.mp4')).toBeInTheDocument();
    // The video is not counted as the scene image: the image row still says no file.
    expect(within(detail).getByText('No file yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make the 3 missing videos in Flow' })).toBeEnabled();
  });

  it('makes all missing videos in order, one at a time', async () => {
    const user = userEvent.setup();
    const flow = fakeFlow();
    setup(flow.deps);
    await openScenes(user);
    await user.click(await screen.findByRole('button', { name: 'Make all videos in Flow' }));
    const panel = await screen.findByRole('region', { name: 'Google Flow helper' });
    expect(await within(panel).findByText('Saved 4 scene videos.')).toBeInTheDocument();
    expect(flow.prompts).toEqual(['hero text', 'detail text', 'usage text', 'final text']);
  });

  it('asks Chrome to allow Flow, and stops with a plain message when it is refused', async () => {
    const user = userEvent.setup();
    const flow = fakeFlow({ permission: false, grant: false });
    setup(flow.deps);
    await openScenes(user);
    await user.click(screen.getByRole('button', { name: 'Make video for Usage in Flow' }));
    expect(await screen.findByText(/Google Flow was not allowed/)).toBeInTheDocument();
    expect(flow.requested).toEqual(['flow']);
    expect(flow.prompts).toEqual([]);
    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeInTheDocument();
  });

  it('disables the Meta AI buttons while a Flow run is in progress', async () => {
    const user = userEvent.setup();
    const flow = fakeFlow();
    // A page that never answers keeps the run going.
    flow.deps.page.probePage = () => new Promise(() => undefined) as never;
    setup(flow.deps);
    await openScenes(user);
    await user.click(screen.getByRole('button', { name: 'Make video for Usage in Flow' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate Usage in Meta AI' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Make video for Detail in Flow' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });
});
