import type { Job } from '@creatorops/contracts';
import { describe, expect, it } from 'vitest';

import {
  canStartGeneration,
  dashboardCampaignPath,
  hasActiveJob,
  jobStatusText,
  newExtensionIdempotencyKey,
} from './campaigns.js';

describe('hasActiveJob', () => {
  it('is true while a job is queued or running, false when all are final', () => {
    expect(hasActiveJob([job('a', { status: 'queued' })])).toBe(true);
    expect(hasActiveJob([job('a', { status: 'succeeded' }), job('b', { status: 'running' })])).toBe(
      true,
    );
    expect(hasActiveJob([job('a', { status: 'succeeded' }), job('b', { status: 'failed' })])).toBe(
      false,
    );
    expect(hasActiveJob([])).toBe(false);
  });
});

function job(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    workspaceId: 'w1',
    type: 'generate_brief',
    status: 'queued',
    input: {},
    output: null,
    errorCode: null,
    errorMessage: null,
    provider: null,
    attempts: 0,
    maxAttempts: 3,
    campaignId: 'c1',
    draftId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('canStartGeneration', () => {
  it('allows owner, admin and editor only', () => {
    expect(canStartGeneration('owner')).toBe(true);
    expect(canStartGeneration('admin')).toBe(true);
    expect(canStartGeneration('editor')).toBe(true);
    expect(canStartGeneration('reviewer')).toBe(false);
    expect(canStartGeneration('viewer')).toBe(false);
    expect(canStartGeneration(undefined)).toBe(false);
  });
});

describe('jobStatusText', () => {
  it('describes each state in plain text', () => {
    expect(jobStatusText(job('j', { status: 'queued' }))).toBe('Waiting to start');
    expect(jobStatusText(job('j', { status: 'running', attempts: 2, maxAttempts: 3 }))).toBe(
      'Writing your content… attempt 2 of 3',
    );
    expect(jobStatusText(job('j', { status: 'succeeded' }))).toBe(
      'Done. Review the drafts in the dashboard.',
    );
    expect(jobStatusText(job('j', { status: 'cancelled' }))).toBe('Cancelled');
  });

  it('shows the API safe message for a failed job, with a fallback', () => {
    expect(
      jobStatusText(job('j', { status: 'failed', errorMessage: 'The provider is busy.' })),
    ).toBe('The provider is busy.');
    expect(jobStatusText(job('j', { status: 'failed', errorMessage: null }))).toBe(
      'The job failed.',
    );
  });
});

describe('newExtensionIdempotencyKey', () => {
  it('makes a key the API accepts, different on every call', () => {
    const a = newExtensionIdempotencyKey();
    const b = newExtensionIdempotencyKey();
    expect(a).toMatch(/^ext-[0-9a-f-]{36}$/);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).not.toBe(b);
  });
});

describe('dashboardCampaignPath', () => {
  it('encodes the workspace and campaign ids', () => {
    expect(dashboardCampaignPath('w 1', 'c/1')).toBe('/w/w%201/campaigns/c%2F1');
  });
});
