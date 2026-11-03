import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

import { FIELD_CONTROL_CLASS, useFieldIds } from './field-utils.js';

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

/** A labelled multi-line input. Forwards its ref so react-hook-form `register` works. */
export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    {
      label,
      hint,
      error,
      id: explicitId,
      className,
      rows = 4,
      'aria-describedby': ariaDescribedBy,
      ...rest
    },
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
        <textarea
          ref={ref}
          id={ids.id}
          rows={rows}
          aria-invalid={error === undefined || error === '' ? undefined : true}
          aria-describedby={ids.describedBy}
          className={`${FIELD_CONTROL_CLASS} resize-y`}
          {...rest}
        />
        {error === undefined || error === '' ? null : (
          <p id={ids.errorId} className="text-sm leading-relaxed text-[var(--co-danger)]">
            {error}
          </p>
        )}
      </div>
    );
  },
);
