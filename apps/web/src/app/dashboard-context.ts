import { createContext, useContext } from 'react';

import type { ApiClient } from '@creatorops/contracts';

import type { SessionResult } from '../api/session.js';

export interface DashboardContextValue {
  readonly client: ApiClient;
  readonly session: SessionResult;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (value === null) throw new Error('useDashboard must be used inside <App>.');
  return value;
}
