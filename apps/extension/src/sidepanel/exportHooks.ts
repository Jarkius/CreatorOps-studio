import { ApiError, isTerminalJobStatus, pollDelayMs, type ApiClient } from '@creatorops/contracts';
import type { Job } from '@creatorops/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

export const exportKeys = {
  latest: (workspaceId: string, draftId: string) =>
    ['panel', 'export', 'latest', workspaceId, draftId] as const,
  job: (workspaceId: string, jobId: string) =>
    ['panel', 'export', 'job', workspaceId, jobId] as const,
};

const newKey = (): string => `ext-${crypto.randomUUID()}`;

/** The newest package of the draft, if any. */
export function useLatestExport(api: ApiClient, workspaceId: string, draftId: string) {
  return useQuery({
    queryKey: exportKeys.latest(workspaceId, draftId),
    queryFn: async () => {
      const page = await api.exports.list(workspaceId, { draftId, limit: 1 });
      return page.items[0] ?? null;
    },
  });
}

/** Polls the export job with the shared steps until it ends. The API is the only source of state. */
export function useExportJob(api: ApiClient, workspaceId: string, jobId: string | null) {
  return useQuery<Job>({
    queryKey: exportKeys.job(workspaceId, jobId ?? ''),
    queryFn: () => api.jobs.get(workspaceId, jobId ?? ''),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (job !== undefined && isTerminalJobStatus(job.status)) return false;
      return pollDelayMs(query.state.dataUpdateCount - 1);
    },
  });
}

/** Same key rule as Generate: reused only after a failure without a response, per draft and version. */
export function useStartExport(api: ApiClient, workspaceId: string) {
  const pending = useRef<{ draftId: string; draftVersion: number; key: string } | null>(null);
  return useMutation({
    mutationFn: async (request: { draftId: string; draftVersion: number }) => {
      const before = pending.current;
      const key =
        before !== null &&
        before.draftId === request.draftId &&
        before.draftVersion === request.draftVersion
          ? before.key
          : newKey();
      pending.current = { ...request, key };
      try {
        const job = await api.jobs.exportPackage(workspaceId, request, key);
        pending.current = null;
        return job;
      } catch (error) {
        const noResponse =
          error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
        if (!noResponse) pending.current = null;
        throw error;
      }
    },
  });
}

/** A fresh five-minute link, resolved against the API origin. */
export function useDownloadLink(api: ApiClient, workspaceId: string) {
  return useMutation({
    mutationFn: async (exportId: string) => {
      const link = await api.exports.downloadUrl(workspaceId, exportId);
      return api.resolveUrl(link.url);
    },
  });
}

export function useRefreshLatest(workspaceId: string, draftId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: exportKeys.latest(workspaceId, draftId) });
}
