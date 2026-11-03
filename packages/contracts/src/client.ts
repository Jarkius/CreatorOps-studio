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
import type { MeResponse, MockTokenResponse } from './auth.js';
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestSpec<S extends z.ZodType> {
  readonly method: Method;
  readonly path: string;
  readonly schema: S;
  readonly authenticated: boolean;
  readonly body?: unknown;
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
  const send = <S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown) =>
    request({ method, path, schema, authenticated: true, ...(body === undefined ? {} : { body }) });
  const id = encodeURIComponent;
  const products = (workspaceId: string) => `/api/v1/workspaces/${id(workspaceId)}/products`;
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
