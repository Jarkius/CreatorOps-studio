import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { Button } from './Button.js';
import type { ButtonVariant } from './Button.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the confirmed action runs: the confirm button shows a busy state. */
  busy?: boolean;
  /** Colour of the confirm button. Use "danger" for destructive actions. */
  confirmVariant?: ButtonVariant;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea';

/**
 * A modal alert dialog. It is a plain fixed overlay (no HTMLDialogElement, so jsdom works).
 * Opening focuses Cancel; Escape cancels; Tab stays inside; closing returns focus to the
 * element that was focused when the dialog opened.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
  confirmVariant = 'primary',
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      if (opener !== null && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== 'Tab' || dialogRef.current === null) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-5 leading-relaxed"
      >
        <h2 id={titleId} className="text-lg font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-[var(--co-text-muted)] [overflow-wrap:anywhere]">
          {description}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} loading={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
