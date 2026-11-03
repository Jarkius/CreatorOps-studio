import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { Layout } from './Layout.js';

describe('Layout', () => {
  it('starts with a skip link that targets the main landmark', () => {
    const router = createMemoryRouter(
      [{ path: '/', element: <Layout />, children: [{ index: true, element: <p>Body</p> }] }],
      {
        initialEntries: ['/'],
      },
    );
    render(<RouterProvider router={router} />);

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByText('CreatorOps Studio')).toBeInTheDocument();
  });
});
