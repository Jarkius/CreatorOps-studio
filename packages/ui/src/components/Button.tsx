import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Disables the button and marks it busy. The caller changes the label while loading. */
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--co-accent)] text-[var(--co-accent-text)] hover:brightness-110',
  secondary:
    'border border-[var(--co-border)] bg-[var(--co-surface)] text-[var(--co-text)] hover:bg-[var(--co-border)]',
  danger:
    'border border-[var(--co-danger)] bg-transparent text-[var(--co-danger)] hover:bg-[var(--co-surface)]',
};

/** Classes for a button-looking link or button. Keeps links and buttons visually identical. */
export function buttonClassName(variant: ButtonVariant = 'primary'): string {
  return [
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 font-medium leading-relaxed',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANT_CLASS[variant],
  ].join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, disabled, type = 'button', className, ...rest },
  ref,
) {
  const extra = className === undefined ? '' : ` ${className}`;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={`${buttonClassName(variant)}${extra}`}
      {...rest}
    />
  );
});
