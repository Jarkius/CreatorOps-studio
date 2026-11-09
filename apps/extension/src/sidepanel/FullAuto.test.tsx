import type {
  ApiClient,
  Campaign,
  Draft,
  DraftAsset,
  Job,
  JobStatus,
  Product,
  Template,
} from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CreatePanel } from './CreatePanel.js';
import type { PageProbe } from './metaai/page.js';
import type { MetaAiBrowser, PageFunctions } from './metaai/runner.js';
import type { HelperDeps } from './metaai/useMetaAi.js';

const READY: PageProbe = {
  title: 'Meta AI',
  path: '/',
  state: 'ready',
  promptBoxIndex: 0,
  sendButtonIndex: 0,
  mediaCount: 0,
};

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

interface HelperOptions {
  permission?: boolean;
  grant?: boolean;
  /** The probe state returned from the Nth scene on (1-based) instead of ready. */
  failFromScene?: { n: number; state: PageProbe['state'] };
  /** From this scene on (1-based) no image ever appears, so the scene never finishes. */
  noImageFromScene?: number;
}

/** A fake Meta AI: each submitted prompt adds one new image address, like the real chat does. */
function fakeHelper(options: HelperOptions = {}) {
  const prompts: string[] = [];
  const calls = { request: 0 };
  const generated: string[] = [];
  let finished = 0;
  const page: PageFunctions = {
    probePage: () => {
      const n = finished + 1;
      return options.failFromScene && n >= options.failFromScene.n
        ? { ...READY, state: options.failFromScene.state }
        : READY;
    },
    submitPrompt: (_sel, prompt) => {
      prompts.push(prompt);
      if (options.noImageFromScene === undefined || prompts.length < options.noImageFromScene) {
        generated.push(`https://cdn.test/${prompts.length}.png`);
      }
      return { ok: true, how: 'button' };
    },
    listMedia: () => [...generated],
    stashMedia: () => Promise.resolve({ size: 3, type: 'image/png' }),
    readStash: () => Promise.resolve(btoa('abc')),
    clearStash: () => {
      finished += 1;
      return true;
    },
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
    // Once an image never comes, the wait itself never ends, so Cancel has something to stop.
    sleep: () =>
      options.noImageFromScene !== undefined && prompts.length >= options.noImageFromScene
        ? new Promise<void>(() => undefined)
        : Promise.resolve(),
    fetchImpl: (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch,
  };
  return { deps, prompts, calls };
}

function setup(deps: HelperDeps, options: { jobStatus?: JobStatus; attached?: DraftAsset[] } = {}) {
  const template = {
    id: 't1',
    version: 1,
    name: { th: 'ท', en: 'Showcase' },
    description: { th: 'x', en: 'x' },
    defaultDurationSeconds: 30,
  } as Template;
  const setAssets = vi.fn(() => Promise.resolve({ items: [] }));
  const api = {
    products: {
      list: () =>
        Promise.resolve({
          items: [{ id: 'p1', name: 'Fan', status: 'active' } as Product],
          nextCursor: null,
        }),
    },
    templates: { list: () => Promise.resolve({ items: [template] }) },
    campaigns: {
      create: () => Promise.resolve({ id: 'c1' } as Campaign),
      list: () => Promise.resolve({ items: [], nextCursor: null }),
    },
    jobs: {
      generateBrief: () => Promise.resolve({ id: 'j1', status: 'queued' } as Job),
      get: () =>
        Promise.resolve({
          id: 'j1',
          status: options.jobStatus ?? 'succeeded',
          attempts: 1,
          maxAttempts: 3,
          errorMessage: 'The provider is busy.',
        } as Job),
    },
    drafts: {
      list: () => Promise.resolve({ items: [DRAFT], nextCursor: null }),
      listAssets: () => Promise.resolve({ items: options.attached ?? [] }),
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
      completeUpload: () => Promise.resolve({ id: 'asset-new' }),
    },
    resolveUrl: (path: string) => `http://api.test${path}`,
  } as unknown as ApiClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CreatePanel
        api={api}
        workspaceId="w1"
        dashboardUrl="http://dash.test"
        canStart
        helper={deps}
      />
    </QueryClientProvider>,
  );
  return { setAssets };
}

const startFullAuto = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Product' }), 'p1');
  await user.click(screen.getByRole('checkbox', { name: /Full Auto/ }));
  await user.click(screen.getByRole('button', { name: 'Create content' }));
};

