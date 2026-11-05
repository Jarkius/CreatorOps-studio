import {
  ApiError,
  type ApiClient,
  type CampaignCost,
  type CampaignListItem,
  type Job,
  type JobStatus,
} from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CampaignsPanel } from './CampaignsPanel.js';

const DASHBOARD = 'http://dash.test';
const KEY_PATTERN = /^ext-[0-9a-f-]{36}$/;

function campaign(
  id: string,
  name: string,
  overrides: Partial<CampaignListItem> = {},
): CampaignListItem {
  return {
    id,
    workspaceId: 'w1',
    productId: 'p1',
    name,
    templateId: 'hero_detail',
    templateVersion: 1,
    language: 'th',
    tone: null,
    platform: 'tiktok',
    durationSeconds: 30,
    variants: 1,
    status: 'draft',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    latestGenerateJob: null,
    ...overrides,
  };
}

function job(id: string, campaignId: string, status: JobStatus, overrides: Partial<Job> = {}): Job {
  return {
    id,
    workspaceId: 'w1',
    type: 'generate_brief',
    status,
    input: {},
    output: null,
    errorCode: null,
    errorMessage: null,
    provider: null,
    attempts: 1,
    maxAttempts: 3,
    campaignId,
    draftId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

const COST: CampaignCost = {
  currency: 'THB',
  thbPerUsd: 0.3333,
  rateSource: 'settings',
  marketThbPerUsd: 35,
  aiText: { calls: 1, costUsd: 0.08, costThb: 0.03, anomalies: 0 },
  manual: {
    items: [
      { id: 'm1', campaignId: 'c1', scene: null, label: 'Tool', amountThb: 12.5, createdAt: '' },
    ],
    totalThb: 12.5,
  },
  totalThb: 12.53,
};

interface Fakes {
  campaigns?: () => Promise<{ items: CampaignListItem[]; nextCursor: null }>;
  generateBrief?: (...args: unknown[]) => Promise<Job>;
  cancel?: (workspaceId: string, jobId: string) => Promise<Job>;
  cost?: () => Promise<CampaignCost>;
}

function renderPanel(fakes: Fakes, options: { canStart?: boolean } = {}) {
  const campaignsList = vi.fn(
    fakes.campaigns ?? (() => Promise.resolve({ items: [], nextCursor: null })),
  );
  const generateBrief = vi.fn(
    fakes.generateBrief ?? (() => Promise.resolve(job('new', 'c1', 'queued'))),
  );
  const cancel = vi.fn(
    fakes.cancel ?? ((_w: string, id: string) => Promise.resolve(job(id, 'c1', 'cancelled'))),
  );
  const api = {
    campaigns: { list: campaignsList, cost: fakes.cost ?? (() => Promise.resolve(COST)) },
    jobs: { generateBrief, cancel },
  } as unknown as ApiClient;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CampaignsPanel
        api={api}
        workspaceId="w1"
        dashboardUrl={DASHBOARD}
        canStart={options.canStart ?? true}
      />
    </QueryClientProvider>,
  );
  return { campaignsList, generateBrief, cancel };
}

const section = () => screen.getByRole('region', { name: 'Campaigns' });
const row = (name: string) => within(section()).getByText(name).closest('li') as HTMLElement;

describe('side panel campaigns', () => {
  it('lists campaigns without archived ones and shows each latest job status', async () => {
    renderPanel({
      campaigns: () =>
        Promise.resolve({
          items: [
            campaign('c1', 'Hero launch', { latestGenerateJob: job('j2', 'c1', 'succeeded') }),
            campaign('c2', 'Old one', { status: 'archived' }),
            campaign('c3', 'Spring sale'),
          ],
          nextCursor: null,
        }),
    });
    expect(await screen.findByText('Hero launch')).toBeInTheDocument();
    expect(screen.getByText('Spring sale')).toBeInTheDocument();
    expect(screen.queryByText('Old one')).not.toBeInTheDocument();
    expect(within(row('Hero launch')).getByText(/Done\. Review the drafts/)).toBeInTheDocument();
    expect(within(row('Spring sale')).queryByText(/Done|Busy/)).not.toBeInTheDocument();
  });

  it('shows what each campaign cost in baht with US dollars beside it', async () => {
    renderPanel({
      campaigns: () =>
        Promise.resolve({ items: [campaign('c1', 'Hero launch')], nextCursor: null }),
    });
    const line = await within(
      await screen.findByText('Hero launch').then((e) => e.closest('li')!),
    ).findByLabelText('Campaign cost');
    expect(line).toHaveTextContent('Cost: ฿12.53 ≈ $0.36 · AI ฿0.03 · typed in ฿12.50');
  });

  it('says the cost is unavailable when it cannot be read, and the row still works', async () => {
    renderPanel({
      campaigns: () =>
        Promise.resolve({ items: [campaign('c1', 'Hero launch')], nextCursor: null }),
      cost: () => Promise.reject(new Error('down')),
    });
    expect(await screen.findByText('Cost unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Hero launch' })).toBeEnabled();
  });

  it('reads the cost again when the latest job finishes', async () => {
    const cost = vi.fn(() => Promise.resolve(COST));
    let status: JobStatus = 'running';
    renderPanel({
      campaigns: () =>
        Promise.resolve({
          items: [campaign('c1', 'Hero launch', { latestGenerateJob: job('j1', 'c1', status) })],
          nextCursor: null,
        }),
      cost,
    });
    await screen.findByLabelText('Campaign cost');
    expect(cost).toHaveBeenCalledTimes(1);
    status = 'succeeded'; // the next poll of the list (after 2 s) returns the finished job
    await waitFor(() => expect(cost).toHaveBeenCalledTimes(2), { timeout: 5000 });
  });

  it('shows an empty state with a link to create a campaign in the dashboard', async () => {
    renderPanel({});
    expect(await screen.findByText('No campaigns yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create campaign' })).toHaveAttribute(
      'href',
      `${DASHBOARD}/w/w1/campaigns/new`,
    );
  });

  it('shows an error with a retry that loads again', async () => {
    const list = vi
      .fn<() => Promise<{ items: CampaignListItem[]; nextCursor: null }>>()
      .mockRejectedValueOnce(
        new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'Could not load.',
          status: 500,
          requestId: 'req-9',
        }),
      )
      .mockResolvedValueOnce({ items: [campaign('c1', 'Back again')], nextCursor: null });
    renderPanel({ campaigns: list });
    expect(await screen.findByText('Could not load.')).toBeInTheDocument();
    expect(screen.getByText(/req-9/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again')).toBeInTheDocument();
  });

  it('hides Generate for a read-only member but keeps the dashboard links', async () => {
    renderPanel(
      {
        campaigns: () =>
          Promise.resolve({ items: [campaign('c1', 'Hero launch')], nextCursor: null }),
      },
      { canStart: false },
    );
    await screen.findByText('Hero launch');
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Hero launch in the dashboard' })).toHaveAttribute(
      'href',
      `${DASHBOARD}/w/w1/campaigns/c1`,
    );
  });

  it('starts a job with one key per click, and a new key after a success', async () => {
    const { generateBrief } = renderPanel({
      campaigns: () =>
        Promise.resolve({ items: [campaign('c1', 'Hero launch')], nextCursor: null }),
    });
    await screen.findByText('Hero launch');
    await userEvent.click(screen.getByRole('button', { name: 'Generate Hero launch' }));
    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(1));
    expect(generateBrief.mock.calls[0]?.[1]).toEqual({ campaignId: 'c1' });
    const firstKey = generateBrief.mock.calls[0]?.[2];
    expect(firstKey).toMatch(KEY_PATTERN);

    await userEvent.click(await screen.findByRole('button', { name: 'Generate Hero launch' }));
    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(2));
    expect(generateBrief.mock.calls[1]?.[2]).not.toBe(firstKey);
  });

  it('reuses the key when the request got no response, and makes a new one after an API error', async () => {
    const generateBrief = vi
      .fn<(...args: unknown[]) => Promise<Job>>()
      .mockRejectedValueOnce(new ApiError({ code: 'NETWORK_ERROR', message: 'Offline.' }))
      .mockResolvedValueOnce(job('j1', 'c1', 'queued'))
      .mockRejectedValueOnce(
        new ApiError({ code: 'RATE_LIMITED', message: 'Slow down.', status: 429 }),
      )
      .mockResolvedValueOnce(job('j2', 'c1', 'queued'));
    renderPanel({
      campaigns: () =>
        Promise.resolve({ items: [campaign('c1', 'Hero launch')], nextCursor: null }),
      generateBrief,
    });
    await screen.findByText('Hero launch');
    const button = () => screen.getByRole('button', { name: /Hero launch/ });

    await userEvent.click(button());
    expect(await screen.findByText('Offline.')).toBeInTheDocument();
    await userEvent.click(button());
    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(2));
    expect(generateBrief.mock.calls[1]?.[2]).toBe(generateBrief.mock.calls[0]?.[2]);

    await userEvent.click(await screen.findByRole('button', { name: /Generate Hero launch/ }));
    expect(await screen.findByText(/Slow down\./)).toBeInTheDocument();
    await userEvent.click(button());
    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(4));
    expect(generateBrief.mock.calls[3]?.[2]).not.toBe(generateBrief.mock.calls[2]?.[2]);
  });

  it('disables Generate while the latest job runs, and offers Cancel', async () => {
    const cancel = vi.fn((_w: string, id: string) => Promise.resolve(job(id, 'c1', 'cancelled')));
    renderPanel({
      campaigns: () =>
        Promise.resolve({
          items: [
            campaign('c1', 'Hero launch', {
              latestGenerateJob: job('j9', 'c1', 'running', { attempts: 2 }),
            }),
          ],
          nextCursor: null,
        }),
      cancel,
    });
    await screen.findByText(/Writing your content… attempt 2 of 3/);
    expect(screen.getByRole('button', { name: 'Generating… Hero launch' })).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel generation for Hero launch' }),
    );
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('w1', 'j9'));
  });

  it('offers Try again after a failed job, and a link to the drafts after success', async () => {
    renderPanel({
      campaigns: () =>
        Promise.resolve({
          items: [
            campaign('c1', 'Hero launch', {
              latestGenerateJob: job('j2', 'c1', 'failed', {
                errorMessage: 'The provider is busy.',
              }),
            }),
            campaign('c2', 'Spring sale', { latestGenerateJob: job('j1', 'c2', 'succeeded') }),
          ],
          nextCursor: null,
        }),
    });
    expect(await screen.findByRole('button', { name: 'Try again Hero launch' })).toBeEnabled();
    expect(screen.getByText('The provider is busy.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Spring sale' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Open Spring sale in the dashboard' })).toHaveAttribute(
      'href',
      `${DASHBOARD}/w/w1/campaigns/c2`,
    );
  });

  it('polls the campaign list while a job runs, and stops once every job is final', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const page = (status: JobStatus) => ({
        items: [campaign('c1', 'Hero launch', { latestGenerateJob: job('j1', 'c1', status) })],
        nextCursor: null as null,
      });
      const campaigns = vi
        .fn<() => Promise<{ items: CampaignListItem[]; nextCursor: null }>>()
        .mockResolvedValueOnce(page('running'))
        .mockResolvedValue(page('succeeded'));
      const { campaignsList } = renderPanel({ campaigns });
      await screen.findByText(/Writing your content/);
      expect(campaignsList).toHaveBeenCalledTimes(1);

      // First poll after 2 s; the answer is final, so polling stops.
      await waitFor(() => expect(campaignsList).toHaveBeenCalledTimes(2), { timeout: 5000 });
      await screen.findByText(/Done\. Review the drafts/);
      vi.advanceTimersByTime(30000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(campaignsList).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the latest job of a campaign however old, because the list carries it (D-064)', async () => {
    renderPanel({
      campaigns: () =>
        Promise.resolve({
          items: [
            campaign('c1', 'Old campaign', {
              latestGenerateJob: job('j1', 'c1', 'failed', { errorMessage: 'Provider timed out.' }),
            }),
          ],
          nextCursor: null,
        }),
    });
    expect(await screen.findByText('Provider timed out.')).toBeInTheDocument();
  });

  it('shows a start error under its own row with the request id', async () => {
    renderPanel({
      campaigns: () =>
        Promise.resolve({
          items: [campaign('c1', 'Hero launch'), campaign('c2', 'Spring sale')],
          nextCursor: null,
        }),
      generateBrief: () =>
        Promise.reject(
          new ApiError({
            code: 'CONFLICT',
            message: 'Campaign is archived.',
            status: 409,
            requestId: 'req-3',
          }),
        ),
    });
    await screen.findByText('Hero launch');
    await userEvent.click(screen.getByRole('button', { name: 'Generate Hero launch' }));
    const alert = await within(row('Hero launch')).findByRole('alert');
    expect(alert).toHaveTextContent('Campaign is archived. (request req-3)');
    expect(within(row('Spring sale')).queryByRole('alert')).not.toBeInTheDocument();
  });
});
