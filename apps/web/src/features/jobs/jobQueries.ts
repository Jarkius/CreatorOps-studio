import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { ApiError } from '@creatorops/contracts';
import type { Job, JobStatus } from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';
import { newIdempotencyKey } from './idempotency.js';

/** Query keys. Every job key starts with ['jobs', workspaceId]. */
export const jobKeys = {
  all: (workspaceId: string) => ['jobs', workspaceId] as const,
  detail: (workspaceId: string, jobId: string) => ['jobs', workspaceId, 'detail', jobId] as const,
};

/** Wait between polls: 2 s, 3 s, 5 s, 8 s, then 10 s for every later poll. */
const POLL_STEPS_MS = [2000, 3000, 5000, 8000, 10000] as const;

/** The delay before poll number `step` (0 is the first poll after the first fetch). */
export function pollDelayMs(step: number): number {
  const index = Math.min(Math.max(0, Math.floor(step)), POLL_STEPS_MS.length - 1);
  return POLL_STEPS_MS[index] ?? 10000;
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function useJob(workspaceId: string, jobId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: jobKeys.detail(workspaceId, jobId),
    queryFn: () => client.jobs.get(workspaceId, jobId),
    refetchInterval: (query) => {
      const job = query.state.data;
      if (job !== undefined && isTerminalJobStatus(job.status)) return false;
      // dataUpdateCount is 1 after the first successful fetch, so the first poll uses step 0.
      return pollDelayMs(query.state.dataUpdateCount - 1);
    },
  });
}

/**
 * Reads a job already in the cache without polling it. Used by the campaign page to know whether a
 * job is still running; the JobPanel owns the polling.
 */
export function useJobReader(workspaceId: string, jobId: string) {
  const { client } = useDashboard();
  return useQuery<Job>({
    queryKey: jobKeys.detail(workspaceId, jobId),
    queryFn: () => client.jobs.get(workspaceId, jobId),
    enabled: false,
  });
}

interface PendingKey {
  campaignId: string;
  key: string;
}

/**
 * Starts a brief job for a campaign. The key is made once per user action and is reused only when
 * the request failed without a response (network error or timeout) for the same campaign. After a
 * success, or any other error, the next call makes a new key.
 */
export function useGenerateBrief(workspaceId: string) {
  const { client } = useDashboard();
  const pendingRef = useRef<PendingKey | null>(null);
  return useMutation({
    mutationFn: async (campaignId: string): Promise<Job> => {
      const pending = pendingRef.current;
      const key =
        pending !== null && pending.campaignId === campaignId ? pending.key : newIdempotencyKey();
      pendingRef.current = { campaignId, key };
      try {
        const job = await client.jobs.generateBrief(workspaceId, { campaignId }, key);
        pendingRef.current = null;
        return job;
      } catch (error) {
        const noResponse =
          error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
        if (!noResponse) pendingRef.current = null;
        throw error;
      }
    },
  });
}

export function useCancelJob(workspaceId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => client.jobs.cancel(workspaceId, jobId),
    // Only a finished job is written to the cache. A running job is still polled, and a cache write
    // would count as an update and move the poll backoff (see useJob).
    onSuccess: (job) => {
      if (isTerminalJobStatus(job.status)) {
        queryClient.setQueryData(jobKeys.detail(workspaceId, job.id), job);
      }
    },
  });
}
