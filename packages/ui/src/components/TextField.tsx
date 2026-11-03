import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { FIELD_CONTROL_CLASS, useFieldIds } from './field-utils.js';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label. Always rendered, never placeholder-only. */
  label: string;
  hint?: string;
  /** Visible error text. Also exposed through aria-describedby and aria-invalid. */
  error?: string;
}

/** A labelled single-line input. Forwards its ref so react-hook-form `register` works. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id: explicitId, className, 'aria-describedby': ariaDescribedBy, ...rest },
  ref,
) {
  const ids = useFieldIds(explicitId, hint, error, ariaDescribedBy);
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={ids.id} className="block font-medium leading-relaxed">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={ids.hintId} className="text-sm leading-relaxed text-[var(--co-text-muted)]">
          {hint}
        </p>
      )}
      <input
        ref={ref}
        id={ids.id}
        aria-invalid={error === undefined || error === '' ? undefined : true}
        aria-describedby={ids.describedBy}
        className={FIELD_CONTROL_CLASS}
        {...rest}
      />
      {error === undefined || error === '' ? null : (
        <p id={ids.errorId} className="text-sm leading-relaxed text-[var(--co-danger)]">
          {error}
        </p>
      )}
    </div>
  );
});
