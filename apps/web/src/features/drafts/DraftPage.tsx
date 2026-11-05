import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { ApiError } from '@creatorops/contracts';
import type { Draft, DraftStatus, SectionName } from '@creatorops/contracts';
import { Button, ErrorState, LoadingState, SelectField, StatusPill } from '@creatorops/ui';

import { campaignPath, campaignsPath } from '../campaigns/paths.js';
import { useCanWrite } from '../campaigns/useCanWrite.js';
import { describeError, isNotFound } from '../errors.js';
import { formatDate } from '../products/format.js';
import { NotFoundNotice } from '../products/ProductStates.js';
import { copyText } from './copyText.js';
import { useDraft, useRefreshDraft, useUpdateDraft } from './draftQueries.js';
import { COPY_ORDER, formatDraftForCopy } from './formatDraft.js';
import { CLAIM_KIND_LABELS, SECTION_LABELS } from './sectionLabels.js';
import { DraftResults } from './DraftResults.js';
import { SectionCard } from './SectionCard.js';

export const STATUS_CONFLICT_MESSAGE =
  'This draft was changed by someone else, or by a regeneration.';
export const COPY_ALL_FAILED_MESSAGE = 'Copy failed. Select the text and copy it manually.';

const STATUS_OPTIONS: { value: DraftStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
];

export function DraftPage() {
  const { workspaceId = '', draftId = '' } = useParams();
  const draftQuery = useDraft(workspaceId, draftId);
  const draft = draftQuery.data;

  if (draft === undefined) {
    if (draftQuery.isError && isNotFound(draftQuery.error)) {
      return (
        <NotFoundNotice
          title="Draft not found"
          description="This draft does not exist in this workspace, or it was removed."
          backTo={campaignsPath(workspaceId)}
          backLabel="Back to campaigns"
        />
      );
    }
    if (draftQuery.isError) {
      const { message, requestId } = describeError(draftQuery.error);
      return (
        <ErrorState
          message={message}
          requestId={requestId}
          retrying={draftQuery.isFetching}
          onRetry={() => void draftQuery.refetch()}
        />
      );
    }
    return <LoadingState label="Loading draft…" />;
  }

  return <DraftView workspaceId={workspaceId} draft={draft} />;
}

function DraftView({ workspaceId, draft }: { workspaceId: string; draft: Draft }) {
  const canWrite = useCanWrite(workspaceId);
  const refresh = useRefreshDraft(workspaceId);
  const updateStatus = useUpdateDraft(workspaceId, draft.id);
  const [choice, setChoice] = useState<DraftStatus>(draft.status);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSaved, setStatusSaved] = useState(false);
  const [copyAll, setCopyAll] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onSaveStatus = async () => {
    setStatusError(null);
    setStatusSaved(false);
    try {
      // The status-only request: the title is sent unchanged, which the server ignores as a change.
      await updateStatus.mutateAsync({
        version: draft.version,
        status: choice,
        sections: { title: draft.sections.title },
      });
      setStatusSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setStatusError(STATUS_CONFLICT_MESSAGE);
        void refresh();
      } else {
        setStatusError(describeError(error).message);
      }
    }
  };

  const onCopyAll = async () => {
    const ok = await copyText(formatDraftForCopy(draft.sections));
    setCopyAll(ok ? 'copied' : 'failed');
  };

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <Link
          to={campaignPath(workspaceId, draft.campaignId)}
          className="inline-flex min-h-11 items-center text-[var(--co-accent)] underline underline-offset-4"
        >
          Back to campaign
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-2xl font-semibold leading-relaxed">
            Variant {draft.variantIndex + 1}
          </h1>
          <StatusPill status={draft.status} />
        </div>
        <time dateTime={draft.updatedAt} className="block text-sm text-[var(--co-text-muted)]">
          Updated {formatDate(draft.updatedAt)}
        </time>
      </header>

      {draft.needsReview ? (
        <section
          aria-labelledby="review-heading"
          className="space-y-2 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4 leading-relaxed"
        >
          <h2 id="review-heading" className="text-base font-semibold">
            Needs review: some text may make a claim that is not supported by the product facts.
          </h2>
          {draft.claimWarnings.length === 0 ? null : (
            <ul aria-label="Claim warnings" className="list-disc space-y-1 pl-6">
              {draft.claimWarnings.map((warning, index) => (
                <li key={`${index}-${warning.section}`} className="[overflow-wrap:anywhere]">
                  <span className="font-medium">{SECTION_LABELS[warning.section]}</span>
                  {' · '}
                  {CLAIM_KIND_LABELS[warning.kind]}: <span>{warning.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="status-heading" className="space-y-3">
        <h2 id="status-heading" className="text-base font-semibold">
          Review status
        </h2>
        {canWrite ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <SelectField
                label="Status"
                options={STATUS_OPTIONS}
                value={choice}
                onChange={(event) => {
                  setChoice(event.target.value as DraftStatus);
                  setStatusSaved(false);
                }}
              />
              <Button
                loading={updateStatus.isPending}
                disabled={choice === draft.status}
                onClick={() => void onSaveStatus()}
              >
                Save status
              </Button>
            </div>
            <p className="text-sm leading-relaxed text-[var(--co-text-muted)]">
              Editing the text of an approved or reviewed draft returns it to Draft.
            </p>
            {statusSaved ? (
              <p role="status" className="font-medium text-[var(--co-success)]">
                Status saved
              </p>
            ) : null}
            {statusError === null ? null : (
              <p role="alert" className="text-[var(--co-danger)]">
                {statusError}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[var(--co-text-muted)]">You can view this draft but not change it.</p>
        )}
      </section>

      <section aria-labelledby="copy-heading" className="space-y-3">
        <h2 id="copy-heading" className="text-base font-semibold">
          Copy
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void onCopyAll()}>
            Copy all
          </Button>
          {copyAll === 'copied' ? <p role="status">Copied</p> : null}
          {copyAll === 'failed' ? (
            <p role="alert" className="text-[var(--co-danger)]">
              {COPY_ALL_FAILED_MESSAGE}
            </p>
          ) : null}
        </div>
      </section>

      <DraftResults workspaceId={workspaceId} draft={draft} canWrite={canWrite} />

      <section aria-labelledby="sections-heading" className="space-y-3">
        <h2 id="sections-heading" className="text-base font-semibold">
          Content
        </h2>
        <ol aria-label="Sections" className="grid gap-4">
          {COPY_ORDER.map((name: SectionName) => (
            <li key={name}>
              <SectionCard
                workspaceId={workspaceId}
                draft={draft}
                name={name}
                canWrite={canWrite}
              />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
