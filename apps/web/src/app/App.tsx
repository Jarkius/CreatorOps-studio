import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router';

import type { ApiClient } from '@creatorops/contracts';

import { useSession } from '../api/session.js';
import type { AuthMode, TokenStore } from '../api/session.js';
import { DashboardContext } from './dashboard-context.js';
import type { DashboardContextValue } from './dashboard-context.js';
import { routes } from './routes.js';

export interface AppProps {
  readonly client: ApiClient;
  readonly tokenStore: TokenStore;
  readonly authMode: AuthMode;
}

export function App({ client, tokenStore, authMode }: AppProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  const [router] = useState(() => createBrowserRouter(routes));
  const session = useSession({ client, tokenStore, authMode });
  const value: DashboardContextValue = { client, session };

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContext.Provider value={value}>
        <RouterProvider router={router} />
      </DashboardContext.Provider>
    </QueryClientProvider>
  );
}
