import type { DraftScene } from '@creatorops/contracts';
import { ApiError } from '@creatorops/contracts';
import { Button } from '@creatorops/ui';
import { useState } from 'react';

import { SCENE_LABELS } from './scenes.js';
import type { SavedVideoPrompts, useVideoPromptsRun } from './videoPromptHooks.js';

const SCENES: readonly DraftScene[] = ['product_hero', 'detail', 'usage', 'final_shot'];

export type VideoPromptRun = ReturnType<typeof useVideoPromptsRun>;

export interface VideoPromptsSectionProps {
  readonly canStart: boolean;
  readonly run: VideoPromptRun;
  readonly saved: SavedVideoPrompts | null;
  readonly savedLoading: boolean;
  /** The prompt shown for a scene: the person's edit, else the generated text. */
  readonly promptOf: (scene: DraftScene) => string;
  readonly onEdit: (scene: DraftScene, text: string) => void;
  readonly onReset: (scene: DraftScene) => void;
  readonly isEdited: (scene: DraftScene) => boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

function CopyButton({ label, text, name }: { label: string; text: string; name: string }) {
  const [state, setState] = useState<CopyState>('idle');
  return (
    <>
      <Button
        variant="secondary"
        aria-label={name}
        disabled={text.trim() === ''}
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => setState('copied'),
            () => setState('failed'),
          );
        }}
      >
        {label}
      </Button>
      {state === 'copied' ? (
        <span role="status" className="text-sm">
          Copied
        </span>
      ) : null}
      {state === 'failed' ? (
        <span role="alert" className="text-sm text-[var(--co-danger)]">
          Could not copy. Select the text and copy it yourself.
        </span>
      ) : null}
    </>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

/**
 * Four video prompts for the draft's product, to paste into Google Flow (or any video tool): one
 * single-shot English prompt per scene and a short voiceover line. Written by the workspace's text
 * provider through a job; the saved result is read back from the server.
 */
export function VideoPromptsSection(props: VideoPromptsSectionProps) {
  const { canStart, run, saved, savedLoading } = props;
  const failed = run.job?.status === 'failed' || run.job?.status === 'cancelled';
  const all = SCENES.map((scene, index) => {
    const voiceover = saved?.scenes.get(scene)?.voiceover ?? '';
    return `${index + 1}. ${SCENE_LABELS[scene]}\n${props.promptOf(scene)}\nVoiceover: ${voiceover}`;
  }).join('\n\n');

  return (
    <section
      aria-label="Video prompts"
      className="space-y-2 rounded-md border border-[var(--co-border)] p-3"
    >
      <h3 className="text-sm font-medium">Video prompts</h3>
      <p className="text-sm text-[var(--co-text-muted)]">
        Four short prompts for a video tool such as Google Flow, written from your product. Copy
        one, or let Make video in Flow use them.
      </p>
      {canStart ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={run.running || savedLoading} onClick={run.start}>
            {run.running
              ? 'Writing video prompts…'
              : saved === null
                ? 'Write video prompts'
                : 'Write them again'}
          </Button>
          {run.running && run.job !== null ? (
            <Button variant="secondary" disabled={run.cancelling} onClick={run.cancel}>
              {run.cancelling ? 'Cancelling…' : 'Cancel'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {run.running ? (
        <p role="status" className="text-sm">
          Writing the prompts. This usually takes under a minute.
        </p>
      ) : null}
      {run.startError !== null ? (
        <p role="alert" className="text-sm text-[var(--co-danger)]">
          {messageOf(run.startError)}
        </p>
      ) : null}
      {!run.running && failed ? (
        <p role="alert" className="text-sm text-[var(--co-danger)]">
          {run.job?.status === 'cancelled'
            ? 'Cancelled.'
            : (run.job?.errorMessage ?? 'The prompts could not be written. Try again.')}
        </p>
      ) : null}
      {savedLoading && saved === null ? (
        <p className="text-sm text-[var(--co-text-muted)]">Loading saved prompts…</p>
      ) : null}
      {saved === null ? (
        !savedLoading && !run.running ? (
          <p className="text-sm text-[var(--co-text-muted)]">No video prompts yet.</p>
        ) : null
      ) : (
        <>
          <ol className="space-y-3">
            {SCENES.map((scene, index) => {
              const id = `video-prompt-${scene}`;
              const voiceover = saved.scenes.get(scene)?.voiceover ?? '';
              return (
                <li key={scene} className="min-w-0">
                  <label htmlFor={id} className="text-sm font-medium">
                    {`${index + 1}. ${SCENE_LABELS[scene]} (video prompt)`}
                  </label>
                  <textarea
                    id={id}
                    value={props.promptOf(scene)}
                    rows={6}
                    onChange={(event) => props.onEdit(scene, event.target.value)}
                    className="mt-1 w-full min-w-0 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] p-2 text-sm"
                  />
                  <p className="mt-1 text-sm [overflow-wrap:anywhere]">
                    <span className="text-[var(--co-text-muted)]">Voiceover: </span>
                    {voiceover}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <CopyButton
                      label="Copy prompt"
                      name={`Copy video prompt for ${SCENE_LABELS[scene]}`}
                      text={props.promptOf(scene)}
                    />
                    <CopyButton
                      label="Copy voiceover"
                      name={`Copy voiceover for ${SCENE_LABELS[scene]}`}
                      text={voiceover}
                    />
                    <Button
                      variant="secondary"
                      aria-label={`Reset video prompt for ${SCENE_LABELS[scene]}`}
                      disabled={!props.isEdited(scene)}
                      onClick={() => props.onReset(scene)}
                    >
                      Reset
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton label="Copy all" name="Copy all video prompts" text={all} />
          </div>
          <p className="text-xs text-[var(--co-text-muted)]">
            {`Written by ${saved.model}. Edits stay in this panel; set the 9:16 shape in the video tool.`}
          </p>
        </>
      )}
    </section>
  );
}
