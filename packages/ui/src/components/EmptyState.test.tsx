import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders a heading, description and action', () => {
    render(
      <EmptyState
        title="No products yet"
        description="Add your first product to start."
        action={<button type="button">Add product</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No products yet' })).toBeInTheDocument();
    expect(screen.getByText('Add your first product to start.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument();
  });

  it('renders without optional parts', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
