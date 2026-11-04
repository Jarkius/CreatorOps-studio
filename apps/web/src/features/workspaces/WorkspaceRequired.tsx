import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { EmptyState, buttonClassName } from '@creatorops/ui';

import { useWorkspaces } from './useWorkspaces.js';

export const NEW_WORKSPACE_PATH = '/workspaces/new';

/**
 * Shows the create prompt instead of the page when the signed-in user has no workspace at all.
 * While the list is still loading, or if it failed, the page renders as before and shows its own
 * loading or error state.
 */
export function WorkspaceRequired({ children }: { children: ReactNode }) {
  const workspaces = useWorkspaces();
  if (workspaces.data !== undefined && workspaces.data.length === 0) return <NoWorkspaces />;
  return children;
}

export function NoWorkspaces() {
  return (
    <EmptyState
      title="You have no workspaces yet"
      description="Create a workspace to hold your products, assets and drafts."
      action={
        <Link to={NEW_WORKSPACE_PATH} className={buttonClassName('primary')}>
          Create workspace
        </Link>
      }
    />
  );
}
