import { useEffect, useRef, useState } from 'react';

import { ApiError } from '@creatorops/contracts';
import type { Draft } from '@creatorops/contracts';
import { Button, LoadingState } from '@creatorops/ui';

import { useDashboard } from '../../app/dashboard-context.js';
import { describeError } from '../errors.js';
import { isTerminalJobStatus, useJob } from '../jobs/jobQueries.js';
import { formatDate } from '../products/format.js';
import { copyText } from './copyText.js';
import {
  useDownloadLink,
  useDraftAssets,
  useDraftExports,
  useRefreshExports,
  useStartExport,
} from './exportQueries.js';
import {
  approvalNote,
  captionForPost,
  exportJobText,
  formatSize,
  isDownloadable,
} from './exportText.js';
import { startDownload } from './startDownload.js';

const SCENE_LABELS: Record<string, string> = {
  product_hero: 'Product hero',
  detail: 'Detail',
  usage: 'Usage',
  final_shot: 'Final shot',
};

export const EXPORT_CONFLICT_MESSAGE =
  'This draft changed while you were looking at it. Reload it, then export again.';

/** Results of a draft: its files with thumbnails, copy caption, and the ZIP package (D-067). */
export function DraftResults({
  workspaceId,
  draft,
  canWrite,
}: {
  workspaceId: string;
  draft: Draft;
  canWrite: boolean;
}) {
  return (
    <section aria-labelledby="results-heading" className="space-y-6">
      <h2 id="results-heading" className="text-base font-semibold">
        Results and export
      </h2>
      <Files workspaceId={workspaceId} draftId={draft.id} />
      <CaptionCopy draft={draft} />
      <ExportPackage workspaceId={workspaceId} draft={draft} canWrite={canWrite} />
    </section>
  );
}

