import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { Workspace } from '@creatorops/contracts';

import { createDashboardClient } from '../../api/client.js';
import type { SessionResult } from '../../api/session.js';
import { DashboardContext } from '../../app/dashboard-context.js';
import { createFakeApi, WORKSPACE } from '../../test/fakeApi.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { useCanWrite } from './useCanWrite.js';

const READY: SessionResult = { status: 'ready', error: null, retry: undefined };

function wrapperFor(role: Workspace['role']) {
  const api = createFakeApi({ workspaces: [{ ...WORKSPACE, role }] });
  const client = createDashboardClient({
    baseUrl: 'http://api.test',
    getToken: () => 'test-token',
    fetch: api.fetch,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <DashboardContext.Provider value={{ client, session: READY }}>
          {children}
        </DashboardContext.Provider>
      </QueryClientProvider>
    );
  };
}

function renderCanWrite(role: Workspace['role']) {
  return renderHook(() => ({ canWrite: useCanWrite(WORKSPACE.id), workspaces: useWorkspaces() }), {
    wrapper: wrapperFor(role),
  });
}

describe('useCanWrite', () => {
  it.each(['owner', 'admin', 'editor'] as const)('is true for %s', async (role) => {
    const { result } = renderCanWrite(role);
    await waitFor(() => expect(result.current.workspaces.data).toBeDefined());
    expect(result.current.canWrite).toBe(true);
  });

  it.each(['reviewer', 'viewer'] as const)('is false for %s', async (role) => {
    const { result } = renderCanWrite(role);
    await waitFor(() => expect(result.current.workspaces.data).toBeDefined());
    expect(result.current.canWrite).toBe(false);
  });

  it('is false while the workspace list is still loading', () => {
    const { result } = renderCanWrite('owner');
    expect(result.current.workspaces.data).toBeUndefined();
    expect(result.current.canWrite).toBe(false);
  });
});
