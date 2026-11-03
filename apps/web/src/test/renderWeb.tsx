import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { createDashboardClient } from '../api/client.js';
import type { SessionResult } from '../api/session.js';
import { DashboardContext } from '../app/dashboard-context.js';
import { routes } from '../app/routes.js';
import type { FakeApi } from './fakeApi.js';

const READY: SessionResult = { status: 'ready', error: null, retry: undefined };

/**
 * Renders the real route table (Layout and pages) in a memory router, with the fake API injected
 * through the typed client. Nothing is mocked at module level.
 */
export function renderWeb(path: string, api: FakeApi) {
  const client = createDashboardClient({
    baseUrl: 'http://api.test',
    getToken: () => 'test-token',
    fetch: api.fetch,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DashboardContext.Provider value={{ client, session: READY }}>
        <RouterProvider router={router} />
      </DashboardContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient };
}
