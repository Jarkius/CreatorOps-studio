import type { ApiClient, CampaignListItem, Draft, DraftAsset, Job } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CampaignsPanel } from './CampaignsPanel.js';

const NOW = '2026-01-01T00:00:00.000Z';

const JOB = {
  id: 'j1',
  workspaceId: 'w1',
  type: 'generate_brief',
  status: 'succeeded',
  input: {},
  output: null,
  errorCode: null,
  errorMessage: null,
  provider: null,
  attempts: 1,
  maxAttempts: 3,
  campaignId: 'c1',
  draftId: null,
  createdAt: NOW,
  startedAt: null,
  finishedAt: null,
} as Job;

const CAMPAIGN = {
  id: 'c1',
  workspaceId: 'w1',
  productId: 'p1',
  name: 'Hero launch',
  templateId: 'hero_detail',
  templateVersion: 1,
  language: 'th',
  tone: null,
  platform: 'tiktok',
  durationSeconds: 30,
  variants: 1,
  status: 'draft',
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  latestGenerateJob: JOB,
} as CampaignListItem;

const DRAFT = {
  id: 'd1',
  workspaceId: 'w1',
  campaignId: 'c1',
  productId: 'p1',
  variantIndex: 0,
  sections: {
    title: 'T',
    hook: 'HOOK',
    script: 'S',
    storyboard: ['hero text', 'detail text', 'usage text', 'final text'],
    caption: 'C',
    hashtags: [],
    callToAction: 'CTA',
  },
  version: 1,
} as unknown as Draft;

function setup(
  options: {
    drafts?: () => Promise<{ items: Draft[]; nextCursor: null }>;
    assets?: () => Promise<{ items: DraftAsset[] }>;
    status?: Job['status'];
  } = {},
) {
  const draftsList = vi.fn(
    options.drafts ?? (() => Promise.resolve({ items: [DRAFT], nextCursor: null })),
  );
  const listAssets = vi.fn(options.assets ?? (() => Promise.resolve({ items: [] })));
  const campaign = {
    ...CAMPAIGN,
    latestGenerateJob: { ...JOB, status: options.status ?? 'succeeded' },
  };
  const api = {
    campaigns: { list: () => Promise.resolve({ items: [campaign], nextCursor: null }) },
    jobs: {},
    drafts: { list: draftsList, listAssets },
  } as unknown as ApiClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CampaignsPanel api={api} workspaceId="w1" dashboardUrl="http://dash.test" canStart />
    </QueryClientProvider>,
  );
  return { draftsList, listAssets };
}

function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

describe('side panel scene list (A2)', () => {
  it('has no Scenes button until generation has succeeded', async () => {
    setup({ status: 'running' });
    await screen.findByText('Hero launch');
    expect(screen.queryByRole('button', { name: /scenes for/i })).not.toBeInTheDocument();
  });

  it('shows the four scenes with their prompts from the storyboard, reading only when opened', async () => {
    const user = userEvent.setup();
    const { draftsList } = setup();
    await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
    expect(await screen.findByLabelText('1. Product Hero')).toHaveValue('hero text');
    expect(screen.getByLabelText('2. Detail')).toHaveValue('detail text');
    expect(screen.getByLabelText('3. Usage')).toHaveValue('usage text');
    expect(screen.getByLabelText('4. Final Shot')).toHaveValue('final text');
    expect(draftsList).toHaveBeenCalledWith('w1', { campaignId: 'c1', limit: 1 });
    expect(await screen.findAllByText('No file yet')).toHaveLength(4);
  });

  it('lets the owner edit a prompt, copies the edited text, and resets it', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
    const box = await screen.findByLabelText('2. Detail');
    expect(screen.getByRole('button', { name: 'Reset prompt for Detail' })).toBeDisabled();
    await user.clear(box);
    await user.type(box, 'my own words');
    await user.click(screen.getByRole('button', { name: 'Copy prompt for Detail' }));
    expect(writeText).toHaveBeenCalledWith('my own words');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset prompt for Detail' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Reset prompt for Detail' }));
    expect(box).toHaveValue('detail text');
  });

  it('says so when the clipboard refuses', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('no')));
    setup();
    await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
    await screen.findByLabelText('1. Product Hero');
    await user.click(screen.getByRole('button', { name: 'Copy prompt for Product Hero' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy');
  });

  it('shows the file already attached to a scene', async () => {
    const user = userEvent.setup();
    setup({
      assets: () =>
        Promise.resolve({
          items: [
            {
              assetId: 'a1',
              scene: 'usage',
              asset: { originalFilename: 'usage.png', type: 'image' },
            } as DraftAsset,
          ],
        }),
    });
    await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
    const usage = (await screen.findByLabelText('3. Usage')).closest('li') as HTMLElement;
    expect(await within(usage).findByText('File: usage.png')).toBeInTheDocument();
    expect(screen.getAllByText('No file yet')).toHaveLength(3);
  });

  it('shows an empty state when there is no draft and an error with retry when loading fails', async () => {
    const user = userEvent.setup();
    setup({ drafts: () => Promise.resolve({ items: [], nextCursor: null }) });
    await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
    expect(await screen.findByText('No draft yet')).toBeInTheDocument();
  });

  it('shows a load error', async () => {
    const user = userEvent.setup();
    setup({ drafts: () => Promise.reject(new Error('boom')) });
    await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('hides the list again', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Show scenes for Hero launch' }));
    await screen.findByLabelText('1. Product Hero');
    await user.click(screen.getByRole('button', { name: 'Hide scenes for Hero launch' }));
    expect(screen.queryByLabelText('1. Product Hero')).not.toBeInTheDocument();
  });
});
