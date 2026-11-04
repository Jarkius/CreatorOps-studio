import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateCampaignRequest } from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';

export const PAGE_SIZE = 25;

/** Query keys. Every campaign key starts with ['campaigns', workspaceId] so one prefix clears them. */
export const campaignKeys = {
  lists: (workspaceId: string) => ['campaigns', workspaceId, 'list'] as const,
  detail: (workspaceId: string, campaignId: string) =>
    ['campaigns', workspaceId, 'detail', campaignId] as const,
};

export function useCampaignList(workspaceId: string) {
  const { client } = useDashboard();
  return useInfiniteQuery({
    queryKey: campaignKeys.lists(workspaceId),
    queryFn: ({ pageParam }) =>
      client.campaigns.list(workspaceId, { limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCampaign(workspaceId: string, campaignId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: campaignKeys.detail(workspaceId, campaignId),
    queryFn: () => client.campaigns.get(workspaceId, campaignId),
  });
}

export function useTemplates(workspaceId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: ['templates', workspaceId],
    queryFn: () => client.templates.list(workspaceId),
  });
}

/** Active products for the campaign form's product select (first page only). */
export function useActiveProductOptions(workspaceId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: ['products', workspaceId, 'options'],
    queryFn: () => client.products.list(workspaceId, { status: 'active', limit: 100 }),
  });
}

export function useCreateCampaign(workspaceId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCampaignRequest) => client.campaigns.create(workspaceId, body),
    onSuccess: (campaign) => {
      queryClient.setQueryData(campaignKeys.detail(workspaceId, campaign.id), campaign);
      void queryClient.invalidateQueries({ queryKey: campaignKeys.lists(workspaceId) });
    },
  });
}
