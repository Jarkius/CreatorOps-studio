import type { z } from 'zod';

import {
  AssetListResponseSchema,
  AssetSchema,
  DeleteAssetResponseSchema,
  UploadIntentSchema,
  type Asset,
  type AssetListQuery,
  type AssetListResponse,
  type CompleteUploadRequest,
  type CreateUploadIntentRequest,
  type DeleteAssetResponse,
  type UploadIntent,
} from './asset.js';
import { MeResponseSchema, MockTokenResponseSchema } from './auth.js';
import {
  ProviderCheckResponseSchema,
  ProviderSettingsSchema,
  type ProviderCheckResponse,
  type ProviderSettings,
  type PutProviderSettingsRequest,
} from './provider.js';
import {
  CampaignCostSchema,
  CostReportSchema,
  ManualCostSchema,
  type CampaignCost,
  type CostReport,
  type CostReportQuery,
  type CreateManualCostRequest,
  type ManualCost,
} from './campaign-cost.js';
import { UsageSummarySchema, type UsageSummary } from './usage.js';
import type { MeResponse, MockTokenResponse } from './auth.js';
import {
  CampaignListResponseSchema,
  CampaignSchema,
  DraftListResponseSchema,
  DraftSchema,
  IDEMPOTENCY_KEY_HEADER,
  JobListResponseSchema,
  JobSchema,
  TemplateListResponseSchema,
  type Campaign,
  type CampaignListQuery,
  type CampaignListResponse,
  type CreateCampaignRequest,
  type Draft,
  type DraftListQuery,
  type DraftListResponse,
  type GenerateBriefJobRequest,
  type Job,
  type JobListQuery,
  type JobListResponse,
  type RegenerateSectionJobRequest,
  type TemplateListResponse,
  type UpdateCampaignRequest,
  type UpdateDraftRequest,
} from './content.js';
import {
  DraftAssetListResponseSchema,
  ExportDownloadSchema,
  ExportListResponseSchema,
  ExportSchema,
  type CreateExportRequest,
  type DraftAssetListResponse,
  type Export,
  type ExportDownload,
  type ExportListQuery,
  type ExportListResponse,
  type SetDraftAssetsRequest,
} from './export.js';
import {
  ProductListResponseSchema,
  ProductSchema,
  type CreateProductRequest,
  type Product,
  type ProductListQuery,
  type ProductListResponse,
  type UpdateProductRequest,
} from './product.js';
import {
  WorkspaceListResponseSchema,
  WorkspaceSchema,
  type CreateWorkspaceRequest,
  type Workspace,
  type WorkspaceListResponse,
} from './workspace.js';
import { ErrorBodySchema, REQUEST_ID_HEADER } from './errors.js';
import type { ErrorCode, FieldIssue } from './errors.js';
import { HealthResponseSchema } from './health.js';
import type { HealthResponse } from './health.js';

/** Codes produced by the client itself, in addition to the API's own error codes. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE';

/**
 * Every failure of an API call. `message` is safe to show to a user and never contains the
 * bearer token. `requestId` (when the server answered) helps support trace the request.
 */
export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly fields: readonly FieldIssue[];
  /** On 409 from a versioned update: the version the server holds now. */
  readonly currentVersion: number | undefined;

  constructor(init: {
    code: ClientErrorCode;
    message: string;
    status?: number;
    requestId?: string | undefined;
    fields?: readonly FieldIssue[];
    currentVersion?: number | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status ?? 0;
    this.requestId = init.requestId;
    this.fields = init.fields ?? [];
    this.currentVersion = init.currentVersion;
  }

  /** True when retrying the same request later could succeed. */
  get retryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.code === 'RATE_LIMITED' ||
      this.status >= 500
    );
  }
}

export interface ApiClientOptions {
  /** Origin of the API, for example http://localhost:3000. A trailing slash is ignored. */
  readonly baseUrl: string;
  /** Returns the bearer token to send, or null for anonymous calls. Called on every request. */
  readonly getToken?: () => string | null | Promise<string | null>;
  /** Defaults to the global fetch. Tests inject a fake. */
  readonly fetch?: typeof fetch;
  /** Milliseconds before a request is abandoned. Defaults to 15000. */
  readonly timeoutMs?: number;
}