function Files({ workspaceId, draftId }: { workspaceId: string; draftId: string }) {
  const { client } = useDashboard();
  const query = useDraftAssets(workspaceId, draftId);
  if (query.isPending) return <LoadingState label="Loading files…" />;
  if (query.isError) {
    return (
      <p role="alert" className="text-[var(--co-danger)]">
        Could not load the files: {describeError(query.error).message}
      </p>
    );
  }
  const items = query.data.items;
  if (items.length === 0) {
    return (
      <p className="leading-relaxed text-[var(--co-text-muted)]">
        No files are attached to this draft yet. Attach images from the side panel (Scenes) and they
        appear here and in the package.
      </p>
    );
  }
  return (
    <ul aria-label="Attached files" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <li
          key={item.assetId}
          className="space-y-1 rounded-lg border border-[var(--co-border)] p-2 text-sm"
        >
          {item.asset.thumbUrl === null ? (
            <div className="flex aspect-square items-center justify-center rounded-md bg-[var(--co-surface)] text-[var(--co-text-muted)]">
              {item.asset.type === 'video' ? 'Video' : 'No preview'}
            </div>
          ) : (
            <img
              src={client.resolveUrl(item.asset.thumbUrl)}
              alt={item.asset.originalFilename}
              className="aspect-square w-full rounded-md object-cover"
            />
          )}
          <p className="font-medium">
            {item.role === 'cover' ? 'Cover' : (SCENE_LABELS[item.scene ?? ''] ?? 'File')}
          </p>
          {item.aiGenerated ? (
            <p className="text-[var(--co-text-muted)]">
              AI-made{item.generator === null ? '' : ` with ${item.generator}`}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CaptionCopy({ draft }: { draft: Draft }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        onClick={() => {
          void copyText(captionForPost(draft.sections)).then((ok) =>
            setState(ok ? 'copied' : 'failed'),
          );
        }}
      >
        Copy caption and hashtags
      </Button>
      {state === 'copied' ? <p role="status">Copied</p> : null}
      {state === 'failed' ? (
        <p role="alert" className="text-[var(--co-danger)]">
          Copy failed. Select the caption text and copy it manually.
        </p>
      ) : null}
    </div>
  );
}

function ExportPackage({
  workspaceId,
  draft,
  canWrite,
}: {
  workspaceId: string;
  draft: Draft;
  canWrite: boolean;
}) {
  const start = useStartExport(workspaceId);
  const list = useDraftExports(workspaceId, draft.id);
  const link = useDownloadLink(workspaceId);
  const refresh = useRefreshExports(workspaceId);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const note = approvalNote(draft.status);

  const onExport = async () => {
    setStartError(null);
    try {
      const job = await start.mutateAsync({ draftId: draft.id, draftVersion: draft.version });
      setJobId(job.id);
    } catch (error) {
      setStartError(
        error instanceof ApiError && error.code === 'CONFLICT'
          ? EXPORT_CONFLICT_MESSAGE
          : describeError(error).message,
      );
    }
  };

  const onDownload = async (exportId: string) => {
    setDownloadError(null);
    try {
      startDownload(await link.mutateAsync(exportId));
    } catch (error) {
      setDownloadError(describeError(error).message);
    }
  };

  const now = Date.now();
  return (
    <div className="space-y-3">
      {note === null ? null : <p className="leading-relaxed text-[var(--co-text-muted)]">{note}</p>}
      {canWrite ? (
        <Button loading={start.isPending} onClick={() => void onExport()}>
          Export ZIP package
        </Button>
      ) : (
        <p className="text-[var(--co-text-muted)]">
          You can download packages but not create them.
        </p>
      )}
      {startError === null ? null : (
        <p role="alert" className="text-[var(--co-danger)]">
          {startError}
        </p>
      )}
      {jobId === null ? null : (
        <ExportJobStatus workspaceId={workspaceId} jobId={jobId} onDone={() => void refresh()} />
      )}
      {downloadError === null ? null : (
        <p role="alert" className="text-[var(--co-danger)]">
          {downloadError}
        </p>
      )}
      {list.isError ? (
        <p role="alert" className="text-[var(--co-danger)]">
          Could not load packages: {describeError(list.error).message}
        </p>
      ) : null}
      {list.data === undefined || list.data.items.length === 0 ? (
        list.isPending ? null : (
          <p className="text-[var(--co-text-muted)]">No packages yet.</p>
        )
      ) : (
        <ul aria-label="Packages" className="space-y-2">
          {list.data.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--co-border)] p-3"
            >
              <div className="min-w-0 flex-1 text-sm leading-relaxed">
                <p className="font-medium [overflow-wrap:anywhere]">{item.filename}</p>
                <p className="text-[var(--co-text-muted)]">
                  {item.fileCount} files · {formatSize(item.sizeBytes)} · version{' '}
                  {item.draftVersion} · made {formatDate(item.createdAt)}
                </p>
                <p className="text-[var(--co-text-muted)]">
                  {isDownloadable(item, now)
                    ? `Available until ${formatDate(item.expiresAt)}`
                    : 'Expired. Export the draft again.'}
                </p>
              </div>
              {isDownloadable(item, now) ? (
                <Button
                  variant="secondary"
                  loading={link.isPending && link.variables === item.id}
                  onClick={() => void onDownload(item.id)}
                >
                  Download
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExportJobStatus({
  workspaceId,
  jobId,
  onDone,
}: {
  workspaceId: string;
  jobId: string;
  onDone: () => void;
}) {
  const query = useJob(workspaceId, jobId);
  const job = query.data;
  const doneRef = useRef(false);
  useEffect(() => {
    if (job !== undefined && isTerminalJobStatus(job.status) && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [job, onDone]);
  if (job === undefined) {
    return query.isError ? (
      <p role="alert" className="text-[var(--co-danger)]">
        {describeError(query.error).message}
      </p>
    ) : (
      <p role="status">Starting…</p>
    );
  }
  const failed = job.status === 'failed' || job.status === 'cancelled';
  return (
    <p role={failed ? 'alert' : 'status'} className={failed ? 'text-[var(--co-danger)]' : ''}>
      {exportJobText(job)}
    </p>
  );
}
