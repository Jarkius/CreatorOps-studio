import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { isNotFound, describeError } from '../errors.js';
import { draftKeys, useDraftList } from '../drafts/draftQueries.js';
import { draftPath } from '../drafts/paths.js';
import { formatDate } from '../products/format.js';
import { productPath } from '../products/paths.js';
import { NotFoundNotice } from '../products/ProductStates.js';
import { JobPanel } from '../jobs/JobPanel.js';
import { useGenerateBrief, useJobReader } from '../jobs/jobQueries.js';
import { Button, EmptyState, ErrorState, LoadingState, StatusPill } from '@creatorops/ui';
import { useCampaign } from './campaignQueries.js';
import { campaignsPath } from './paths.js';
import { useCanWrite } from './useCanWrite.js';

const PLATFORM_LABELS: Record<string, string> = {
  generic: 'Generic',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  shopee: 'Shopee',
};

const LANGUAGE_LABELS: Record<string, string> = { th: 'Thai', en: 'English' };

export function CampaignPage() {
  const { workspaceId = '', campaignId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const campaignQuery = useCampaign(workspaceId, campaignId);
  const canWrite = useCanWrite(workspaceId);
  const generate = useGenerateBrief(workspaceId);
  const drafts = useDraftList(workspaceId, campaignId);

  // The job shown is remembered in the URL (?job=) so a reload shows the same job again.
  const [jobId, setJobId] = useState<string | null>(searchParams.get('job'));
  const [generateError, setGenerateError] = useState<string | null>(null);
  const jobReader = useJobReader(workspaceId, jobId ?? '');
  const jobStatus = jobId === null ? undefined : jobReader.data?.status;
  const jobRunning = jobStatus === 'queued' || jobStatus === 'running';

  const handleFinished = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: draftKeys.list(workspaceId, campaignId) });
  }, [queryClient, workspaceId, campaignId]);

  const startGeneration = async () => {
    setGenerateError(null);
    try {
      const job = await generate.mutateAsync(campaignId);
      setJobId(job.id);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set('job', job.id);
          return next;
        },
        { replace: true },
      );
    } catch (error) {
      setGenerateError(describeError(error).message);
    }
  };

  const campaign = campaignQuery.data;
  if (campaign === undefined) {
    if (campaignQuery.isError && isNotFound(campaignQuery.error)) {
      return (
        <NotFoundNotice
          title="Campaign not found"
          description="This campaign does not exist in this workspace, or it was removed."
          backTo={campaignsPath(workspaceId)}
          backLabel="Back to campaigns"
        />
      );
    }
    if (campaignQuery.isError) {
      const { message, requestId } = describeError(campaignQuery.error);
      return (
        <ErrorState
          message={message}
          requestId={requestId}
          retrying={campaignQuery.isFetching}
          onRetry={() => void campaignQuery.refetch()}
        />
      );
    }
    return <LoadingState label="Loading campaign…" />;
  }

  const isArchived = campaign.status === 'archived';

  let draftsContent: ReactNode;
  if (drafts.data === undefined && drafts.isError) {
    const { message, requestId } = describeError(drafts.error);
    draftsContent = (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={drafts.isFetching}
        onRetry={() => void drafts.refetch()}
      />
    );
  } else if (drafts.data === undefined) {
    draftsContent = <LoadingState label="Loading drafts…" />;
  } else if (drafts.data.items.length === 0) {
    draftsContent = jobRunning ? null : (
      <EmptyState
        title="No drafts yet"
        description="Generate content to write a draft for each variant."
      />
    );
  } else {
    draftsContent = (
      <ul aria-label="Drafts" className="grid gap-3 sm:grid-cols-2">
        {drafts.data.items.map((draft) => (
          <li
            key={draft.id}
            className="space-y-2 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={draftPath(workspaceId, draft.id)}
                className="font-medium text-[var(--co-accent)] underline underline-offset-4"
              >
                Variant {draft.variantIndex + 1}
              </Link>
              <StatusPill status={draft.status} />
              {draft.needsReview ? (
                <span className="rounded-full border border-[var(--co-danger)] px-2 text-sm text-[var(--co-danger)]">
                  Needs review
                </span>
              ) : null}
            </div>
            <p className="leading-relaxed [overflow-wrap:anywhere]">{draft.sections.title}</p>
            <time dateTime={draft.updatedAt} className="text-sm text-[var(--co-text-muted)]">
              Updated {formatDate(draft.updatedAt)}
            </time>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <Link
          to={campaignsPath(workspaceId)}
          className="inline-flex min-h-11 items-center text-[var(--co-accent)] underline underline-offset-4"
        >
          Back to campaigns
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-2xl font-semibold leading-relaxed [overflow-wrap:anywhere]">
            {campaign.name}
          </h1>
          <StatusPill status={campaign.status} />
        </div>
      </header>

      <section aria-labelledby="settings-heading" className="space-y-3">
        <h2 id="settings-heading" className="text-base font-semibold">
          Settings
        </h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-[var(--co-text-muted)]">Product</dt>
            <dd>
              <Link
                to={productPath(workspaceId, campaign.productId)}
                className="text-[var(--co-accent)] underline underline-offset-4 [overflow-wrap:anywhere]"
              >
                {campaign.productId}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--co-text-muted)]">Template</dt>
            <dd>
              {campaign.templateId}, version {campaign.templateVersion}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--co-text-muted)]">Platform</dt>
            <dd>{PLATFORM_LABELS[campaign.platform] ?? campaign.platform}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--co-text-muted)]">Duration</dt>
            <dd>{campaign.durationSeconds} seconds</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--co-text-muted)]">Variants</dt>
            <dd>{campaign.variants}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--co-text-muted)]">Language</dt>
            <dd>{LANGUAGE_LABELS[campaign.language] ?? campaign.language}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--co-text-muted)]">Tone</dt>
            <dd className="[overflow-wrap:anywhere]">{campaign.tone ?? 'None'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="generate-heading" className="space-y-3">
        <h2 id="generate-heading" className="text-base font-semibold">
          Content
        </h2>
        {canWrite ? (
          isArchived ? (
            <Button disabled>Archived campaigns cannot be generated</Button>
          ) : (
            <Button
              loading={generate.isPending}
              disabled={jobRunning}
              onClick={() => void startGeneration()}
            >
              {generate.isPending ? 'Starting…' : 'Generate content'}
            </Button>
          )
        ) : null}
        {generateError === null ? null : (
          <p role="alert" className="text-[var(--co-danger)]">
            {generateError}
          </p>
        )}
        {jobId === null ? null : (
          <JobPanel
            key={jobId}
            workspaceId={workspaceId}
            jobId={jobId}
            onFinished={handleFinished}
            onRetry={() => void startGeneration()}
          />
        )}
      </section>

      <section aria-labelledby="drafts-heading" className="space-y-3">
        <h2 id="drafts-heading" className="text-base font-semibold">
          Drafts
        </h2>
        {jobRunning ? (
          <div className="space-y-3">
            <p className="text-[var(--co-text-muted)]">Your drafts will appear here</p>
            <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2">
              <div className="h-24 animate-pulse rounded-lg bg-[var(--co-border)]" />
              <div className="h-24 animate-pulse rounded-lg bg-[var(--co-border)]" />
            </div>
          </div>
        ) : null}
        {draftsContent}
      </section>
    </div>
  );
}
