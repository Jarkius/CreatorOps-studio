import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Campaign, Draft, Job, Workspace } from '@creatorops/contracts';

import { createFakeApi, WORKSPACE } from '../../test/fakeApi.js';
import {
  createContentFetch,
  createFakeContentApi,
  makeCampaign,
  makeDraft,
  makeJob,
} from '../../test/fakeContentApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const CAMPAIGN_PATH = `/w/${WORKSPACE.id}/campaigns/camp_1`;
const THAI_CAMPAIGN = 'แคมเปญพัดลมตั้งโต๊ะ น้ำหนักเบา';
const CAMPAIGN = makeCampaign({
  id: 'camp_1',
  name: THAI_CAMPAIGN,
  productId: 'prod_1',
  tone: 'สนุก เป็นกันเอง',
});

interface SetupOptions {
  path?: string;
  role?: Workspace['role'];
  campaigns?: Campaign[];
  jobs?: Job[];
  drafts?: Draft[];
  loseBriefResponses?: number;
  briefErrors?: { status: number; code: string; message: string }[];
  draftsOnSuccess?: Parameters<typeof createFakeContentApi>[0] extends infer O
    ? O extends { draftsOnSuccess?: infer F }
      ? F
      : never
    : never;
}

/** The campaign page wired to the content fake, with every request's Idempotency-Key recorded. */
function setup(options: SetupOptions = {}) {
  const content = createFakeContentApi({
    campaigns: options.campaigns ?? [CAMPAIGN],
    jobs: options.jobs,
    drafts: options.drafts,
    loseBriefResponses: options.loseBriefResponses,
    briefErrors: options.briefErrors,
    draftsOnSuccess: options.draftsOnSuccess,
  });
  const api = createFakeApi({
    workspaces: [{ ...WORKSPACE, role: options.role ?? 'owner' }],
    intercept: content.intercept,
  });
  const wire = createContentFetch(api.fetch);
  const view = renderWeb(options.path ?? CAMPAIGN_PATH, { ...api, fetch: wire.fetch });
  const briefPosts = () =>
    wire.keys.filter(
      (record) => record.method === 'POST' && record.path.endsWith('/jobs/generate-brief'),
    );
  return { ...view, api, content, keys: wire.keys, briefPosts };
}

const KEY_FORMAT = /^ui-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The sentence under the job status pill (the pill repeats the same word). */
const jobSentence = () => screen.getByRole('status');

async function generate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Generate content' }));
}

