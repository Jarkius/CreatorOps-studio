import { ApiError, pollDelayMs, type ApiClient } from '@creatorops/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import {
  hasActiveJob,
  newExtensionIdempotencyKey,
  PANEL_CAMPAIGN_LIMIT,
  PANEL_JOB_WINDOW,
} from './campaigns.js';

/** Query keys for the panel. Every key starts with ['panel', ...] so one prefix clears them. */
export const panelKeys = {
  campaigns: (workspaceId: string) => ['panel', 'campaigns', workspaceId] as const,
  generateJobs: (workspaceId: string) => ['panel', 'generate-jobs', workspaceId] as const,
};

export function usePanelCampaigns(api: ApiClient, workspaceId: string) {
  return useQuery({
    queryKey: panelKeys.campaigns(workspaceId),
    queryFn: () => api.campaigns.list(workspaceId, { limit: PANEL_CAMPAIGN_LIMIT }),
  });
}

/**
 * The newest generate jobs of the workspace. Polled with the D-053 steps only while a listed job is
 * still queued or running; the list is the only source of job state (no local storage).
 */
export function useGenerateJobs(api: ApiClient, workspaceId: string) {
  return useQuery({
    queryKey: panelKeys.generateJobs(workspaceId),
    queryFn: () => api.jobs.list(workspaceId, { type: 'generate_brief', limit: PANEL_JOB_WINDOW }),
    refetchInterval: (query) => {
      if (!hasActiveJob(query.state.data?.items ?? [])) return false;
      // dataUpdateCount is 1 after the first successful fetch, so the first poll uses step 0.
      return pollDelayMs(query.state.dataUpdateCount - 1);
    },
  });
}

/**
 * Starts a generate job for a campaign. The key is made once per click and is reused only when the
 * previous request for the same campaign got no response (network error or timeout). After a
 * success, or any other error, the next click makes a new key. Same rule as the dashboard's
 * `useGenerateBrief`.
 */
export function useStartGeneration(api: ApiClient, workspaceId: string) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<{ campaignId: string; key: string } | null>(null);
  return useMutation({
    mutationFn: async (campaignId: string) => {
      const pending = pendingRef.current;
      const key =
        pending !== null && pending.campaignId === campaignId
          ? pending.key
          : newExtensionIdempotencyKey();
      pendingRef.current = { campaignId, key };
      try {
        const job = await api.jobs.generateBrief(workspaceId, { campaignId }, key);
        pendingRef.current = null;
        return job;
      } catch (error) {
        const noResponse =
          error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
        if (!noResponse) pendingRef.current = null;
        throw error;
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: panelKeys.generateJobs(workspaceId) });
    },
  });
}

/** Cancels a job. A queued job stops at once; a running one is asked to stop (the list keeps polling). */
export function useCancelGeneration(api: ApiClient, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.jobs.cancel(workspaceId, jobId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: panelKeys.generateJobs(workspaceId) });
    },
  });
}
