export const PACKAGE_NAME = '@creatorops/contracts';

export {
  ERROR_CODES,
  ErrorBodySchema,
  ErrorCodeSchema,
  FieldIssueSchema,
  REQUEST_ID_HEADER,
} from './errors.js';
export type { ErrorBody, ErrorCode, FieldIssue } from './errors.js';

export { HealthResponseSchema } from './health.js';
export type { HealthResponse } from './health.js';
