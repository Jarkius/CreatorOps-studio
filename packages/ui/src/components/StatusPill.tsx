export const PILL_STATUS_VALUES = [
  'active',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'draft',
  'in_review',
  'approved',
  'rejected',
  'archived',
] as const;

export type PillStatus = (typeof PILL_STATUS_VALUES)[number];

interface PillDefinition {
  label: string;
  /** Decorative glyph. The text label is always rendered, so colour is never the only signal. */
  glyph: string;
  tone: string;
}

const PILLS: Record<PillStatus, PillDefinition> = {
  active: { label: 'Active', glyph: '●', tone: 'text-[var(--co-success)]' },
  queued: { label: 'Queued', glyph: '○', tone: 'text-[var(--co-text-muted)]' },
  running: { label: 'Running', glyph: '◐', tone: 'text-[var(--co-accent)]' },
  succeeded: { label: 'Succeeded', glyph: '✓', tone: 'text-[var(--co-success)]' },
  failed: { label: 'Failed', glyph: '✕', tone: 'text-[var(--co-danger)]' },
  cancelled: { label: 'Cancelled', glyph: '⊘', tone: 'text-[var(--co-text-muted)]' },
  draft: { label: 'Draft', glyph: '✎', tone: 'text-[var(--co-text-muted)]' },
  in_review: { label: 'In review', glyph: '◉', tone: 'text-[var(--co-accent)]' },
  approved: { label: 'Approved', glyph: '✓', tone: 'text-[var(--co-success)]' },
  rejected: { label: 'Rejected', glyph: '✕', tone: 'text-[var(--co-danger)]' },
  archived: { label: 'Archived', glyph: '▣', tone: 'text-[var(--co-text-muted)]' },
};

export interface StatusPillProps {
  status: PillStatus;
}

export function StatusPill({ status }: StatusPillProps) {
  const pill = PILLS[status];
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--co-border)] bg-[var(--co-surface)] px-2.5 py-1 text-sm leading-relaxed font-medium ${pill.tone}`}
    >
      <span aria-hidden="true">{pill.glyph}</span>
      <span className="text-[var(--co-text)]">{pill.label}</span>
    </span>
  );
}
