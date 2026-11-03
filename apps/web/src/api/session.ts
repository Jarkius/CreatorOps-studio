import { useCallback, useEffect, useState } from 'react';

import type { ApiClient } from '@creatorops/contracts';

export type AuthMode = 'mock' | 'none';

/**
 * Holds the bearer token in memory only. It is never written to localStorage, sessionStorage,
 * cookies or the URL, so a reload signs the user out again.
 */
export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export function createTokenStore(): TokenStore {
  let token: string | null = null;
  return {
    get: () => token,
    set: (next) => {
      token = next;
    },
    clear: () => {
      token = null;
    },
  };
}

/** Raised when the build has no sign-in method (production auth is a later decision). */
export class SignInUnavailableError extends Error {
  constructor() {
    super('Sign-in is not configured yet.');
    this.name = 'SignInUnavailableError';
  }
}

export type SessionStatus = 'loading' | 'ready' | 'error';

export interface SessionResult {
  status: SessionStatus;
  error: unknown;
  /** Present only when a retry can succeed (development sign-in). */
  retry: (() => void) | undefined;
}

interface SessionOptions {
  readonly client: ApiClient;
  readonly tokenStore: TokenStore;
  readonly authMode: AuthMode;
}

type SessionState =
  | { status: 'loading'; error: null }
  | { status: 'ready'; error: null }
  | { status: 'error'; error: unknown };

const LOADING: SessionState = { status: 'loading', error: null };

/**
 * Development sign-in: exchanges nothing for the seeded user's token once per attempt and keeps
 * it in memory. Without mock mode it reports that sign-in is not configured.
 */
export function useSession({ client, tokenStore, authMode }: SessionOptions): SessionResult {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SessionState>(() =>
    authMode === 'mock' ? LOADING : { status: 'error', error: new SignInUnavailableError() },
  );

  useEffect(() => {
    if (authMode !== 'mock') return undefined;
    let active = true;
    client.mockToken().then(
      (result) => {
        if (!active) return;
        tokenStore.set(result.token);
        setState({ status: 'ready', error: null });
      },
      (error: unknown) => {
        if (!active) return;
        tokenStore.clear();
        setState({ status: 'error', error });
      },
    );
    return () => {
      active = false;
    };
  }, [client, tokenStore, authMode, attempt]);

  const retry = useCallback(() => {
    setState(LOADING);
    setAttempt((value) => value + 1);
  }, []);

  return {
    status: state.status,
    error: state.error,
    retry: authMode === 'mock' ? retry : undefined,
  };
}
