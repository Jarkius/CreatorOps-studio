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

export {
  MeResponseSchema,
  MembershipSchema,
  MockTokenResponseSchema,
  UserSchema,
  WORKSPACE_ROLE_VALUES,
  WorkspaceRoleSchema,
} from './auth.js';
export type {
  MeResponse,
  Membership,
  MockTokenResponse,
  User,
  WorkspaceRoleValue,
} from './auth.js';

export { ApiError, createApiClient } from './client.js';
export type { ApiClient, ApiClientOptions, ClientErrorCode } from './client.js';
