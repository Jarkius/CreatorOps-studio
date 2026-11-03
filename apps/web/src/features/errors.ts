import { ApiError } from '@creatorops/contracts';

const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** A user-safe message and the support reference for any thrown value. */
export function describeError(error: unknown): { message: string; requestId: string | undefined } {
  if (error instanceof ApiError) return { message: error.message, requestId: error.requestId };
  return { message: GENERIC_ERROR, requestId: undefined };
}

/** True when the API said the workspace or product does not exist (or is not visible). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
