import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@creatorops/contracts';
import type { Job, RegenerateSectionJobRequest } from '@creatorops/contracts';

import { createDashboardClient } from '../../api/client.js';
import type { SessionResult } from '../../api/session.js';
import { DashboardContext } from '../../app/dashboard-context.js';
import { useRegenerateSection } from './jobQueries.js';

const READY: SessionResult = { status: 'ready', error: null, retry: undefined };
const KEY_FORMAT = /^ui-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REQUEST: RegenerateSectionJobRequest = {
  draftId: 'draft_1',
  section: 'hook',
  expectedRev: 2,
};
const OTHER_SECTION: RegenerateSectionJobRequest = { ...REQUEST, section: 'script' };

const JOB = {
  id: 'job_1',
  workspaceId: 'ws_1',
  type: 'regenerate_section',
  status: 'queued',
} as unknown as Job;

/** A client whose regenerateSection is a mock; the mock decides each call's outcome. */
type Harness = ReturnType<typeof createHarness>;

function createHarness() {
  const regenerateSection = vi.fn<(...args: unknown[]) => Promise<Job>>();
  const base = createDashboardClient({
    baseUrl: 'http://api.test',
    getToken: () => 'test-token',
    fetch: (() => Promise.reject(new Error('unused'))) as typeof fetch,
  });
  const client = {
    ...base,
    jobs: { ...base.jobs, regenerateSection },
  } as unknown as typeof base;
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DashboardContext.Provider value={{ client, session: READY }}>
        {children}
      </DashboardContext.Provider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useRegenerateSection('ws_1'), { wrapper });
  const keysUsed = () => regenerateSection.mock.calls.map((call) => call[2] as string);
  return { regenerateSection, keysUsed, mutate: hook.result };
}

async function run(
  result: { current: ReturnType<typeof useRegenerateSection> },
  request: RegenerateSectionJobRequest,
  outcome: 'ok' | Error,
  harness: Harness,
) {
  if (outcome === 'ok') harness.regenerateSection.mockResolvedValueOnce(JOB);
  else harness.regenerateSection.mockRejectedValueOnce(outcome);
  await act(async () => {
    await result.current.mutateAsync(request).catch(() => undefined);
  });
}

const networkError = () =>
  new ApiError({ code: 'NETWORK_ERROR', message: 'Could not reach the server.' });
const timeoutError = () => new ApiError({ code: 'TIMEOUT', message: 'The server took too long.' });
const conflictError = () =>
  new ApiError({
    code: 'CONFLICT',
    message: 'This section changed since you loaded it.',
    status: 409,
  });
const serverError = () => new ApiError({ code: 'INTERNAL_ERROR', message: 'Boom.', status: 500 });

describe('useRegenerateSection', () => {
  it('sends the request body and an Idempotency-Key with the expected format', async () => {
    const setupResult = createHarness();
    const hook = setupResult.mutate;
    await run(hook, REQUEST, 'ok', setupResult);

    const [workspaceId, body, key] = setupResult.regenerateSection.mock.calls[0] ?? [];
    expect(workspaceId).toBe('ws_1');
    expect(body).toEqual(REQUEST);
    expect(key).toMatch(KEY_FORMAT);
  });

  it('reuses the same key for a retry after a network error (same draft, section and revision)', async () => {
    const setupResult = createHarness();
    await run(setupResult.mutate, REQUEST, networkError(), setupResult);
    await run(setupResult.mutate, REQUEST, 'ok', setupResult);

    const [first, second] = setupResult.keysUsed();
    expect(first).toMatch(KEY_FORMAT);
    expect(second).toBe(first);
  });

  it('reuses the key after a timeout as well', async () => {
    const setupResult = createHarness();
    await run(setupResult.mutate, REQUEST, timeoutError(), setupResult);
    await run(setupResult.mutate, REQUEST, 'ok', setupResult);

    const [first, second] = setupResult.keysUsed();
    expect(second).toBe(first);
  });

  it('makes a new key after a success, even for the same request', async () => {
    const setupResult = createHarness();
    await run(setupResult.mutate, REQUEST, 'ok', setupResult);
    await run(setupResult.mutate, REQUEST, 'ok', setupResult);

    const [first, second] = setupResult.keysUsed();
    expect(second).not.toBe(first);
  });

  it('makes a new key after a CONFLICT or a server error', async () => {
    const conflict = createHarness();
    await run(conflict.mutate, REQUEST, conflictError(), conflict);
    await run(conflict.mutate, REQUEST, 'ok', conflict);
    const [a, b] = conflict.keysUsed();
    expect(b).not.toBe(a);

    const serverFailure = createHarness();
    await run(serverFailure.mutate, REQUEST, serverError(), serverFailure);
    await run(serverFailure.mutate, REQUEST, 'ok', serverFailure);
    const [c, d] = serverFailure.keysUsed();
    expect(d).not.toBe(c);
  });

  it('makes a new key when the section or the revision differs from the failed attempt', async () => {
    const setupResult = createHarness();
    await run(setupResult.mutate, REQUEST, networkError(), setupResult);
    await run(setupResult.mutate, OTHER_SECTION, 'ok', setupResult);
    const [first, second] = setupResult.keysUsed();
    expect(second).not.toBe(first);
  });
});
