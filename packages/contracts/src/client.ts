import type { z } from 'zod';

import { MeResponseSchema, MockTokenResponseSchema } from './auth.js';
import type { MeResponse, MockTokenResponse } from './auth.js';
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

  constructor(init: {
    code: ClientErrorCode;
    message: string;
    status?: number;
    requestId?: string | undefined;
    fields?: readonly FieldIssue[];
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status ?? 0;
    this.requestId = init.requestId;
    this.fields = init.fields ?? [];
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

  async function request<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    authenticated: boolean,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (authenticated) {
      const token = await options.getToken?.();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let payload: unknown;
    try {
      response = await doFetch(`${baseUrl}${path}`, { method, headers, signal: controller.signal });
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

  return {
    health: () => request('GET', '/api/v1/health', HealthResponseSchema, false),
    mockToken: () => request('POST', '/api/v1/auth/mock-token', MockTokenResponseSchema, false),
    me: () => request('GET', '/api/v1/me', MeResponseSchema, true),
  };
}
