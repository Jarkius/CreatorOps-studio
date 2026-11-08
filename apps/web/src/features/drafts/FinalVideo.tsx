import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, AssembleVideoOutputSchema, type Draft, type Job } from '@creatorops/contracts';
import { Button } from '@creatorops/ui';

import { useDashboard } from '../../app/dashboard-context.js';
import { describeError } from '../errors.js';
import { newIdempotencyKey } from '../jobs/idempotency.js';
import { isTerminalJobStatus, useJob } from '../jobs/jobQueries.js';
import { copyText } from './copyText.js';
import { exportKeys } from './exportQueries.js';

const SCENE_NAMES: Record<string, string> = {
  product_hero: 'Product hero',
  detail: 'Detail',
  usage: 'Usage',
  final_shot: 'Final shot',
};

/** What a finished final-video job says, in one line. */
export function finalVideoText(job: Job): string {
  if (job.status === 'queued') return 'Waiting to start…';
  if (job.status === 'running') return 'Making the final video… (this can take a few minutes)';
  if (job.status === 'cancelled') return 'Cancelled.';
  if (job.status === 'failed') return job.errorMessage ?? 'The final video could not be made.';
  const output = AssembleVideoOutputSchema.safeParse(job.output);
  if (!output.success) return 'The final video is ready. It is in the files above.';
  const seconds = Math.round(output.data.durationMs / 1000);
  const parts = [
    `The final video is ready (${String(output.data.clipCount)} scenes, ${String(seconds)} s). It is in the files above and in the ZIP package.`,
  ];
  if (!output.data.subtitles) {
    parts.push('It has no subtitles: write the video prompts again for this version of the draft.');
  }
  if (output.data.skippedScenes.length > 0) {
    parts.push(
      `Left out (no video yet): ${output.data.skippedScenes.map((s) => SCENE_NAMES[s] ?? s).join(', ')}.`,
    );
  }
  return parts.join(' ');
}

/**
 * Joins the draft's scene videos into one 9:16 video with Thai subtitles (D-086). The key is made
 * once per click and reused only after a request that got no answer.
 */
export function FinalVideo({ workspaceId, draft }: { workspaceId: string; draft: Draft }) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  const pending = useRef<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: async () => {
      const key = pending.current ?? newIdempotencyKey();
      pending.current = key;
      try {
        const job = await client.jobs.assembleVideo(
          workspaceId,
          { draftId: draft.id, draftVersion: draft.version },
          key,
        );
        pending.current = null;
        return job;
      } catch (error) {
        const noResponse =
          error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
        if (!noResponse) pending.current = null;
        throw error;
      }
    },
    onSuccess: (job) => setJobId(job.id),
  });

  return (
    <div className="space-y-2">
      <h3 className="font-medium">Final video</h3>
      <p className="text-sm leading-relaxed text-[var(--co-text-muted)]">
        Joins the scene videos in order into one 9:16 video with Thai subtitles from the voiceover
        lines. Needs ffmpeg on the computer that runs the worker.
      </p>
      <Button
        variant="secondary"
        loading={start.isPending}
        onClick={() => {
          setJobId(null);
          start.mutate();
        }}
      >
        Make final video
      </Button>
      {start.isError ? (
        <p role="alert" className="text-[var(--co-danger)]">
          {describeError(start.error).message}
        </p>
      ) : null}
      {jobId === null ? null : (
        <FinalVideoStatus
          workspaceId={workspaceId}
          jobId={jobId}
          onDone={() =>
            void queryClient.invalidateQueries({
              queryKey: exportKeys.assets(workspaceId, draft.id),
            })
          }
        />
      )}
    </div>
  );
}

function FinalVideoStatus({
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
  const done = useRef(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    if (job !== undefined && isTerminalJobStatus(job.status) && !done.current) {
      done.current = true;
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
  const output = AssembleVideoOutputSchema.safeParse(job.output);
  const srt = output.success ? output.data.srt : '';
  return (
    <div className="space-y-2">
      <p role={failed ? 'alert' : 'status'} className={failed ? 'text-[var(--co-danger)]' : ''}>
        {finalVideoText(job)}
      </p>
      {srt === '' ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void copyText(srt).then((ok) => setCopied(ok))}
          >
            Copy subtitles (.srt)
          </Button>
          {copied === true ? <span role="status">Copied</span> : null}
          {copied === false ? (
            <span role="alert" className="text-[var(--co-danger)]">
              Could not copy.
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
