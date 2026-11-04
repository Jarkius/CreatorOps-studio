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

export { isTerminalJobStatus, pollDelayMs } from './jobPolling.js';

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

export {
  CAMPAIGN_STATUS_VALUES,
  CLAIM_WARNING_KIND_VALUES,
  CONTENT_LIMITS,
  CampaignListQuerySchema,
  CampaignListItemSchema,
  CampaignListResponseSchema,
  CampaignParamsSchema,
  CampaignSchema,
  CampaignStatusSchema,
  ClaimWarningKindSchema,
  ClaimWarningSchema,
  CreateCampaignRequestSchema,
  CreateJobResponseSchema,
  DRAFT_STATUS_VALUES,
  DraftListQuerySchema,
  DraftListResponseSchema,
  DraftParamsSchema,
  DraftSchema,
  DraftSectionsSchema,
  DraftStatusSchema,
  GenerateBriefJobRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeySchema,
  JOB_ERROR_CODES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  JobErrorCodeSchema,
  JobListQuerySchema,
  JobListResponseSchema,
  JobParamsSchema,
  JobSchema,
  JobStatusSchema,
  JobTypeSchema,
  PLATFORM_VALUES,
  PlatformSchema,
  RegenerateSectionJobRequestSchema,
  SECTION_NAMES,
  SECTION_ORIGIN_VALUES,
  SectionNameSchema,
  SectionOriginSchema,
  SectionStateSchema,
  TemplateListResponseSchema,
  TemplateSchema,
  UpdateCampaignRequestSchema,
  UpdateDraftRequestSchema,
} from './content.js';
export type {
  Campaign,
  CampaignListQuery,
  CampaignListQueryParsed,
  CampaignListItem,
  CampaignListResponse,
  CampaignParams,
  CampaignStatus,
  ClaimWarning,
  ClaimWarningKind,
  CreateCampaignRequest,
  CreateJobResponse,
  Draft,
  DraftListQuery,
  DraftListQueryParsed,
  DraftListResponse,
  DraftParams,
  DraftSections,
  DraftStatus,
  GenerateBriefJobRequest,
  Job,
  JobErrorCode,
  JobListQuery,
  JobListQueryParsed,
  JobListResponse,
  JobParams,
  JobStatus,
  JobType,
  Platform,
  RegenerateSectionJobRequest,
  SectionName,
  SectionOrigin,
  SectionState,
  Template,
  TemplateListResponse,
  UpdateCampaignRequest,
  UpdateDraftRequest,
} from './content.js';

export * from './export.js';
