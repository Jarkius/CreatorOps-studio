import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LoadingState } from './LoadingState.js';

describe('LoadingState', () => {
  it('announces the default label politely with role status', () => {
    render(<LoadingState />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Loading…');
  });

  it('shows a custom label', () => {
    render(<LoadingState label="Signing in…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Signing in…');
  });
});
