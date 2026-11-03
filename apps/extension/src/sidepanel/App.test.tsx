import { ApiError } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { SessionClient } from './session.js';

function renderApp(loadMe: SessionClient['loadMe']) {
  const session = { api: {} as SessionClient['api'], loadMe } satisfies SessionClient;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App session={session} />
    </QueryClientProvider>,
  );
}

const me = (name: string) => ({
  user: { id: 'u1', email: 'dev@creatorops.local', displayName: name },
  workspaces: [],
});

describe('side panel', () => {
  it('shows a loading state, then the signed-in user', async () => {
    renderApp(() => Promise.resolve(me('Dev User')));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByText('Dev User')).toBeInTheDocument();
    expect(screen.getByText('dev@creatorops.local')).toBeInTheDocument();
    expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
  });

  it('renders Thai names whole', async () => {
    renderApp(() => Promise.resolve(me('สมชาย ใจดี')));
    expect(await screen.findByText('สมชาย ใจดี')).toBeInTheDocument();
  });

  it('shows the error with its reference and recovers on retry', async () => {
    const loadMe = vi
      .fn<SessionClient['loadMe']>()
      .mockRejectedValueOnce(
        new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'The server had a problem.',
          status: 500,
          requestId: 'req-42',
        }),
      )
      .mockResolvedValueOnce(me('Dev User'));
    renderApp(loadMe);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server had a problem.');
    expect(alert).toHaveTextContent('Reference: req-42');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Dev User')).toBeInTheDocument();
    await waitFor(() => expect(loadMe).toHaveBeenCalledTimes(2));
  });

  it('opens the dashboard in a new tab without giving it access to the panel', async () => {
    renderApp(() => Promise.resolve(me('Dev User')));
    const link = await screen.findByRole('link', { name: 'Open dashboard' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('href')).toMatch(/^https?:\/\//);
  });

  it('shows a generic message for an unexpected error type', async () => {
    renderApp(() => Promise.reject(new Error('internal detail secret=abc')));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong.');
    expect(alert).not.toHaveTextContent('secret=abc');
  });
});
