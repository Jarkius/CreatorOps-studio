export interface ErrorStateProps {
  title?: string;
  /** Safe, user-facing explanation. */
  message: string;
  /** Support reference, shown as "Reference: <requestId>". */
  requestId?: string;
  onRetry?: () => void;
  /** True while a retry is in flight; disables the retry button. */
  retrying?: boolean;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  requestId,
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-[var(--co-danger)] bg-[var(--co-surface)] p-5 leading-relaxed"
    >
      <h2 className="text-base font-semibold text-[var(--co-danger)]">{title}</h2>
      <p className="mt-1">{message}</p>
      {requestId === undefined ? null : (
        <p className="mt-2 text-sm text-[var(--co-text-muted)] [overflow-wrap:anywhere]">
          Reference: {requestId}
        </p>
      )}
      {onRetry === undefined ? null : (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-[var(--co-accent)] px-4 py-2 font-medium text-[var(--co-accent-text)] disabled:cursor-wait disabled:opacity-70"
        >
          {retrying ? 'Trying again…' : 'Try again'}
        </button>
      )}
    </div>
  );
}