export interface ApiClient {
  health(): Promise<HealthResponse>;
  /** Development only: exchanges nothing for a token for the seeded user (mock auth mode). */
  mockToken(): Promise<MockTokenResponse>;
  me(): Promise<MeResponse>;
  /** Turns an API-relative URL (an asset `url`, an `uploadUrl`) into an absolute one. */
  resolveUrl(path: string): string;
  workspaces: {
    list(): Promise<WorkspaceListResponse>;
    create(body: CreateWorkspaceRequest): Promise<Workspace>;
    get(workspaceId: string): Promise<Workspace>;
  };
  products: {
    list(workspaceId: string, query?: ProductListQuery): Promise<ProductListResponse>;
    create(workspaceId: string, body: CreateProductRequest): Promise<Product>;
    get(workspaceId: string, productId: string): Promise<Product>;
    /** Send the `version` you last saw; a stale one fails with code CONFLICT and `currentVersion`. */
    update(workspaceId: string, productId: string, body: UpdateProductRequest): Promise<Product>;
    archive(workspaceId: string, productId: string): Promise<Product>;
    unarchive(workspaceId: string, productId: string): Promise<Product>;
  };
  templates: {
    list(workspaceId: string): Promise<TemplateListResponse>;
  };
  campaigns: {
    list(workspaceId: string, query?: CampaignListQuery): Promise<CampaignListResponse>;
    create(workspaceId: string, body: CreateCampaignRequest): Promise<Campaign>;
    get(workspaceId: string, campaignId: string): Promise<Campaign>;
    /** Send the `version` you last saw; a stale one fails with code CONFLICT and `currentVersion`. */
    update(workspaceId: string, campaignId: string, body: UpdateCampaignRequest): Promise<Campaign>;
    /** What the campaign cost in baht: AI text from the ledger plus hand-typed lines. */
    cost(workspaceId: string, campaignId: string): Promise<CampaignCost>;
    addCost(
      workspaceId: string,
      campaignId: string,
      body: CreateManualCostRequest,
    ): Promise<ManualCost>;
    /** Answers with the campaign cost that is left. */
    removeCost(workspaceId: string, campaignId: string, costId: string): Promise<CampaignCost>;
  };
  drafts: {
    list(workspaceId: string, query?: DraftListQuery): Promise<DraftListResponse>;
    get(workspaceId: string, draftId: string): Promise<Draft>;
    /** Send the `version` you last saw; a stale one fails with code CONFLICT and `currentVersion`. */
    update(workspaceId: string, draftId: string, body: UpdateDraftRequest): Promise<Draft>;
    /** The files attached to a draft, in package order, each with its scene and AI label. */
    listAssets(workspaceId: string, draftId: string): Promise<DraftAssetListResponse>;
    /** Replaces the whole ordered list of attachments in one call (attach, detach, reorder). */
    setAssets(
      workspaceId: string,
      draftId: string,
      body: SetDraftAssetsRequest,
    ): Promise<DraftAssetListResponse>;
  };
  jobs: {
    list(workspaceId: string, query?: JobListQuery): Promise<JobListResponse>;
    get(workspaceId: string, jobId: string): Promise<Job>;
    /** A queued job is cancelled at once; a running one is asked to stop. */
    cancel(workspaceId: string, jobId: string): Promise<Job>;
    /**
     * Starts generating a campaign's drafts. Make one `idempotencyKey` per user action (8 to 128
     * letters, digits, `_` or `-`) and reuse it only to retry that same action: the same key and
     * request return the original job, a new key starts a new job.
     */
    generateBrief(
      workspaceId: string,
      body: GenerateBriefJobRequest,
      idempotencyKey: string,
    ): Promise<Job>;
    /** Same key rules as `generateBrief`. `expectedRev` is the section revision the user saw. */
    regenerateSection(
      workspaceId: string,
      body: RegenerateSectionJobRequest,
      idempotencyKey: string,
    ): Promise<Job>;
    /**
     * Builds a ZIP package of a draft (text, checklist and attached files). Same key rules as
     * `generateBrief`. `draftVersion` is the version the user saw; a newer one fails with CONFLICT.
     */
    exportPackage(
      workspaceId: string,
      body: CreateExportRequest,
      idempotencyKey: string,
    ): Promise<Job>;
  };
  providerSettings: {
    /** The key is never returned, only its last four characters. */
    get(workspaceId: string): Promise<ProviderSettings>;
    /** Owner or admin. Send `version` when changing saved settings; leave `apiKey` out to keep the key. */
    save(workspaceId: string, body: PutProviderSettingsRequest): Promise<ProviderSettings>;
    remove(workspaceId: string): Promise<ProviderSettings>;
    /** One free read-only call to the provider; never generates anything. */
    check(workspaceId: string): Promise<ProviderCheckResponse>;
  };
  usage: {
    /** Real-provider calls and cost for the current calendar month (UTC). */
    get(workspaceId: string): Promise<UsageSummary>;
  };
  costs: {
    /** What the workspace spent in a month (default this month), per campaign, in baht. */
    report(workspaceId: string, query?: CostReportQuery): Promise<CostReport>;
  };
  exports: {
    list(workspaceId: string, query?: ExportListQuery): Promise<ExportListResponse>;
    get(workspaceId: string, exportId: string): Promise<Export>;
    /** A signed URL (relative to the API origin) that works for five minutes. */
    downloadUrl(workspaceId: string, exportId: string): Promise<ExportDownload>;
  };
  assets: {
    /** Step 1 of an upload: declare the file; then PUT the bytes to `uploadUrl`. */
    createUploadIntent(workspaceId: string, body: CreateUploadIntentRequest): Promise<UploadIntent>;
    /** Step 3: after the PUT succeeded, turn the intent into an asset. Safe to repeat. */
    completeUpload(workspaceId: string, body: CompleteUploadRequest): Promise<Asset>;
    list(workspaceId: string, query?: AssetListQuery): Promise<AssetListResponse>;
    get(workspaceId: string, assetId: string): Promise<Asset>;
    delete(workspaceId: string, assetId: string): Promise<DeleteAssetResponse>;
  };
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestSpec<S extends z.ZodType> {
  readonly method: Method;
  readonly path: string;
  readonly schema: S;
  readonly authenticated: boolean;
  readonly body?: unknown;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Reads a JSON body; a body that is not valid JSON yields undefined, but an abort propagates. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    return undefined;
  }
}

