import type { ApiClient } from '@creatorops/contracts';
import { useQuery } from '@tanstack/react-query';

export const sceneKeys = {
  draft: (workspaceId: string, campaignId: string) =>
    ['panel', 'scenes', 'draft', workspaceId, campaignId] as const,
  assets: (workspaceId: string, draftId: string) =>
    ['panel', 'scenes', 'assets', workspaceId, draftId] as const,
};

/** The first draft of a campaign (variants is 1 in the quick flow). Read only when opened. */
export function useCampaignDraft(api: ApiClient, workspaceId: string, campaignId: string) {
  return useQuery({
    queryKey: sceneKeys.draft(workspaceId, campaignId),
    queryFn: async () => {
      const page = await api.drafts.list(workspaceId, { campaignId, limit: 1 });
      return page.items[0] ?? null;
    },
  });
}

/** The files already attached to the draft, so a scene can say whether it has one. */
export function useDraftAssets(api: ApiClient, workspaceId: string, draftId: string) {
  return useQuery({
    queryKey: sceneKeys.assets(workspaceId, draftId),
    queryFn: () => api.drafts.listAssets(workspaceId, draftId),
  });
}
