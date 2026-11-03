import { ApiError } from '@creatorops/contracts';
import { EmptyState, ErrorState, LoadingState } from '@creatorops/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { API_BASE_URL, DASHBOARD_URL, MOCK_AUTH } from './config.js';
import { ProductsPanel } from './ProductsPanel.js';
import { createSessionClient, type SessionClient } from './session.js';
import { createDefaultTokenStore } from './token-store.js';

export interface AppProps {
  /** Injected in tests; defaults to a client built from the build-time configuration. */
  readonly session?: SessionClient;
}

/**
 * The side panel is a thin client (D-019): it shows who is signed in and links to the full
 * dashboard. It holds no business logic, no provider keys, and no long-running work.
 */
export function App({ session }: AppProps) {
  const client = useMemo<SessionClient>(
    () =>
      session ??
      createSessionClient({
        baseUrl: API_BASE_URL,
        store: createDefaultTokenStore(),
        mockAuth: MOCK_AUTH,
      }),
    [session],
  );

  const me = useQuery({ queryKey: ['me'], queryFn: () => client.loadMe() });
  const error = me.error instanceof ApiError ? me.error : null;
  // Kept in component state only: the choice is not persisted anywhere.
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const workspaces = me.data?.workspaces ?? [];
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">CreatorOps Studio</h1>
        <a
          href={DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-md border border-[var(--co-border)] px-3 py-2 text-sm underline"
        >
          Open dashboard
        </a>
      </header>

      <main className="flex-1">
        {me.isPending ? <LoadingState label="Loading your workspace…" /> : null}

        {me.isError ? (
          <ErrorState
            message={error?.message ?? 'Something went wrong. Please try again.'}
            {...(error?.requestId ? { requestId: error.requestId } : {})}
            onRetry={() => void me.refetch()}
            retrying={me.isFetching}
          />
        ) : null}

        {me.isSuccess ? (
          <section
            aria-label="Signed in"
            className="rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4"
          >
            <p className="font-medium [overflow-wrap:anywhere]">{me.data.user.displayName}</p>
            <p className="text-sm text-[var(--co-text-muted)] [overflow-wrap:anywhere]">
              {me.data.user.email}
            </p>
            {workspaces.length === 0 ? (
              <EmptyState
                title="No workspaces yet"
                description="Create a workspace in the dashboard to get started."
              />
            ) : (
              <>
                <ul className="mt-3 space-y-1">
                  {workspaces.map((workspace) => (
                    <li
                      key={workspace.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="[overflow-wrap:anywhere]">{workspace.name}</span>
                      <span className="text-[var(--co-text-muted)]">{workspace.role}</span>
                    </li>
                  ))}
                </ul>
                {workspaces.length > 1 && activeWorkspace ? (
                  <select
                    aria-label="Workspace"
                    value={activeWorkspace.id}
                    onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                    className="mt-3 min-h-11 w-full min-w-0 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] px-2 text-sm [overflow-wrap:anywhere]"
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {me.isSuccess && activeWorkspace ? (
          <div className="mt-4">
            <ProductsPanel
              api={client.api}
              workspaceId={activeWorkspace.id}
              dashboardUrl={DASHBOARD_URL}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
