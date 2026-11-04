import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@creatorops/contracts';
import type { WorkspaceRoleValue } from '@creatorops/contracts';
import { EmptyState, ErrorState, LoadingState, buttonClassName } from '@creatorops/ui';
import { Link } from 'react-router';

import { SignInUnavailableError } from '../../api/session.js';
import { useDashboard } from '../../app/dashboard-context.js';
import { NEW_WORKSPACE_PATH } from '../workspaces/WorkspaceRequired.js';

const ROLE_LABELS: Record<WorkspaceRoleValue, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};

const GENERIC_ERROR = 'Something went wrong while loading the overview. Please try again.';

function describeError(error: unknown): { message: string; requestId: string | undefined } {
  if (error instanceof ApiError) return { message: error.message, requestId: error.requestId };
  return { message: GENERIC_ERROR, requestId: undefined };
}

export function OverviewPage() {
  const { client, session } = useDashboard();
  const ready = session.status === 'ready';

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => client.health(),
    enabled: ready,
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => client.me(),
    enabled: ready,
  });

  if (session.status === 'loading') return <LoadingState label="Signing in…" />;

  if (session.status === 'error') {
    if (session.error instanceof SignInUnavailableError) {
      return (
        <ErrorState
          title="Sign-in is not configured yet"
          message="Production sign-in is not available in this build. Development builds use VITE_AUTH_MODE=mock."
        />
      );
    }
    const { message, requestId } = describeError(session.error);
    return <ErrorState message={message} requestId={requestId} onRetry={session.retry} />;
  }

  if (health.error !== null || me.error !== null) {
    const { message, requestId } = describeError(health.error ?? me.error);
    return (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={health.isFetching || me.isFetching}
        onRetry={() => {
          void health.refetch();
          void me.refetch();
        }}
      />
    );
  }

  const healthData = health.data;
  const meData = me.data;
  if (healthData === undefined || meData === undefined) {
    return <LoadingState label="Loading overview…" />;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold leading-relaxed">Overview</h1>
        <p className="mt-1 text-[var(--co-text-muted)]">API status: {healthData.status}</p>
      </header>

      <section
        aria-labelledby="account-heading"
        className="rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-5"
      >
        <h2 id="account-heading" className="text-base font-semibold leading-relaxed">
          Signed in as
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-[var(--co-text-muted)]">Name</dt>
          <dd className="font-medium leading-relaxed">{meData.user.displayName}</dd>
          <dt className="text-[var(--co-text-muted)]">Email</dt>
          <dd className="leading-relaxed [overflow-wrap:anywhere]">{meData.user.email}</dd>
        </dl>
      </section>

      <section aria-labelledby="workspaces-heading">
        <h2 id="workspaces-heading" className="text-base font-semibold leading-relaxed">
          Workspaces
        </h2>
        {meData.workspaces.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="You have no workspaces yet"
              description="Create a workspace to hold your products, assets and drafts."
              action={
                <Link to={NEW_WORKSPACE_PATH} className={buttonClassName('primary')}>
                  Create workspace
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--co-border)] rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)]">
            {meData.workspaces.map((workspace) => (
              <li
                key={workspace.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 leading-relaxed"
              >
                <span className="font-medium">{workspace.name}</span>
                <span className="rounded-full border border-[var(--co-border)] px-2.5 py-0.5 text-sm text-[var(--co-text-muted)]">
                  {ROLE_LABELS[workspace.role]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
