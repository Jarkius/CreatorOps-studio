import {
  ApiError,
  isTerminalJobStatus,
  pollDelayMs,
  type ApiClient,
  type Job,
} from '@creatorops/contracts';
import { ErrorState, StatusPill } from '@creatorops/ui';
import { useQuery } from '@tanstack/react-query';

import { jobStatusText } from './campaigns.js';
import type { HelperDeps } from './metaai/useMetaAi.js';
import { ScenesPanel } from './ScenesPanel.js';

export interface FullAutoRunProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly jobId: string;
  readonly helper?: HelperDeps;
}

/**
 * Full Auto after "Create content" (D-073): follows the script job and, once it has succeeded,
 * makes the scene images in Meta AI one after another (the scene list starts them by itself,
 * once). The script job is the one already shown under Campaigns; this only reads it.
 */
export function FullAutoRun({ api, workspaceId, campaignId, jobId, helper }: FullAutoRunProps) {
  const job = useQuery({
    queryKey: ['panel', 'fullauto', 'job', workspaceId, jobId],
    queryFn: () => api.jobs.get(workspaceId, jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? 'queued';
      return isTerminalJobStatus(status) ? false : pollDelayMs(query.state.dataUpdateCount - 1);
    },
  });
  const error = job.error instanceof ApiError ? job.error : null;
  const current: Job | undefined = job.data;

  return (
    <section
      aria-label="Full Auto"
      className="mt-4 rounded-md border border-[var(--co-border)] p-3 text-sm"
    >
      <h3 className="font-semibold">Full Auto</h3>
      {job.isError ? (
        <div className="mt-2">
          <ErrorState
            message={error?.message ?? 'Something went wrong. Please try again.'}
            {...(error?.requestId ? { requestId: error.requestId } : {})}
            onRetry={() => void job.refetch()}
            retrying={job.isFetching}
          />
        </div>
      ) : null}
      {current !== undefined && current.status !== 'succeeded' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill status={current.status} />
          <p className="min-w-0 [overflow-wrap:anywhere]">
            {current.status === 'failed' || current.status === 'cancelled'
              ? `${jobStatusText(current)} The scene images were not started.`
              : `Step 1 of 2: ${jobStatusText(current)}`}
          </p>
        </div>
      ) : null}
      {current?.status === 'succeeded' ? (
        <div className="mt-2">
          <p className="font-medium">Step 2 of 2: scene images in Meta AI</p>
          <div className="mt-2">
            <ScenesPanel
              api={api}
              workspaceId={workspaceId}
              campaignId={campaignId}
              canStart
              autoRun
              {...(helper === undefined ? {} : { helper })}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
