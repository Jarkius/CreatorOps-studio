import { Button } from '@creatorops/ui';
import { useState } from 'react';

import { STEP_LABELS, STEP_ORDER } from './runner.js';
import type { HelperState } from './useMetaAi.js';

export interface HelperRunPanelProps {
  readonly state: HelperState;
  readonly onCancel: () => void;
  readonly onDismiss: () => void;
}

const SCENE_NAMES: Record<string, string> = {
  product_hero: 'Product Hero',
  detail: 'Detail',
  usage: 'Usage',
  final_shot: 'Final Shot',
};

/** The visible steps of a Meta AI run, with Cancel while it runs and Copy diagnostics after. */
export function HelperRunPanel({ state, onCancel, onDismiss }: HelperRunPanelProps) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  if (state.phase === 'idle') return null;
  const sceneName = SCENE_NAMES[state.scene] ?? state.scene;
  const copyDiagnostics = () => {
    navigator.clipboard.writeText(state.diagnostics).then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    );
  };

  return (
    <section
      aria-label="Meta AI helper"
      className="rounded-md border border-[var(--co-border)] p-3 text-sm"
    >
      {state.phase === 'running' ? (
        <>
          <p className="font-medium">{`Meta AI is working on ${sceneName}`}</p>
          <ol aria-label="Steps" className="mt-2 space-y-1">
            {STEP_ORDER.map((step, index) => {
              const current = STEP_ORDER.indexOf(state.step);
              const mark = index < current ? '☑' : index === current ? '▶' : '☐';
              return (
                <li key={step} aria-current={index === current ? 'step' : undefined}>
                  <span aria-hidden="true">{mark} </span>
                  {STEP_LABELS[step]}
                </li>
              );
            })}
          </ol>
          <div className="mt-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}

      {state.phase === 'done' ? (
        <>
          <p role="status" className="font-medium">{`Saved the image to ${sceneName}.`}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onDismiss}>
              Done
            </Button>
          </div>
        </>
      ) : null}

      {state.phase === 'failed' ? (
        <>
          <p role="alert" className="text-[var(--co-danger)] [overflow-wrap:anywhere]">
            {state.message}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={copyDiagnostics}>
              Copy diagnostics
            </Button>
            <Button variant="secondary" onClick={onDismiss}>
              Close
            </Button>
            {copied === 'copied' ? <span role="status">Copied</span> : null}
            {copied === 'failed' ? (
              <span role="alert" className="text-[var(--co-danger)]">
                Could not copy.
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
