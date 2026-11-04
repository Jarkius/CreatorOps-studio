import { useWorkspaces } from '../workspaces/useWorkspaces.js';

/** True when the signed-in user may create campaigns and start jobs in this workspace. */
export function useCanWrite(workspaceId: string): boolean {
  const workspaces = useWorkspaces();
  const role = workspaces.data?.find((workspace) => workspace.id === workspaceId)?.role;
  return role === 'owner' || role === 'admin' || role === 'editor';
}
