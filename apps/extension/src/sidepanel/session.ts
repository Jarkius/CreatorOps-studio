import { ApiError, createApiClient, type ApiClient, type MeResponse } from '@creatorops/contracts';

import type { TokenStore } from './token-store.js';

export interface SessionClientOptions {
  readonly baseUrl: string;
  readonly store: TokenStore;
  /** True in development builds, where the API offers a mock-token endpoint. */
  readonly mockAuth: boolean;
  readonly fetch?: typeof fetch;
}

export interface SessionClient {
  readonly api: ApiClient;
  /** Loads the signed-in user, signing in (mock mode) or re-signing in once if the token expired. */
  loadMe(): Promise<MeResponse>;
}

/**
 * The panel is a thin client: it keeps only a token, and asks the API who the user is. If the
 * stored token is missing or rejected it asks for a new development token once, then gives up
 * with a readable error instead of looping.
 */
export function createSessionClient(options: SessionClientOptions): SessionClient {
  const { store, mockAuth } = options;
  const api = createApiClient({
    baseUrl: options.baseUrl,
    getToken: () => store.get(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  async function signIn(): Promise<void> {
    if (!mockAuth) {
      throw new ApiError({
        code: 'UNAUTHENTICATED',
        message: 'Sign-in is not configured yet.',
        status: 401,
      });
    }
    const { token } = await api.mockToken();
    await store.set(token);
  }

  async function loadMe(): Promise<MeResponse> {
    if ((await store.get()) === null) await signIn();
    try {
      return await api.me();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
        await store.clear();
        await signIn();
        return api.me();
      }
      throw error;
    }
  }

  return { api, loadMe };
}
