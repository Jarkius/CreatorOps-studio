import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';

import { FIELD_CONTROL_CLASS, useFieldIds } from './field-utils.js';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  error?: string;
}

/** A labelled native select. Forwards its ref so react-hook-form `register` works. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  {
    label,
    options,
    hint,
    error,
    id: explicitId,
    className,
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
      <select
        ref={ref}
        id={ids.id}
        aria-invalid={error === undefined || error === '' ? undefined : true}
        aria-describedby={ids.describedBy}
        className={FIELD_CONTROL_CLASS}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error === undefined || error === '' ? null : (
        <p id={ids.errorId} className="text-sm leading-relaxed text-[var(--co-danger)]">
          {error}
        </p>
      )}
    </div>
  );
});
