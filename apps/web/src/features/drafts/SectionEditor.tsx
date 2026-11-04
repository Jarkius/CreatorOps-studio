import { useState } from 'react';

import { Button, TextAreaField, TextField } from '@creatorops/ui';
import type { SectionName } from '@creatorops/contracts';

import { SECTION_LABELS } from './sectionLabels.js';
import { parseSectionText } from './sectionEdit.js';
import type { SectionValue } from './sectionEdit.js';

export interface SectionEditorProps {
  name: SectionName;
  /** The text to start from. Read once, when the editor opens; later changes do not reset the typed text. */
  initialText: string;
  saving: boolean;
  /** Another editor or a regeneration changed the draft since it was loaded. */
  conflict: boolean;
  /** A failure other than a conflict, shown under the buttons. */
  saveError: string | null;
  onSave: (value: SectionValue) => void;
  onCancel: () => void;
  onReloadAndDiscard: () => void;
  onKeepTextAndReload: () => void;
}

export function SectionEditor({
  name,
  initialText,
  saving,
  conflict,
  saveError,
  onSave,
  onCancel,
  onReloadAndDiscard,
  onKeepTextAndReload,
}: SectionEditorProps) {
  const [text, setText] = useState(initialText);
  const [validation, setValidation] = useState<string | null>(null);
  const label = SECTION_LABELS[name];

  const submit = () => {
    const parsed = parseSectionText(name, text);
    if (!parsed.ok) {
      setValidation(parsed.message);
      return;
    }
    setValidation(null);
    onSave(parsed.value);
  };

  const field =
    name === 'hashtags' ? (
      <TextField
        label={`${label}, separated by spaces or commas`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        error={validation ?? undefined}
        className="[overflow-wrap:anywhere]"
      />
    ) : (
      <TextAreaField
        label={name === 'storyboard' ? `${label}, one scene per line` : label}
        value={text}
        rows={name === 'script' || name === 'caption' ? 8 : 4}
        onChange={(event) => setText(event.target.value)}
        error={validation ?? undefined}
        className="[overflow-wrap:anywhere]"
      />
    );

  return (
    <div className="space-y-3">
      {field}
      <div className="flex flex-wrap gap-3">
        <Button loading={saving} onClick={submit}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
      {conflict ? (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-[var(--co-danger)] p-4 leading-relaxed"
        >
          <p>This draft was changed by someone else, or by a regeneration.</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onReloadAndDiscard}>
              Reload and discard my change
            </Button>
            <Button variant="secondary" onClick={onKeepTextAndReload}>
              Keep my text and reload
            </Button>
          </div>
        </div>
      ) : null}
      {saveError === null ? null : (
        <p role="alert" className="text-[var(--co-danger)] [overflow-wrap:anywhere]">
          {saveError}
        </p>
      )}
    </div>
  );
}
