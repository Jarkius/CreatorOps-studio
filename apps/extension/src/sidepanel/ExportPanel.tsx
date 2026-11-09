import { ApiError, isTerminalJobStatus, type ApiClient, type Draft } from '@creatorops/contracts';
import { Button } from '@creatorops/ui';
import { useEffect, useRef, useState } from 'react';

import {
  useDownloadLink,
  useExportJob,
  useLatestExport,
  useRefreshLatest,
  useStartExport,
} from './exportHooks.js';

/** Opens a signed download link. Replaced in tests; the panel uses a new browser tab. */
export type OpenUrl = (url: string) => void;
const openInTab: OpenUrl = (url) => {
  window.open(url, '_blank', 'noopener');
};

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';

/** Builds the ZIP package of the draft (text, checklist, attached files) and downloads it. */
export function ExportPanel({
  api,
  workspaceId,
  draft,
  canStart,
  openUrl = openInTab,
}: {
  api: ApiClient;
  workspaceId: string;
  draft: Draft;
  canStart: boolean;
  openUrl?: OpenUrl;
}) {
  const latest = useLatestExport(api, workspaceId, draft.id);
  const start = useStartExport(api, workspaceId);
  const link = useDownloadLink(api, workspaceId);
  const refresh = useRefreshLatest(workspaceId, draft.id);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useExportJob(api, workspaceId, jobId).data;
  const refreshed = useRef<string | null>(null);

  useEffect(() => {
    if (job !== undefined && isTerminalJobStatus(job.status) && refreshed.current !== job.id) {
      refreshed.current = job.id;
      void refresh();
    }
  });

  const busy = start.isPending || (job !== undefined && !isTerminalJobStatus(job.status));
  const onExport = async () => {
    setError(null);
    try {
      const created = await start.mutateAsync({ draftId: draft.id, draftVersion: draft.version });
      setJobId(created.id);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === 'CONFLICT'
          ? 'This draft changed. Close and reopen the scenes, then export again.'
          : messageOf(failure),
      );
    }
  };
  const onDownload = async (exportId: string) => {
    setError(null);
    try {
      openUrl(await link.mutateAsync(exportId));
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  const ready = latest.data?.status === 'ready' ? latest.data : null;
  return (
    <section
      aria-label="Export package"
      className="space-y-2 rounded-md border border-[var(--co-border)] p-3"
    >
      <h3 className="text-sm font-medium">Export package</h3>
      <p className="text-sm text-[var(--co-text-muted)]">
        A ZIP with the text, the checklist and the files attached to this draft. Posting stays
        manual.
      </p>
      {canStart ? (
        <Button disabled={busy} loading={start.isPending} onClick={() => void onExport()}>
          Export ZIP package
        </Button>
      ) : null}
      {job === undefined ? null : (
        <p
          role={job.status === 'failed' || job.status === 'cancelled' ? 'alert' : 'status'}
          className="text-sm"
        >
          {job.status === 'succeeded'
            ? 'Package ready'
            : job.status === 'failed'
              ? (job.errorMessage ?? 'The export failed.')
              : job.status === 'cancelled'
                ? 'Cancelled'
                : 'Building the package…'}
        </p>
      )}
      {ready === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm [overflow-wrap:anywhere]">{ready.filename}</span>
          <Button
            variant="secondary"
            loading={link.isPending}
            onClick={() => void onDownload(ready.id)}
          >
            Download ZIP
          </Button>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-[var(--co-danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
