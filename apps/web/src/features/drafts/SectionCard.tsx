import { useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@creatorops/contracts';
import type { Draft, DraftSections, SectionName } from '@creatorops/contracts';
import { Button } from '@creatorops/ui';

import { describeError } from '../errors.js';
import { JobPanel } from '../jobs/JobPanel.js';
import { jobKeys, useJobReader, useRegenerateSection } from '../jobs/jobQueries.js';
import { copyText } from './copyText.js';
import { formatSectionForCopy } from './formatDraft.js';
import { isSameSectionValue, toEditorText } from './sectionEdit.js';
import type { SectionValue } from './sectionEdit.js';
import { CLAIM_KIND_LABELS, SECTION_LABELS } from './sectionLabels.js';
import { SectionContent } from './SectionContent.js';
import { SectionEditor } from './SectionEditor.js';
import { useRefreshDraft, useUpdateDraft } from './draftQueries.js';

export const REGENERATE_CONFLICT_MESSAGE =
  'This section changed since you loaded it. The draft has been reloaded.';
export const SECTION_CHANGED_MESSAGE =
  'This section was edited while the job was running, so your edit was kept.';
export const COPY_FAILED_MESSAGE = 'Copy failed. Select the text and copy it manually.';

export interface SectionCardProps {
  workspaceId: string;
  draft: Draft;
  name: SectionName;
  canWrite: boolean;
}

export function SectionCard({ workspaceId, draft, name, canWrite }: SectionCardProps) {
  const queryClient = useQueryClient();
  const refresh = useRefreshDraft(workspaceId);
  const update = useUpdateDraft(workspaceId, draft.id);
  const regenerate = useRegenerateSection(workspaceId);

  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState(false);
  const [sectionChanged, setSectionChanged] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const jobReader = useJobReader(workspaceId, jobId ?? '');
  const job = jobId === null ? undefined : jobReader.data;
  const jobRunning = job?.status === 'queued' || job?.status === 'running';
  const busy = jobRunning || regenerate.isPending;

  // A regeneration that lost to an edit ends failed with SECTION_CHANGED. Show why, and reload once.
  const handledJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (job === undefined || job.status !== 'failed' || job.errorCode !== 'SECTION_CHANGED') return;
    if (handledJobRef.current === job.id) return;
    handledJobRef.current = job.id;
    setSectionChanged(true);
    void refresh();
  }, [job, refresh]);

  useEffect(() => {
    if (copyState === 'idle') return undefined;
    const timer = setTimeout(() => setCopyState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  const sectionState = draft.sectionState[name];
  const warnings = draft.claimWarnings.filter((warning) => warning.section === name);
  const label = SECTION_LABELS[name];
  const headingId = `section-${name}-heading`;

  const onSave = async (value: SectionValue) => {
    setSaveError(null);
    setSaved(false);
    // An unchanged value is not a change: close the editor without a request.
    if (isSameSectionValue(value, draft.sections[name])) {
      setConflict(false);
      setEditing(false);
      return;
    }
    // Only this section is sent, with the version the screen holds now (after any reload).
    const sections = { [name]: value } as Partial<DraftSections>;
    try {
      await update.mutateAsync({ version: draft.version, sections });
      setConflict(false);
      setEditing(false);
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setConflict(true);
      } else {
        setSaveError(describeError(error).message);
      }
    }
  };

  const onRegenerate = async () => {
    setRegenerateError(null);
    setRegenerated(false);
    setSectionChanged(false);
    try {
      const started = await regenerate.mutateAsync({
        draftId: draft.id,
        section: name,
        expectedRev: sectionState.rev,
      });
      queryClient.setQueryData(jobKeys.detail(workspaceId, started.id), started);
      setJobId(started.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setRegenerateError(REGENERATE_CONFLICT_MESSAGE);
        void refresh();
      } else {
        setRegenerateError(describeError(error).message);
      }
    }
  };

  const onRegenerateFinished = () => {
    setRegenerated(true);
    void refresh();
  };

  const onCopy = async () => {
    const ok = await copyText(formatSectionForCopy(name, draft.sections));
    setCopyState(ok ? 'copied' : 'failed');
  };

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 space-y-3 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-base font-semibold">
          {label}
        </h3>
        <span className="rounded-full border border-[var(--co-border)] px-2 text-sm">
          {sectionState.origin === 'edited' ? 'Edited' : 'AI generated'}
        </span>
        <span className="text-sm text-[var(--co-text-muted)]">revision {sectionState.rev}</span>
      </div>

      {warnings.length === 0 ? null : (
        <ul aria-label={`Claim warnings for ${label}`} className="flex flex-wrap gap-2">
          {warnings.map((warning, index) => (
            <li
              key={`${index}-${warning.kind}`}
              className="rounded-md border border-[var(--co-border)] px-2 py-1 text-sm leading-relaxed [overflow-wrap:anywhere]"
            >
              <span className="font-medium">{CLAIM_KIND_LABELS[warning.kind]}</span>:{' '}
              <span>{warning.text}</span>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <SectionEditor
          name={name}
          initialText={toEditorText(name, draft.sections)}
          saving={update.isPending}
          conflict={conflict}
          saveError={saveError}
          onSave={(value) => void onSave(value)}
          onCancel={() => {
            setEditing(false);
            setConflict(false);
            setSaveError(null);
          }}
          onReloadAndDiscard={() => {
            void refresh().then(() => {
              setConflict(false);
              setEditing(false);
            });
          }}
          onKeepTextAndReload={() => {
            void refresh().then(() => setConflict(false));
          }}
        />
      ) : (
        <SectionContent name={name} sections={draft.sections} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void onCopy()}>
          Copy
        </Button>
        {canWrite && !editing ? (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setSaved(false);
                setSaveError(null);
                setConflict(false);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void onRegenerate()}>
              Regenerate
            </Button>
          </>
        ) : null}
        {copyState === 'copied' ? <p role="status">Copied</p> : null}
        {copyState === 'failed' ? (
          <p role="alert" className="text-[var(--co-danger)]">
            {COPY_FAILED_MESSAGE}
          </p>
        ) : null}
      </div>

      {saved ? (
        <p role="status" className="font-medium text-[var(--co-success)]">
          Saved
        </p>
      ) : null}
      {regenerated ? (
        <p role="status" className="font-medium text-[var(--co-success)]">
          Section regenerated
        </p>
      ) : null}
      {regenerateError === null ? null : (
        <p role="alert" className="text-[var(--co-danger)]">
          {regenerateError}
        </p>
      )}
      {sectionChanged ? (
        <p role="alert" className="text-[var(--co-danger)]">
          {SECTION_CHANGED_MESSAGE}
        </p>
      ) : null}

      {jobId === null ? null : (
        <JobPanel
          key={jobId}
          workspaceId={workspaceId}
          jobId={jobId}
          onFinished={onRegenerateFinished}
          onRetry={() => void onRegenerate()}
        />
      )}
    </section>
  );
}
