import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PutProviderSettingsRequest } from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';

export const settingsKeys = {
  provider: (workspaceId: string) => ['provider-settings', workspaceId] as const,
  usage: (workspaceId: string) => ['usage', workspaceId] as const,
};

export function useProviderSettings(workspaceId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: settingsKeys.provider(workspaceId),
    queryFn: () => client.providerSettings.get(workspaceId),
  });
}

export function useUsage(workspaceId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: settingsKeys.usage(workspaceId),
    queryFn: () => client.usage.get(workspaceId),
  });
}

export function useSaveProvider(workspaceId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PutProviderSettingsRequest) =>
      client.providerSettings.save(workspaceId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKeys.provider(workspaceId), saved);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.usage(workspaceId) });
    },
  });
}

export function useRemoveProvider(workspaceId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.providerSettings.remove(workspaceId),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKeys.provider(workspaceId), saved);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.usage(workspaceId) });
    },
  });
}

export function useCheckProvider(workspaceId: string) {
  const { client } = useDashboard();
  return useMutation({ mutationFn: () => client.providerSettings.check(workspaceId) });
}
