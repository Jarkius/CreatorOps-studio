import { useId } from 'react';

/** Shared look for text-like inputs. Heights grow with the text, so Thai text is never clipped. */
export const FIELD_CONTROL_CLASS =
  'w-full min-h-11 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] px-3 py-2 leading-relaxed text-[var(--co-text)] [overflow-wrap:anywhere] aria-[invalid=true]:border-[var(--co-danger)]';

export interface FieldIds {
  id: string;
  hintId: string | undefined;
  errorId: string | undefined;
  describedBy: string | undefined;
}

/** Derives the ids that link a control to its hint and error message. */
export function useFieldIds(
  explicitId: string | undefined,
  hint: string | undefined,
  error: string | undefined,
  ariaDescribedBy: string | undefined,
): FieldIds {
  const generated = useId();
  const id = explicitId ?? `field-${generated}`;
  const hintId = hint === undefined || hint === '' ? undefined : `${id}-hint`;
  const errorId = error === undefined || error === '' ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId, ariaDescribedBy].filter(Boolean).join(' ') || undefined;
  return { id, hintId, errorId, describedBy };
}
