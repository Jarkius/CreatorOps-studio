import { useQuery } from '@tanstack/react-query';

import { useDashboard } from '../../app/dashboard-context.js';

/** Query keys. Every draft key starts with ['drafts', workspaceId]. */
export const draftKeys = {
  all: (workspaceId: string) => ['drafts', workspaceId] as const,
  list: (workspaceId: string, campaignId: string) =>
    ['drafts', workspaceId, 'list', campaignId] as const,
};

export function useDraftList(workspaceId: string, campaignId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: draftKeys.list(workspaceId, campaignId),
    queryFn: () => client.drafts.list(workspaceId, { campaignId, limit: 100 }),
  });
}
