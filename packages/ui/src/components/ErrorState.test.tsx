import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState } from './ErrorState.js';

describe('ErrorState', () => {
  it('is an alert with the message and request reference', () => {
    render(<ErrorState message="Could not load." requestId="req-123" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent('Could not load.');
    expect(alert).toHaveTextContent('Reference: req-123');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls the retry handler once and shows the retrying state', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState message="Failed." onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ErrorState message="Failed." onRetry={onRetry} retrying />);
    const retrying = screen.getByRole('button', { name: 'Trying again…' });
    expect(retrying).toBeDisabled();
  });
});
