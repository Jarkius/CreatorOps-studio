import {
  ApiError,
  type ApiClient,
  type CampaignListItem,
  type Draft,
  type Job,
} from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CampaignsPanel } from './CampaignsPanel.js';
import type { PageProbe } from './metaai/page.js';
import type { MetaAiBrowser, PageFunctions } from './metaai/runner.js';
import type { HelperDeps } from './metaai/useMetaAi.js';

const GEN_JOB = { id: 'j1', status: 'succeeded', campaignId: 'c1', type: 'generate_brief' } as Job;
const CAMPAIGN = {
  id: 'c1',
  name: 'Hero launch',
  platform: 'tiktok',
  status: 'draft',
  latestGenerateJob: GEN_JOB,
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as CampaignListItem;
const DRAFT = {
  id: 'd1',
  productId: 'p1',
  version: 3,
  sections: {
    hook: 'HOOK',
    callToAction: 'CTA',
    storyboard: ['hero text', 'detail text', 'usage text', 'final text'],
  },
} as unknown as Draft;

const SCENES = ['product_hero', 'detail', 'usage', 'final_shot'] as const;
const outputOf = (tag: string, version = 3) => ({
  draftId: 'd1',
  draftVersion: version,
  model: 'qwen-test',
  scenes: SCENES.map((scene) => ({
    scene,
    prompt: `Vertical 9:16 video. ${tag} ${scene} shot of the product on a desk. No on-screen text, no logos, no watermarks.`,
    voiceover: `พากย์ ${tag} ${scene}`,
  })),
});
const videoJob = (id: string, output: unknown, status: Job['status'] = 'succeeded') =>
  ({
    id,
    status,
    type: 'generate_video_prompts',
    draftId: 'd1',
    output,
    errorMessage: null,
  }) as unknown as Job;

const READY: PageProbe = {
  title: 'Flow',
  path: '/',
  state: 'ready',
  promptBoxIndex: 0,
  sendButtonIndex: 0,
  mediaCount: 0,
};

function fakeFlow() {
  const prompts: string[] = [];
  let calls = 0;
  const page: PageFunctions = {
    probePage: () => READY,
    submitPrompt: (_sel, prompt) => {
      prompts.push(prompt);
      return { ok: true, how: 'button' };
    },
    listMedia: () => (calls++ % 3 === 0 ? [] : ['https://cdn.test/clip.mp4']),
    stashMedia: () => Promise.resolve({ size: 3, type: 'video/mp4' }),
    readStash: () => Promise.resolve(btoa('abc')),
    clearStash: () => true,
  };
  const browser: MetaAiBrowser = {
    hasPermission: () => Promise.resolve(true),
    requestPermission: () => Promise.resolve(true),
    findTab: () => Promise.resolve(4),
    openTab: () => Promise.resolve(4),
    run: (_t, func, args) =>
      Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never,
  };
  const deps: HelperDeps = {
    browser,
    page,
    sleep: () => Promise.resolve(),
    fetchImpl: (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch,
  };
  return { deps, prompts };
}

interface Setup {
  saved?: Job[];
  /** What the list returns on later calls (after a new job finished). */
  savedAfter?: Job[];
  start?: (workspaceId: string, body: unknown, key: string) => Promise<Job>;
  get?: (id: string) => Promise<Job>;
  canStart?: boolean;
}

function setup(options: Setup = {}) {
  let listCalls = 0;
  const list = vi.fn(() => {
    listCalls += 1;
    const items =
      listCalls === 1 ? (options.saved ?? []) : (options.savedAfter ?? options.saved ?? []);
    return Promise.resolve({ items, nextCursor: null });
  });
  const generateVideoPrompts = vi.fn(
    options.start ?? (() => Promise.resolve(videoJob('vj-new', null, 'queued'))),
  );
  const get = vi.fn(
    options.get ?? ((id: string) => Promise.resolve(videoJob(id, outputOf('new')))),
  );
  const cancel = vi.fn((_w: string, id: string) =>
    Promise.resolve(videoJob(id, null, 'cancelled')),
  );
  const flow = fakeFlow();
  const api = {
    campaigns: { list: () => Promise.resolve({ items: [CAMPAIGN], nextCursor: null }) },
    jobs: { list, generateVideoPrompts, get, cancel },
    drafts: {
      list: () => Promise.resolve({ items: [DRAFT], nextCursor: null }),
      listAssets: () => Promise.resolve({ items: [] }),
      setAssets: () => Promise.resolve({ items: [] }),
    },
    assets: {
      createUploadIntent: () =>
        Promise.resolve({
          intentId: 'i1',
          uploadUrl: '/u',
          method: 'PUT',
          contentType: 'video/mp4',
        }),
      completeUpload: () => Promise.resolve({ id: 'clip-1' }),
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
        canStart={options.canStart ?? true}
        helper={flow.deps}
      />
    </QueryClientProvider>,
  );
  return { list, generateVideoPrompts, get, cancel, flow };
}

async function openScenes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
  await screen.findByLabelText('3. Usage');
  return screen.getByRole('region', { name: 'Video prompts' });
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

describe('video prompts in the scene list', () => {
  it('starts empty, then writes the prompts, follows the job and shows four prompts with voiceovers', async () => {
    const user = userEvent.setup();
    const t = setup({ saved: [], savedAfter: [videoJob('vj-new', outputOf('new'))] });
    const section = within(await openScenes(user));
    expect(await section.findByText('No video prompts yet.')).toBeInTheDocument();

    await user.click(section.getByRole('button', { name: 'Write video prompts' }));
    expect(t.generateVideoPrompts).toHaveBeenCalledTimes(1);
    const [workspace, body, key] = t.generateVideoPrompts.mock.calls[0] as unknown as [
      string,
      unknown,
      string,
    ];
    expect(workspace).toBe('w1');
    expect(body).toEqual({ draftId: 'd1', draftVersion: 3 });
    expect(key).toMatch(/^ext-[0-9a-f-]{36}$/);

    expect(await section.findByLabelText('1. Product Hero (video prompt)')).toHaveValue(
      'Vertical 9:16 video. new product_hero shot of the product on a desk. No on-screen text, no logos, no watermarks.',
    );
    expect(section.getByText('พากย์ new final_shot')).toBeInTheDocument();
    expect(section.getByRole('button', { name: 'Write them again' })).toBeEnabled();
    expect(section.getByText(/Written by qwen-test/)).toBeInTheDocument();
  });

  it('shows the prompts saved on the server when the scenes are opened', async () => {
    const user = userEvent.setup();
    setup({ saved: [videoJob('vj-old', outputOf('old'))] });
    const section = within(await openScenes(user));
    expect(await section.findByLabelText('2. Detail (video prompt)')).toHaveValue(
      'Vertical 9:16 video. old detail shot of the product on a desk. No on-screen text, no logos, no watermarks.',
    );
    expect(section.getByRole('button', { name: 'Write them again' })).toBeInTheDocument();
  });

  it('asks the server only for the newest finished video-prompt job of this draft', async () => {
    const user = userEvent.setup();
    const t = setup({ saved: [] });
    await openScenes(user);
    await screen.findByText('No video prompts yet.');
    expect(t.list).toHaveBeenCalledWith('w1', {
      type: 'generate_video_prompts',
      draftId: 'd1',
      status: 'succeeded',
      limit: 1,
    });
  });

  it('ignores a stored result that does not have the expected shape', async () => {
    const user = userEvent.setup();
    setup({ saved: [videoJob('vj-bad', { scenes: [{ scene: 'detail', prompt: 'x' }] })] });
    const section = within(await openScenes(user));
    expect(await section.findByText('No video prompts yet.')).toBeInTheDocument();
  });

  it('shows saved prompts to a read-only member, without any write button', async () => {
    const user = userEvent.setup();
    setup({ saved: [videoJob('vj-old', outputOf('old'))], canStart: false });
    const section = within(await openScenes(user));
    expect(await section.findByLabelText('1. Product Hero (video prompt)')).toBeInTheDocument();
    expect(section.queryByRole('button', { name: /Write/ })).not.toBeInTheDocument();
  });

  it('copies one prompt, one voiceover, and all of them numbered', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    setup({ saved: [videoJob('vj-old', outputOf('old'))] });
    const section = within(await openScenes(user));
    await section.findByLabelText('1. Product Hero (video prompt)');
    await user.click(section.getByRole('button', { name: 'Copy video prompt for Usage' }));
    expect(writeText).toHaveBeenLastCalledWith(
      'Vertical 9:16 video. old usage shot of the product on a desk. No on-screen text, no logos, no watermarks.',
    );
    await user.click(section.getByRole('button', { name: 'Copy voiceover for Detail' }));
    expect(writeText).toHaveBeenLastCalledWith('พากย์ old detail');
    await user.click(section.getByRole('button', { name: 'Copy all video prompts' }));
    const all = writeText.mock.calls.at(-1)?.[0] as string;
    expect(all.startsWith('1. Product Hero\nVertical 9:16 video. old product_hero')).toBe(true);
    expect(all).toContain('\nVoiceover: พากย์ old final_shot');
    expect(all.split('\n\n')).toHaveLength(4);
  });

  it('keeps an edit, resets it, and gives Flow the edited video prompt instead of the scene text', async () => {
    const user = userEvent.setup();
    const t = setup({ saved: [videoJob('vj-old', outputOf('old'))] });
    const section = within(await openScenes(user));
    const box = await section.findByLabelText('3. Usage (video prompt)');
    await user.clear(box);
    await user.type(box, 'My own usage prompt');
    expect(section.getByRole('button', { name: 'Reset video prompt for Usage' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Make video for Usage in Flow' }));
    await screen.findByText('Saved the video to Usage.');
    expect(t.flow.prompts).toEqual(['My own usage prompt']);

    await user.click(section.getByRole('button', { name: 'Reset video prompt for Usage' }));
    expect(box).toHaveValue(
      'Vertical 9:16 video. old usage shot of the product on a desk. No on-screen text, no logos, no watermarks.',
    );
    expect(section.getByRole('button', { name: 'Reset video prompt for Usage' })).toBeDisabled();
  });

  it('gives Flow the written video prompts for the bulk run', async () => {
    const user = userEvent.setup();
    const withPrompts = setup({ saved: [videoJob('vj-old', outputOf('old'))] });
    await openScenes(user);
    await user.click(await screen.findByRole('button', { name: 'Make all videos in Flow' }));
    await screen.findByText('Saved 4 scene videos.');
    expect(withPrompts.flow.prompts).toEqual(
      SCENES.map(
        (scene) =>
          `Vertical 9:16 video. old ${scene} shot of the product on a desk. No on-screen text, no logos, no watermarks.`,
      ),
    );
  });

  it('gives Flow the scene text when no video prompts were written', async () => {
    const user = userEvent.setup();
    const none = setup({ saved: [] });
    await openScenes(user);
    await user.click(await screen.findByRole('button', { name: 'Make all videos in Flow' }));
    await screen.findByText('Saved 4 scene videos.');
    expect(none.flow.prompts).toEqual(['hero text', 'detail text', 'usage text', 'final text']);
  });

  it('replaces edits when a new set is written', async () => {
    const user = userEvent.setup();
    setup({
      saved: [videoJob('vj-old', outputOf('old'))],
      savedAfter: [videoJob('vj-new', outputOf('new'))],
    });
    const section = within(await openScenes(user));
    const box = await section.findByLabelText('1. Product Hero (video prompt)');
    await user.clear(box);
    await user.type(box, 'edited');
    await user.click(section.getByRole('button', { name: 'Write them again' }));
    await waitFor(() =>
      expect(
        (section.getByLabelText('1. Product Hero (video prompt)') as HTMLTextAreaElement).value,
      ).toContain('new product_hero'),
    );
  });

  it('says when the job fails, with the server message, and lets the person try again', async () => {
    const user = userEvent.setup();
    const failed = {
      ...videoJob('vj-f', null, 'failed'),
      errorMessage: 'The text provider did not respond in time.',
    } as unknown as Job;
    setup({ get: () => Promise.resolve(failed) });
    const section = within(await openScenes(user));
    await user.click(await section.findByRole('button', { name: 'Write video prompts' }));
    expect(
      await section.findByText('The text provider did not respond in time.'),
    ).toBeInTheDocument();
    expect(section.getByRole('button', { name: 'Write video prompts' })).toBeEnabled();
  });

  it('shows a refusal from the server, such as a changed draft', async () => {
    const user = userEvent.setup();
    setup({
      start: () =>
        Promise.reject(
          new ApiError({
            code: 'CONFLICT',
            message: 'This draft was changed since you loaded it.',
            status: 409,
          }),
        ),
    });
    const section = within(await openScenes(user));
    await user.click(await section.findByRole('button', { name: 'Write video prompts' }));
    expect(
      await section.findByText('This draft was changed since you loaded it.'),
    ).toBeInTheDocument();
  });

  it('can be cancelled while the job runs', async () => {
    const user = userEvent.setup();
    const t = setup({ get: (id) => Promise.resolve(videoJob(id, null, 'running')) });
    const section = within(await openScenes(user));
    await user.click(await section.findByRole('button', { name: 'Write video prompts' }));
    expect(await section.findByText(/Writing the prompts/)).toBeInTheDocument();
    expect(section.getByRole('button', { name: 'Writing video prompts…' })).toBeDisabled();
    await user.click(await section.findByRole('button', { name: 'Cancel' }));
    expect(t.cancel).toHaveBeenCalledWith('w1', 'vj-new');
  });

  it('reuses the key after a lost answer, and makes a new one after a real answer', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let call = 0;
    setup({
      start: (_workspace, _body, key) => {
        keys.push(key);
        call += 1;
        if (call === 1) {
          return Promise.reject(
            new ApiError({ code: 'NETWORK_ERROR', message: 'No connection.', status: 0 }),
          );
        }
        return Promise.resolve(videoJob(`vj-${call}`, null, 'queued'));
      },
      get: (id) => Promise.resolve(videoJob(id, outputOf('new'))),
      savedAfter: [videoJob('vj-2', outputOf('new'))],
    });
    const section = within(await openScenes(user));
    await user.click(await section.findByRole('button', { name: 'Write video prompts' }));
    await section.findByText('No connection.');
    await user.click(section.getByRole('button', { name: 'Write video prompts' }));
    await section.findByLabelText('1. Product Hero (video prompt)');
    await user.click(section.getByRole('button', { name: 'Write them again' }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[1]).toBe(keys[0]); // the lost answer is retried with the same key
    expect(keys[2]).not.toBe(keys[1]); // a real answer ends that action
  });
});
