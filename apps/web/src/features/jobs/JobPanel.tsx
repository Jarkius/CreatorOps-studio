import { useEffect, useRef, useState } from 'react';

import type { Job } from '@creatorops/contracts';
import { Button, ErrorState, LoadingState, StatusPill } from '@creatorops/ui';

import { describeError } from '../errors.js';
import { useCancelJob, useJob } from './jobQueries.js';

export interface JobPanelProps {
  workspaceId: string;
  jobId: string;
  /** Called once, when the job succeeds. */
  onFinished: (job: Job) => void;
  /** Called by "Try again" on a failed or cancelled job. */
  onRetry: () => void;
}

function jobText(job: Job): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting to start';
    case 'running':
      return `Writing your content… attempt ${job.attempts} of ${job.maxAttempts}`;
    case 'succeeded':
      return 'Done';
    case 'failed':
      return job.errorMessage ?? 'The job failed.';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function JobPanel({ workspaceId, jobId, onFinished, onRetry }: JobPanelProps) {
  const query = useJob(workspaceId, jobId);
  const cancel = useCancelJob(workspaceId);
  const [stopRequested, setStopRequested] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const job = query.data;

  const notifiedRef = useRef(false);
  useEffect(() => {
    if (job?.status === 'succeeded' && !notifiedRef.current) {
      notifiedRef.current = true;
      onFinished(job);
    }
  }, [job, onFinished]);

  if (job === undefined) {
    if (query.isError) {
      const { message, requestId } = describeError(query.error);
      return (
        <ErrorState
          title="Could not load the job"
          message={message}
          requestId={requestId}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      );
    }
    return <LoadingState label="Loading job…" />;
  }

  const canCancel = job.status === 'queued' || job.status === 'running';
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  const cancelling = cancel.isPending || stopRequested;

  const onCancel = async () => {
    setCancelError(null);
    try {
      const updated = await cancel.mutateAsync(jobId);
      // A running job is only asked to stop; keep polling until the worker reports the outcome.
      if (updated.status === 'running') setStopRequested(true);
    } catch (error) {
      setCancelError(describeError(error).message);
    }
  };

  return (
    <section
      aria-label="Generation job"
      className="space-y-3 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={job.status} />
        <p role="status" className="min-w-0 leading-relaxed [overflow-wrap:anywhere]">
          {jobText(job)}
        </p>
      </div>
      {canCancel ? (
        <Button variant="secondary" loading={cancelling} onClick={() => void onCancel()}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      ) : null}
      {canRetry ? <Button onClick={onRetry}>Try again</Button> : null}
      {cancelError === null ? null : (
        <p role="alert" className="text-[var(--co-danger)]">
          {cancelError}
        </p>
      )}
      {query.isError ? (
        <ErrorState
          title="Could not refresh the job"
          message={describeError(query.error).message}
          requestId={describeError(query.error).requestId}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : null}
    </section>
  );
}