function queryString(query: RequestSpec<z.ZodType>['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

function genericMessage(status: number): string {
  if (status === 401) return 'You are not signed in.';
  if (status === 403) return 'You do not have access to this.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return 'The request could not be completed.';
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.infer<S>> {
    const { method, schema, authenticated } = spec;
    const headers: Record<string, string> = { accept: 'application/json' };
    // Only send a content type when there is a body; an empty JSON body is rejected by the API.
    if (spec.body !== undefined) headers['content-type'] = 'application/json';
    if (spec.extraHeaders) Object.assign(headers, spec.extraHeaders);
    if (authenticated) {
      const token = await options.getToken?.();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let payload: unknown;
    try {
      response = await doFetch(`${baseUrl}${spec.path}${queryString(spec.query)}`, {
        method,
        headers,
        signal: controller.signal,
        ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
      });
      // The timer stays armed until the body has been read, so a server that sends headers and
      // then stalls still times out.
      payload = await readJson(response);
    } catch (error) {
      const aborted = isAbort(error);
      throw new ApiError({
        code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: aborted
          ? 'The server took too long to respond. Please try again.'
          : 'Could not reach the server. Check your connection and try again.',
      });
    } finally {
      clearTimeout(timer);
    }

    const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;

    if (!response.ok) {
      const parsed = ErrorBodySchema.safeParse(payload);
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new ApiError({
          code,
          message,
          status: response.status,
          requestId: parsed.data.error.requestId,
          fields: details?.fields ?? [],
          currentVersion: details?.currentVersion,
        });
      }
      throw new ApiError({
        code: response.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message: genericMessage(response.status),
        status: response.status,
        requestId,
      });
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError({
        code: 'INVALID_RESPONSE',
        message: 'The server sent an unexpected response.',
        status: response.status,
        requestId,
      });
    }
    return parsed.data;
  }

  const get = <S extends z.ZodType>(path: string, schema: S, query?: RequestSpec<S>['query']) =>
    request({ method: 'GET', path, schema, authenticated: true, ...(query ? { query } : {}) });
  const send = <S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ) =>
    request({
      method,
      path,
      schema,
      authenticated: true,
      ...(body === undefined ? {} : { body }),
      ...(extraHeaders === undefined ? {} : { extraHeaders }),
    });
  const id = encodeURIComponent;
  const products = (workspaceId: string) => `/api/v1/workspaces/${id(workspaceId)}/products`;
  const base = (workspaceId: string) => `/api/v1/workspaces/${id(workspaceId)}`;
  const assetsPath = (workspaceId: string) => `/api/v1/workspaces/${id(workspaceId)}/assets`;

  return {
    resolveUrl: (path) => new URL(path, `${baseUrl}/`).toString(),
    health: () =>
      request({
        method: 'GET',
        path: '/api/v1/health',
        schema: HealthResponseSchema,
        authenticated: false,
      }),
    mockToken: () =>
      request({
        method: 'POST',
        path: '/api/v1/auth/mock-token',
        schema: MockTokenResponseSchema,
        authenticated: false,
      }),
    me: () => get('/api/v1/me', MeResponseSchema),
    workspaces: {
      list: () => get('/api/v1/workspaces', WorkspaceListResponseSchema),
      create: (body) => send('POST', '/api/v1/workspaces', WorkspaceSchema, body),
      get: (workspaceId) => get(`/api/v1/workspaces/${id(workspaceId)}`, WorkspaceSchema),
    },
    products: {
      list: (workspaceId, query) =>
        get(products(workspaceId), ProductListResponseSchema, query as RequestSpec<never>['query']),
      create: (workspaceId, body) => send('POST', products(workspaceId), ProductSchema, body),
      get: (workspaceId, productId) =>
        get(`${products(workspaceId)}/${id(productId)}`, ProductSchema),
      update: (workspaceId, productId, body) =>
        send('PATCH', `${products(workspaceId)}/${id(productId)}`, ProductSchema, body),
      archive: (workspaceId, productId) =>
        send('POST', `${products(workspaceId)}/${id(productId)}/archive`, ProductSchema),
      unarchive: (workspaceId, productId) =>
        send('POST', `${products(workspaceId)}/${id(productId)}/unarchive`, ProductSchema),
    },
    templates: {
      list: (workspaceId) => get(`${base(workspaceId)}/templates`, TemplateListResponseSchema),
    },
    campaigns: {
      list: (workspaceId, query) =>
        get(
          `${base(workspaceId)}/campaigns`,
          CampaignListResponseSchema,
          query as RequestSpec<never>['query'],
        ),
      create: (workspaceId, body) =>
        send('POST', `${base(workspaceId)}/campaigns`, CampaignSchema, body),
      get: (workspaceId, campaignId) =>
        get(`${base(workspaceId)}/campaigns/${id(campaignId)}`, CampaignSchema),
      update: (workspaceId, campaignId, body) =>
        send('PATCH', `${base(workspaceId)}/campaigns/${id(campaignId)}`, CampaignSchema, body),
      cost: (workspaceId, campaignId) =>
        get(`${base(workspaceId)}/campaigns/${id(campaignId)}/cost`, CampaignCostSchema),
      addCost: (workspaceId, campaignId, body) =>
        send(
          'POST',
          `${base(workspaceId)}/campaigns/${id(campaignId)}/costs`,
          ManualCostSchema,
          body,
        ),
      removeCost: (workspaceId, campaignId, costId) =>
        send(
          'DELETE',
          `${base(workspaceId)}/campaigns/${id(campaignId)}/costs/${id(costId)}`,
          CampaignCostSchema,
        ),
    },
    drafts: {
      list: (workspaceId, query) =>
        get(
          `${base(workspaceId)}/drafts`,
          DraftListResponseSchema,
          query as RequestSpec<never>['query'],
        ),
      get: (workspaceId, draftId) => get(`${base(workspaceId)}/drafts/${id(draftId)}`, DraftSchema),
      update: (workspaceId, draftId, body) =>
        send('PATCH', `${base(workspaceId)}/drafts/${id(draftId)}`, DraftSchema, body),
      listAssets: (workspaceId, draftId) =>
        get(`${base(workspaceId)}/drafts/${id(draftId)}/assets`, DraftAssetListResponseSchema),
      setAssets: (workspaceId, draftId, body) =>
        send(
          'PUT',
          `${base(workspaceId)}/drafts/${id(draftId)}/assets`,
          DraftAssetListResponseSchema,
          body,
        ),
    },
    jobs: {
      list: (workspaceId, query) =>
        get(
          `${base(workspaceId)}/jobs`,
          JobListResponseSchema,
          query as RequestSpec<never>['query'],
        ),
      get: (workspaceId, jobId) => get(`${base(workspaceId)}/jobs/${id(jobId)}`, JobSchema),
      cancel: (workspaceId, jobId) =>
        send('POST', `${base(workspaceId)}/jobs/${id(jobId)}/cancel`, JobSchema),
      generateBrief: (workspaceId, body, idempotencyKey) =>
        send('POST', `${base(workspaceId)}/jobs/generate-brief`, JobSchema, body, {
          [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        }),
      regenerateSection: (workspaceId, body, idempotencyKey) =>
        send('POST', `${base(workspaceId)}/jobs/regenerate-section`, JobSchema, body, {
          [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        }),
      exportPackage: (workspaceId, body, idempotencyKey) =>
        send('POST', `${base(workspaceId)}/jobs/export-package`, JobSchema, body, {
          [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        }),
    },
    providerSettings: {
      get: (workspaceId) => get(`${base(workspaceId)}/provider-settings`, ProviderSettingsSchema),
      save: (workspaceId, body) =>
        send('PUT', `${base(workspaceId)}/provider-settings`, ProviderSettingsSchema, body),
      remove: (workspaceId) =>
        send('DELETE', `${base(workspaceId)}/provider-settings`, ProviderSettingsSchema),
      check: (workspaceId) =>
        send('POST', `${base(workspaceId)}/provider-settings/check`, ProviderCheckResponseSchema),
    },
    usage: {
      get: (workspaceId) => get(`${base(workspaceId)}/usage`, UsageSummarySchema),
    },
    costs: {
      report: (workspaceId, query) =>
        get(
          `${base(workspaceId)}/cost-report`,
          CostReportSchema,
          query as RequestSpec<never>['query'],
        ),
    },
    exports: {
      list: (workspaceId, query) =>
        get(
          `${base(workspaceId)}/exports`,
          ExportListResponseSchema,
          query as RequestSpec<never>['query'],
        ),
      get: (workspaceId, exportId) =>
        get(`${base(workspaceId)}/exports/${id(exportId)}`, ExportSchema),
      downloadUrl: (workspaceId, exportId) =>
        send(
          'POST',
          `${base(workspaceId)}/exports/${id(exportId)}/download-url`,
          ExportDownloadSchema,
        ),
    },
    assets: {
      createUploadIntent: (workspaceId, body) =>
        send('POST', `${assetsPath(workspaceId)}/upload-intent`, UploadIntentSchema, body),
      completeUpload: (workspaceId, body) =>
        send('POST', `${assetsPath(workspaceId)}/complete-upload`, AssetSchema, body),
      list: (workspaceId, query) =>
        get(assetsPath(workspaceId), AssetListResponseSchema, query as RequestSpec<never>['query']),
      get: (workspaceId, assetId) => get(`${assetsPath(workspaceId)}/${id(assetId)}`, AssetSchema),
      delete: (workspaceId, assetId) =>
        send('DELETE', `${assetsPath(workspaceId)}/${id(assetId)}`, DeleteAssetResponseSchema),
    },
  };
}
