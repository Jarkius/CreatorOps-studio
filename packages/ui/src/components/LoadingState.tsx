export interface LoadingStateProps {
  /** Visible text announced to assistive technology. */
  label?: string;
}

/** Inline loading indicator. The spinner is decorative; the label carries the meaning. */
export function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 py-4 text-[var(--co-text-muted)] leading-relaxed"
    >
      <span
        aria-hidden="true"
        className="inline-block size-5 shrink-0 animate-spin rounded-full border-2 border-[var(--co-border)] border-t-[var(--co-accent)] motion-reduce:animate-none"
      />
      <span>{label}</span>
    </div>
  );
}
