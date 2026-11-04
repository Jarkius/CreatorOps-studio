import { useCallback } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { UpdateDraftRequest } from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';

/** Query keys. Every draft key starts with ['drafts', workspaceId]. */
export const draftKeys = {
  all: (workspaceId: string) => ['drafts', workspaceId] as const,
  lists: (workspaceId: string) => ['drafts', workspaceId, 'list'] as const,
  list: (workspaceId: string, campaignId: string) =>
    ['drafts', workspaceId, 'list', campaignId] as const,
  detail: (workspaceId: string, draftId: string) =>
    ['drafts', workspaceId, 'detail', draftId] as const,
};

export function useDraftList(workspaceId: string, campaignId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: draftKeys.list(workspaceId, campaignId),
    queryFn: () => client.drafts.list(workspaceId, { campaignId, limit: 100 }),
  });
}

export function useDraft(workspaceId: string, draftId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: draftKeys.detail(workspaceId, draftId),
    queryFn: () => client.drafts.get(workspaceId, draftId),
  });
}

/**
 * Saves a versioned PATCH. The returned draft replaces the detail cache; the draft lists of the
 * workspace are marked stale so the campaign page shows the new status and title.
 */
export function useUpdateDraft(workspaceId: string, draftId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDraftRequest) => client.drafts.update(workspaceId, draftId, body),
    onSuccess: (draft) => {
      queryClient.setQueryData(draftKeys.detail(workspaceId, draftId), draft);
      void queryClient.invalidateQueries({ queryKey: draftKeys.lists(workspaceId) });
    },
  });
}

/** Reloads the draft the screen shows (and the draft lists). Resolves when the reload finished. */
export function useRefreshDraft(workspaceId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: draftKeys.all(workspaceId) }),
    [queryClient, workspaceId],
  );
}
