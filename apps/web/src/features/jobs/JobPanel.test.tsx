import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Job } from '@creatorops/contracts';

import { createDashboardClient } from '../../api/client.js';
import type { SessionResult } from '../../api/session.js';
import { DashboardContext } from '../../app/dashboard-context.js';
import { createFakeApi, json, WORKSPACE } from '../../test/fakeApi.js';
import { createFakeContentApi, makeJob } from '../../test/fakeContentApi.js';
import { JobPanel } from './JobPanel.js';

const READY: SessionResult = { status: 'ready', error: null, retry: undefined };
const JOB_PATH = `/api/v1/workspaces/${WORKSPACE.id}/jobs/job_1`;

function renderPanel(
  jobs: Job[],
  props: { onFinished?: (job: Job) => void; onRetry?: () => void } = {},
  intercept?: Parameters<typeof createFakeApi>[0] extends infer O
    ? O extends { intercept?: infer I }
      ? I
      : never
    : never,
) {
  const content = createFakeContentApi({ jobs });
  const api = createFakeApi({
    intercept: async (call) => (await intercept?.(call)) ?? content.intercept(call),
  });
  const client = createDashboardClient({
    baseUrl: 'http://api.test',
    getToken: () => 'test-token',
    fetch: api.fetch,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFinished = props.onFinished ?? vi.fn();
  const onRetry = props.onRetry ?? vi.fn();
  const tree = (finished: (job: Job) => void) => (
    <QueryClientProvider client={queryClient}>
      <DashboardContext.Provider value={{ client, session: READY }}>
        <JobPanel
          workspaceId={WORKSPACE.id}
          jobId="job_1"
          onFinished={finished}
          onRetry={onRetry}
        />
      </DashboardContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(onFinished));
  const jobGets = () =>
    api.calls.filter((call) => call.method === 'GET' && call.path === JOB_PATH).length;
  return { ...view, content, api, onFinished, onRetry, jobGets, tree };
}

describe('JobPanel', () => {
  it('shows a loading state before the first fetch completes', () => {
    renderPanel([makeJob({ id: 'job_1', status: 'queued' })]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading job…');
  });

  it('says what a queued job is doing and offers Cancel', async () => {
    renderPanel([makeJob({ id: 'job_1', status: 'queued' })]);
    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the attempt count while running', async () => {
    renderPanel([makeJob({ id: 'job_1', status: 'running', attempts: 2, maxAttempts: 3 })]);
    expect(await screen.findByText('Writing your content… attempt 2 of 3')).toBeInTheDocument();
  });

  it('shows the job error message for a failed job, with Try again', async () => {
    const onRetry = vi.fn();
    renderPanel(
      [
        makeJob({
          id: 'job_1',
          status: 'failed',
          errorCode: 'PROVIDER_TIMEOUT',
          errorMessage: 'การเขียนใช้เวลานานเกินไป (timeout). Please try again.',
        }),
      ],
      { onRetry },
    );
    expect(
      await screen.findByText('การเขียนใช้เวลานานเกินไป (timeout). Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows Cancelled with Try again for a cancelled job', async () => {
    renderPanel([makeJob({ id: 'job_1', status: 'cancelled' })]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Cancelled$/));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('shows Done and no Cancel button for a succeeded job', async () => {
    renderPanel([makeJob({ id: 'job_1', status: 'succeeded' })]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Done$/));
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('calls onFinished exactly once when the job succeeds, even across re-renders', async () => {
    const spy = vi.fn();
    const job = makeJob({ id: 'job_1', status: 'succeeded' });
    const { rerender, content, tree } = renderPanel([job], { onFinished: spy });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Done$/));

    // New function identities on each render, as a parent page would pass them.
    rerender(tree((finished) => spy(finished)));
    rerender(tree((finished) => spy(finished)));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ id: 'job_1', status: 'succeeded' });
    expect(content.jobs[0]?.status).toBe('succeeded');
  });

  it('stops polling once the job has succeeded', async () => {
    const { jobGets } = renderPanel([makeJob({ id: 'job_1', status: 'succeeded' })]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Done$/));
    const before = jobGets();

    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(jobGets()).toBe(before);
  });

  it('keeps the last known job and shows an error when a poll fails', async () => {
    let fail = false;
    const { content } = renderPanel(
      [makeJob({ id: 'job_1', status: 'running', attempts: 1 })],
      {},
      (call) => {
        if (fail && call.method === 'GET' && call.path === JOB_PATH) {
          return json(
            { error: { code: 'INTERNAL_ERROR', message: 'Boom.', requestId: 'req-job' } },
            500,
          );
        }
        return undefined;
      },
    );
    expect(await screen.findByText('Writing your content… attempt 1 of 3')).toBeInTheDocument();

    fail = true;
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });

    expect(within(alert).getByText('Boom.')).toBeInTheDocument();
    expect(screen.getByText('Writing your content… attempt 1 of 3')).toBeInTheDocument();
    expect(content.jobs[0]?.id).toBe('job_1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
  });

  it('asks the server to cancel a queued job when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel([makeJob({ id: 'job_1', status: 'queued' })]);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Cancelled$/));
    expect(
      api.calls.some((call) => call.method === 'POST' && call.path === `${JOB_PATH}/cancel`),
    ).toBe(true);
  });
});
