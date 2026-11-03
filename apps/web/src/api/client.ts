import { createApiClient } from '@creatorops/contracts';
import type { ApiClient } from '@creatorops/contracts';

export interface DashboardClientOptions {
  readonly baseUrl: string;
  /** Returns the in-memory bearer token, or null when signed out. */
  readonly getToken: () => string | null;
  /** Injected by tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

/** Builds the typed API client used by every dashboard query. */
export function createDashboardClient(options: DashboardClientOptions): ApiClient {
  return createApiClient({
    baseUrl: options.baseUrl,
    getToken: options.getToken,
    fetch: options.fetch,
  });
}
