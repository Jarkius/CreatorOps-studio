import { z } from 'zod';

/** Header carrying the request correlation id, in both directions. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Stable error codes returned by the API (docs/04 section 3). Add codes; never rename them. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const FieldIssueSchema = z.object({
  /** Dotted path of the offending field, for example "sellingPoints.0". Empty for the body root. */
  path: z.string(),
  message: z.string(),
});
export type FieldIssue = z.infer<typeof FieldIssueSchema>;

/** The single error shape of the API: `{ error: { code, message, requestId, details? } }`. */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z
      .object({
        fields: z.array(FieldIssueSchema).optional(),
        /** On 409 CONFLICT from a versioned update: the version the server currently holds. */
        currentVersion: z.number().int().optional(),
      })
      .optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
