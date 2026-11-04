import { ApiError, type ApiClient, type CampaignListItem, type Job } from '@creatorops/contracts';
import { Button, EmptyState, ErrorState, LoadingState, StatusPill } from '@creatorops/ui';
import type { ReactNode } from 'react';

import { useCancelGeneration, usePanelCampaigns, useStartGeneration } from './campaignHooks.js';
import {
  dashboardCampaignPath,
  dashboardCampaignsPath,
  dashboardNewCampaignPath,
  jobStatusText,
} from './campaigns.js';
import { dashboardHref } from './format.js';

export interface CampaignsPanelProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly dashboardUrl: string;
  /** Owner, admin and editor only; the API still enforces it. */
  readonly canStart: boolean;
}

/**
 * The campaigns of the active workspace, with a Generate action and the status of each campaign's
 * latest generate job. The panel only starts and watches jobs; drafts are edited in the dashboard.
 * Everything shown comes from the API, so reopening the panel shows the same state.
 */
export function CampaignsPanel({ api, workspaceId, dashboardUrl, canStart }: CampaignsPanelProps) {
  const campaigns = usePanelCampaigns(api, workspaceId);
  const start = useStartGeneration(api, workspaceId);
  const cancel = useCancelGeneration(api, workspaceId);

  const visible = (campaigns.data?.items ?? []).filter(
    (campaign) => campaign.status !== 'archived',
  );
  const campaignsError = campaigns.error instanceof ApiError ? campaigns.error : null;

  return (
    <section
      aria-labelledby="campaigns-heading"
      className="rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4"
    >
      <h2 id="campaigns-heading" className="text-base font-semibold">
        Campaigns
      </h2>

      {campaigns.isPending ? <LoadingState label="Loading campaigns…" /> : null}

      {campaigns.isError ? (
        <div className="mt-3">
          <ErrorState
            message={campaignsError?.message ?? 'Something went wrong. Please try again.'}
            {...(campaignsError?.requestId ? { requestId: campaignsError.requestId } : {})}
            onRetry={() => void campaigns.refetch()}
            retrying={campaigns.isFetching}
          />
        </div>
      ) : null}

      {campaigns.isSuccess && visible.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No campaigns yet"
            description="Create a campaign in the dashboard, then generate its drafts here."
            action={
              <ActionLink href={dashboardHref(dashboardUrl, dashboardNewCampaignPath(workspaceId))}>
                Create campaign
              </ActionLink>
            }
          />
        </div>
      ) : null}

      {campaigns.isSuccess && visible.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {visible.map((campaign) => (
            <CampaignRow
              key={campaign.id}
              campaign={campaign}
              job={campaign.latestGenerateJob}
              canStart={canStart}
              starting={start.isPending && start.variables === campaign.id}
              startError={start.isError && start.variables === campaign.id ? start.error : null}
              onStart={() => start.mutate(campaign.id)}
              cancelling={cancel.isPending && cancel.variables === campaign.latestGenerateJob?.id}
              cancelError={
                cancel.isError && cancel.variables === campaign.latestGenerateJob?.id
                  ? cancel.error
                  : null
              }
              onCancel={(job) => cancel.mutate(job.id)}
              campaignHref={dashboardHref(
                dashboardUrl,
                dashboardCampaignPath(workspaceId, campaign.id),
              )}
            />
          ))}
        </ul>
      ) : null}

      {campaigns.isSuccess ? (
        <footer className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {visible.length > 0 ? (
            <ActionLink href={dashboardHref(dashboardUrl, dashboardNewCampaignPath(workspaceId))}>
              Create campaign
            </ActionLink>
          ) : null}
          <ActionLink href={dashboardHref(dashboardUrl, dashboardCampaignsPath(workspaceId))}>
            View all campaigns
          </ActionLink>
        </footer>
      ) : null}
    </section>
  );
}

interface CampaignRowProps {
  campaign: CampaignListItem;
  job: Job | null;
  canStart: boolean;
  starting: boolean;
  startError: unknown;
  onStart: () => void;
  cancelling: boolean;
  cancelError: unknown;
  onCancel: (job: Job) => void;
  campaignHref: string;
}

function CampaignRow({
  campaign,
  job,
  canStart,
  starting,
  startError,
  onStart,
  cancelling,
  cancelError,
  onCancel,
  campaignHref,
}: CampaignRowProps) {
  const active = job !== null && (job.status === 'queued' || job.status === 'running');
  const retry = job !== null && (job.status === 'failed' || job.status === 'cancelled');
  const label = starting ? 'Starting…' : active ? 'Generating…' : retry ? 'Try again' : 'Generate';

  return (
    <li className="min-w-0 rounded-md border border-[var(--co-border)] p-3">
      <p className="font-medium [overflow-wrap:anywhere]">{campaign.name}</p>
      <p className="mt-1 text-sm text-[var(--co-text-muted)] [overflow-wrap:anywhere]">
        {campaign.platform}
      </p>

      {job === null ? null : (
        <div className="mt-2 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={job.status} />
            <p className="min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]">
              {jobStatusText(job)}
            </p>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {canStart ? (
          <Button
            variant="secondary"
            aria-label={`${label} ${campaign.name}`}
            loading={starting}
            disabled={starting || active}
            onClick={onStart}
          >
            {label}
          </Button>
        ) : null}
        {canStart && active && job !== null ? (
          <Button
            variant="secondary"
            aria-label={`Cancel generation for ${campaign.name}`}
            loading={cancelling}
            disabled={cancelling}
            onClick={() => onCancel(job)}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : null}
        <ActionLink href={campaignHref} label={`Open ${campaign.name} in the dashboard`}>
          Open
        </ActionLink>
      </div>

      {startError === null || startError === undefined ? null : <RowError error={startError} />}
      {cancelError === null || cancelError === undefined ? null : <RowError error={cancelError} />}
    </li>
  );
}

/** A short error under one row, using the API's safe message and request id when there are any. */
function RowError({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null;
  return (
    <p role="alert" className="mt-2 text-sm text-[var(--co-danger)] [overflow-wrap:anywhere]">
      {apiError?.message ?? 'Something went wrong. Please try again.'}
      {apiError?.requestId ? ` (request ${apiError.requestId})` : null}
    </p>
  );
}

/** A link into the dashboard; it opens in a new tab without giving the page access to the panel. */
function ActionLink({
  href,
  label,
  children,
}: {
  href: string;
  /** Accessible name when the visible text alone is not enough. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      {...(label === undefined ? {} : { 'aria-label': label })}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center py-2 text-sm underline [overflow-wrap:anywhere]"
    >
      {children}
    </a>
  );
}
