import type { ErrorBody, ErrorCode, FieldIssue } from '@creatorops/contracts';

/** HTTP status used for each error code. */
export const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * An error whose message is safe to show to the client. Anything that is not an AppError is
 * treated as unexpected and reported as a generic INTERNAL_ERROR.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: readonly FieldIssue[] | undefined;

  constructor(code: ErrorCode, message: string, fields?: readonly FieldIssue[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = fields;
  }
}

export function toErrorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  fields?: readonly FieldIssue[],
): ErrorBody {
  const body: ErrorBody = { error: { code, message, requestId } };
  if (fields !== undefined && fields.length > 0) body.error.details = { fields: [...fields] };
  return body;
}
