import { useParams } from 'react-router';

import { ErrorState, LoadingState } from '@creatorops/ui';

import { describeError } from '../errors.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { ProviderPanel } from './ProviderPanel.js';
import { useProviderSettings } from './settingsQueries.js';
import { UsagePanel } from './UsagePanel.js';

/** Provider settings (owner or admin) and this month's usage. */
export function SettingsPage() {
  const { workspaceId = '' } = useParams();
  const settings = useProviderSettings(workspaceId);
  const workspaces = useWorkspaces();
  const role = workspaces.data?.find((workspace) => workspace.id === workspaceId)?.role;
  const canManage = role === 'owner' || role === 'admin';

  let provider;
  if (settings.data !== undefined) {
    provider = (
      <ProviderPanel workspaceId={workspaceId} settings={settings.data} canManage={canManage} />
    );
  } else if (settings.isError) {
    const { message, requestId } = describeError(settings.error);
    provider = (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={settings.isFetching}
        onRetry={() => void settings.refetch()}
      />
    );
  } else {
    provider = <LoadingState label="Loading settings…" />;
  }

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold leading-relaxed">Settings</h1>
      </header>
      <section aria-labelledby="provider-heading" className="space-y-3">
        <h2 id="provider-heading" className="text-base font-semibold">
          Text provider
        </h2>
        {provider}
      </section>
      <section aria-labelledby="usage-heading" className="space-y-3">
        <h2 id="usage-heading" className="text-base font-semibold">
          Usage this month
        </h2>
        <UsagePanel workspaceId={workspaceId} />
      </section>
    </div>
  );
}
