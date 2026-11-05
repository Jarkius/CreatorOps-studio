import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { ApiError, type CreateExportRequest, type Job } from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';
import { newIdempotencyKey } from '../jobs/idempotency.js';

/** Query keys. Every key starts with the workspace id so one invalidation refreshes them all. */
export const exportKeys = {
  assets: (workspaceId: string, draftId: string) => ['draft-assets', workspaceId, draftId] as const,
  list: (workspaceId: string, draftId: string) => ['exports', workspaceId, draftId] as const,
};

/** The files attached to a draft, in package order (signed thumbnail URLs included). */
export function useDraftAssets(workspaceId: string, draftId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: exportKeys.assets(workspaceId, draftId),
    queryFn: () => client.drafts.listAssets(workspaceId, draftId),
    // Signed URLs live 15 minutes; refetch before they stop working.
    staleTime: 5 * 60 * 1000,
  });
}

export function useDraftExports(workspaceId: string, draftId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: exportKeys.list(workspaceId, draftId),
    queryFn: () => client.exports.list(workspaceId, { draftId, limit: 10 }),
  });
}

interface PendingKey {
  request: CreateExportRequest;
  key: string;
}

/**
 * Starts an export job. The key is made once per user action and reused only after a failure
 * without a response, for the same draft and version (same rules as the generate button).
 */
export function useStartExport(workspaceId: string) {
  const { client } = useDashboard();
  const pendingRef = useRef<PendingKey | null>(null);
  return useMutation({
    mutationFn: async (request: CreateExportRequest): Promise<Job> => {
      const pending = pendingRef.current;
      const same =
        pending !== null &&
        pending.request.draftId === request.draftId &&
        pending.request.draftVersion === request.draftVersion;
      const key = same ? pending.key : newIdempotencyKey();
      pendingRef.current = { request, key };
      try {
        const job = await client.jobs.exportPackage(workspaceId, request, key);
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

/** Asks for a five-minute signed link and returns its absolute URL. */
export function useDownloadLink(workspaceId: string) {
  const { client } = useDashboard();
  return useMutation({
    mutationFn: async (exportId: string): Promise<string> => {
      const link = await client.exports.downloadUrl(workspaceId, exportId);
      return client.resolveUrl(link.url);
    },
  });
}

export function useRefreshExports(workspaceId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['exports', workspaceId] });
}
