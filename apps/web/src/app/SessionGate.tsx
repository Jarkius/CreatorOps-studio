import type { ReactNode } from 'react';

import { ErrorState, LoadingState } from '@creatorops/ui';

import { SignInUnavailableError } from '../api/session.js';
import { useDashboard } from './dashboard-context.js';
import { describeError } from '../features/errors.js';

/** Renders its children only once the development session is ready. */
export function SessionGate({ children }: { children: ReactNode }) {
  const { session } = useDashboard();
  if (session.status === 'loading') return <LoadingState label="Signing in…" />;
  if (session.status === 'error') {
    if (session.error instanceof SignInUnavailableError) {
      return (
        <ErrorState
          title="Sign-in is not configured yet"
          message="Production sign-in is not available in this build. Development builds use VITE_AUTH_MODE=mock."
        />
      );
    }
    const { message, requestId } = describeError(session.error);
    return <ErrorState message={message} requestId={requestId} onRetry={session.retry} />;
  }
  return children;
}