describe('CampaignPage', () => {
  it('shows the campaign settings, with the product linked by id', async () => {
    setup();

    expect(await screen.findByRole('heading', { name: THAI_CAMPAIGN })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'prod_1' })).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.id}/products/prod_1`,
    );
    expect(screen.getByText('product-showcase, version 1')).toBeInTheDocument();
    expect(screen.getByText('Generic')).toBeInTheDocument();
    expect(screen.getByText('30 seconds')).toBeInTheDocument();
    expect(screen.getByText('Thai')).toBeInTheDocument();
    expect(screen.getByText('สนุก เป็นกันเอง')).toBeInTheDocument();
  });

  it('shows None for an empty tone', async () => {
    setup({ campaigns: [makeCampaign({ id: 'camp_1', name: 'No tone', tone: null })] });
    expect(await screen.findByText('None')).toBeInTheDocument();
  });

  it('sends an Idempotency-Key with the generate click and shows the new job', async () => {
    const user = userEvent.setup();
    const { briefPosts, router } = setup();

    await generate(user);

    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
    expect(briefPosts()).toHaveLength(1);
    expect(briefPosts()[0]?.key).toMatch(KEY_FORMAT);
    expect(router.state.location.search).toBe('?job=job_1');
  });

  it('cannot start a second job while the first one is queued or running', async () => {
    const user = userEvent.setup();
    const { briefPosts, content } = setup();
    await generate(user);
    await screen.findByText('Waiting to start');
    expect(screen.getByRole('button', { name: 'Generate content' })).toBeDisabled();
    content.advanceJob('job_1', 'running', { attempts: 1 });
    await screen.findByText(/Writing your content/, undefined, { timeout: 4000 });
    expect(screen.getByRole('button', { name: 'Generate content' })).toBeDisabled();
    expect(briefPosts()).toHaveLength(1);
  });

  it('polls until the job succeeds, then shows the drafts and the Needs review badge', async () => {
    const user = userEvent.setup();
    const { content } = setup({
      draftsOnSuccess: (job, campaign) => [
        makeDraft({ id: 'draft_camp1_1', campaignId: campaign.id, needsReview: true }),
        makeDraft({
          id: 'draft_camp1_2',
          campaignId: campaign.id,
          variantIndex: 1,
          sections: {
            ...makeDraft({ id: 'x', campaignId: campaign.id }).sections,
            title: 'ฉบับที่สอง Second variant ที่น้ำ',
          },
        }),
      ],
    });
    await generate(user);
    await screen.findByText('Waiting to start');
    content.advanceJob('job_1', 'running', { attempts: 1 });

    expect(
      await screen.findByText('Writing your content… attempt 1 of 3', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Your drafts will appear here')).toBeInTheDocument();
    expect(screen.getByText('Your drafts will appear here').parentElement).toHaveTextContent(
      'Your drafts will appear here',
    );

    content.advanceJob('job_1', 'succeeded');

    await waitFor(() => expect(jobSentence()).toHaveTextContent(/^Done$/), { timeout: 4000 });
    const drafts = await screen.findByRole('list', { name: 'Drafts' });
    expect(within(drafts).getByRole('link', { name: 'Variant 1' })).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.id}/drafts/draft_camp1_1`,
    );
    expect(within(drafts).getByRole('link', { name: 'Variant 2' })).toBeInTheDocument();
    expect(within(drafts).getAllByText('Draft')).toHaveLength(2);
    expect(within(drafts).getByText('Needs review')).toBeInTheDocument();
    expect(within(drafts).getByText('ฉบับที่สอง Second variant ที่น้ำ')).toBeInTheDocument();
    expect(screen.queryByText('Your drafts will appear here')).not.toBeInTheDocument();
  }, 15000);

  it('shows a failed job message, and Try again starts a NEW key and a new job', async () => {
    const user = userEvent.setup();
    const { content, briefPosts } = setup();
    await generate(user);
    await screen.findByText('Waiting to start');
    content.advanceJob('job_1', 'failed', {
      errorCode: 'PROVIDER_TIMEOUT',
      errorMessage: 'การเขียนใช้เวลานานเกินไป. Please try again.',
      attempts: 3,
    });

    expect(
      await screen.findByText('การเขียนใช้เวลานานเกินไป. Please try again.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
    expect(briefPosts()).toHaveLength(2);
    expect(briefPosts()[1]?.key).toMatch(KEY_FORMAT);
    expect(briefPosts()[1]?.key).not.toBe(briefPosts()[0]?.key);
    expect(content.jobs.map((job) => job.id)).toEqual(['job_1', 'job_2']);
  }, 15000);

  it('after a network failure, the retry reuses the SAME key and does not make a second job', async () => {
    const user = userEvent.setup();
    const { content, briefPosts } = setup({ loseBriefResponses: 1 });

    await generate(user);

    expect(
      await screen.findByText('Could not reach the server. Check your connection and try again.'),
    ).toBeInTheDocument();
    expect(content.jobs).toHaveLength(1);

    await generate(user);

    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
    expect(briefPosts()).toHaveLength(2);
    expect(briefPosts()[1]?.key).toBe(briefPosts()[0]?.key);
    expect(content.jobs).toHaveLength(1);
  });

  it('after a non-network error, the next click makes a new key', async () => {
    const user = userEvent.setup();
    const { briefPosts, content } = setup({
      briefErrors: [{ status: 500, code: 'INTERNAL_ERROR', message: 'Boom.' }],
    });

    await generate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom.');

    await generate(user);

    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
    expect(briefPosts()).toHaveLength(2);
    expect(briefPosts()[1]?.key).not.toBe(briefPosts()[0]?.key);
    expect(content.jobs).toHaveLength(1);
  });

  it('after a success, the next generate click makes a new key', async () => {
    const user = userEvent.setup();
    const { content, briefPosts } = setup();
    await generate(user);
    await screen.findByText('Waiting to start');
    content.advanceJob('job_1', 'succeeded');
    await waitFor(() => expect(jobSentence()).toHaveTextContent(/^Done$/), { timeout: 4000 });

    await generate(user);

    await waitFor(() => expect(briefPosts()).toHaveLength(2));
    expect(briefPosts()[1]?.key).not.toBe(briefPosts()[0]?.key);
  }, 15000);

  it('cancels a running job: Cancelling… while pending, then Cancelled once the worker stops', async () => {
    const user = userEvent.setup();
    const { content, api } = setup();
    await generate(user);
    await screen.findByText('Waiting to start');
    content.advanceJob('job_1', 'running', { attempts: 1 });
    await screen.findByText('Writing your content… attempt 1 of 3', {}, { timeout: 4000 });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('button', { name: 'Cancelling…' })).toBeDisabled();
    expect(
      api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/jobs/job_1/cancel')),
    ).toBe(true);

    content.advanceJob('job_1', 'cancelled');

    await waitFor(() => expect(jobSentence()).toHaveTextContent(/^Cancelled$/), { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  }, 15000);

  it('shows the archived message and no working generate button for an archived campaign', async () => {
    setup({ campaigns: [makeCampaign({ ...CAMPAIGN, status: 'archived' })] });

    const button = await screen.findByRole('button', {
      name: 'Archived campaigns cannot be generated',
    });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Generate content' })).not.toBeInTheDocument();
  });

  it.each(['viewer', 'reviewer'] as const)('shows no generate button to a %s', async (role) => {
    setup({ role });

    expect(await screen.findByRole('heading', { name: THAI_CAMPAIGN })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Generate content|cannot be generated/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the same job again after a reload with ?job=', async () => {
    const { briefPosts } = setup({
      path: `${CAMPAIGN_PATH}?job=job_9`,
      jobs: [makeJob({ id: 'job_9', campaignId: 'camp_1', status: 'running', attempts: 2 })],
    });

    expect(
      await screen.findByText('Writing your content… attempt 2 of 3', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(briefPosts()).toHaveLength(0);
  });

  it('lists only the drafts of this campaign', async () => {
    setup({
      campaigns: [CAMPAIGN, makeCampaign({ id: 'camp_2', name: 'Other campaign' })],
      drafts: [
        makeDraft({
          id: 'draft_a',
          campaignId: 'camp_1',
          sections: {
            ...makeDraft({ id: 'x', campaignId: 'camp_1' }).sections,
            title: 'ฉบับของแคมเปญนี้',
          },
        }),
        makeDraft({
          id: 'draft_b',
          campaignId: 'camp_2',
          sections: {
            ...makeDraft({ id: 'y', campaignId: 'camp_2' }).sections,
            title: 'Other campaign draft',
          },
        }),
      ],
    });

    const list = await screen.findByRole('list', { name: 'Drafts' });
    expect(within(list).getByText('ฉบับของแคมเปญนี้')).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Other campaign draft')).not.toBeInTheDocument();
  });

  it('shows No drafts yet for a campaign without drafts', async () => {
    setup({ campaigns: [makeCampaign({ id: 'camp_1', name: 'Empty' })] });
    expect(await screen.findByRole('heading', { name: 'No drafts yet' })).toBeInTheDocument();
  });

  it('shows Campaign not found for an unknown campaign', async () => {
    setup({ path: `/w/${WORKSPACE.id}/campaigns/camp_missing` });
    expect(await screen.findByRole('heading', { name: 'Campaign not found' })).toBeInTheDocument();
  });
});
