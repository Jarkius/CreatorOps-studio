import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PILL_STATUS_VALUES, StatusPill } from './StatusPill.js';

const LABELS: Record<(typeof PILL_STATUS_VALUES)[number], string> = {
  active: 'Active',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
};

describe('StatusPill', () => {
  it.each(PILL_STATUS_VALUES)('renders a text label for %s, never colour alone', (status) => {
    const { container, unmount } = render(<StatusPill status={status} />);
    const pill = container.querySelector('[data-status]');
    expect(pill).not.toBeNull();
    expect(within(pill as HTMLElement).getByText(LABELS[status])).toBeVisible();

    const glyph = (pill as HTMLElement).querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    unmount();
  });

  it('exposes the status on data-status', () => {
    render(<StatusPill status="in_review" />);
    expect(screen.getByText('In review').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'in_review',
    );
  });
});
