import { useQuery } from '@tanstack/react-query';

import type { Workspace } from '@creatorops/contracts';

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
