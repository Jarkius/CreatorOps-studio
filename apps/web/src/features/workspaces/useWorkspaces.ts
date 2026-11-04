import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateWorkspaceRequest, Workspace } from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';

/** The signed-in user's workspaces, in the order the API returns them. */
export function useWorkspaces() {
  const { client, session } = useDashboard();
  return useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: async () => (await client.workspaces.list()).items,
    enabled: session.status === 'ready',
  });
}

/** Creates a workspace. Resolves after the workspace list (and the account summary) is refreshed. */
export function useCreateWorkspace() {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) => client.workspaces.create(body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
    },
  });
}