describe('Full Auto from the Create tab (A4)', () => {
  it('marks the image step as part of the run only when Full Auto is ticked', async () => {
    const user = userEvent.setup();
    setup(fakeHelper().deps);
    const steps = await screen.findByRole('list', { name: 'What happens' });
    expect(within(steps).getByText(/Scene images in Meta AI/)).toHaveTextContent(
      '(tick Full Auto)',
    );
    await user.click(screen.getByRole('checkbox', { name: /Full Auto/ }));
    expect(within(steps).getByText(/Scene images in Meta AI/)).not.toHaveTextContent('tick');
  });

  it('writes the script, then makes the four scenes in order with their own prompts, saving each', async () => {
    const user = userEvent.setup();
    const t = fakeHelper();
    const api = setup(t.deps);
    await startFullAuto(user);
    expect(await screen.findByText('Saved 4 scene images.')).toBeInTheDocument();
    expect(t.prompts).toEqual([
      'Imagine hero text',
      'Imagine detail text',
      'Imagine usage text',
      'Imagine final text',
    ]);
    expect(api.setAssets).toHaveBeenCalledTimes(4);
    expect(api.setAssets).toHaveBeenLastCalledWith('w1', 'd1', {
      assets: expect.arrayContaining([
        expect.objectContaining({ scene: 'final_shot', aiGenerated: true, generator: 'Meta AI' }),
      ]),
    });
  });

  it('does not ask for Meta AI, or start it, when Full Auto is not ticked', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({ permission: false });
    setup(t.deps);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Product' }), 'p1');
    await user.click(screen.getByRole('button', { name: 'Create content' }));
    expect(await screen.findByText(/Started\./)).toBeInTheDocument();
    expect(t.calls.request).toBe(0);
    expect(screen.queryByRole('region', { name: 'Full Auto' })).not.toBeInTheDocument();
    expect(t.prompts).toEqual([]);
  });

  it('asks Chrome for meta.ai on the click, and makes only the script when it is refused', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({ permission: false, grant: false });
    setup(t.deps);
    await startFullAuto(user);
    expect(
      await screen.findByText('Meta AI was not allowed, so only the script is made.'),
    ).toBeInTheDocument();
    expect(t.calls.request).toBe(1);
    expect(await screen.findByText(/Started\./)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Full Auto' })).not.toBeInTheDocument();
    expect(t.prompts).toEqual([]);
  });

  it('does not start the scenes when the script job failed', async () => {
    const user = userEvent.setup();
    const t = fakeHelper();
    setup(t.deps, { jobStatus: 'failed' });
    await startFullAuto(user);
    expect(await screen.findByText(/scene images were not started/)).toBeInTheDocument();
    // Give a wrongly started run time to show itself before checking that nothing ran.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(t.prompts).toEqual([]);
  });

  it('skips scenes that already have a file', async () => {
    const user = userEvent.setup();
    const t = fakeHelper();
    setup(t.deps, {
      attached: [
        {
          assetId: 'a1',
          scene: 'usage',
          asset: { originalFilename: 'usage.png', type: 'image' },
        } as DraftAsset,
      ],
    });
    await startFullAuto(user);
    expect(await screen.findByText('Saved 3 scene images.')).toBeInTheDocument();
    expect(t.prompts).toEqual(['Imagine hero text', 'Imagine detail text', 'Imagine final text']);
  });

  it('stops at the first problem, says how many were saved, and does not go on to the rest', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({ failFromScene: { n: 3, state: 'challenge' } });
    setup(t.deps);
    await startFullAuto(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('check that needs you');
    expect(screen.getByText('2 scene images were saved before it stopped.')).toBeInTheDocument();
    expect(t.prompts).toEqual(['Imagine hero text', 'Imagine detail text']);
  });

  it('can be cancelled in the middle of a scene, keeping what was already saved', async () => {
    const user = userEvent.setup();
    const t = fakeHelper({ noImageFromScene: 3 });
    setup(t.deps);
    await startFullAuto(user);
    const helper = await screen.findByRole('region', { name: 'Meta AI helper' });
    await waitFor(() => expect(within(helper).getByText(/Scene 3 of 4/)).toBeInTheDocument());
    await user.click(within(helper).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancelled.');
    expect(screen.getByText('2 scene images were saved before it stopped.')).toBeInTheDocument();
    expect(t.prompts).toEqual(['Imagine hero text', 'Imagine detail text', 'Imagine usage text']);
  });
});
