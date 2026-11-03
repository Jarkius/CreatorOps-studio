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

export {
  CreateWorkspaceRequestSchema,
  LANGUAGE_VALUES,
  LanguageSchema,
  WorkspaceListResponseSchema,
  WorkspaceParamsSchema,
  WorkspaceSchema,
} from './workspace.js';
export type {
  CreateWorkspaceRequest,
  Language,
  Workspace,
  WorkspaceListResponse,
} from './workspace.js';

export {
  CreateProductRequestSchema,
  PRODUCT_LIMITS,
  PRODUCT_STATUS_VALUES,
  ProductListQuerySchema,
  ProductListResponseSchema,
  ProductParamsSchema,
  ProductSchema,
  ProductStatusSchema,
  UpdateProductRequestSchema,
} from './product.js';
export type {
  CreateProductRequest,
  Product,
  ProductListQuery,
  ProductListQueryParsed,
  ProductListResponse,
  ProductStatus,
  UpdateProductRequest,
} from './product.js';

export {
  ASSET_LIMITS,
  ASSET_TYPE_VALUES,
  AssetListQuerySchema,
  AssetListResponseSchema,
  AssetParamsSchema,
  AssetSchema,
  AssetTypeSchema,
  CompleteUploadRequestSchema,
  CreateUploadIntentRequestSchema,
  DeleteAssetResponseSchema,
  UPLOAD_MIME_VALUES,
  UploadIntentSchema,
  UploadMimeSchema,
} from './asset.js';
export type {
  Asset,
  AssetListQuery,
  AssetListQueryParsed,
  AssetListResponse,
  AssetType,
  CompleteUploadRequest,
  CreateUploadIntentRequest,
  DeleteAssetResponse,
  UploadIntent,
  UploadMime,
} from './asset.js';
