import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Optional call to action, for example a link or button. */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="rounded-lg border border-dashed border-[var(--co-border)] bg-[var(--co-surface)] p-5 leading-relaxed">
      <h2 className="text-base font-semibold">{title}</h2>
      {description === undefined ? null : (
        <p className="mt-1 text-[var(--co-text-muted)]">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </section>
  );
}
