import {
  ErrorBodySchema,
  HealthResponseSchema,
  REQUEST_ID_HEADER,
  type ErrorBody,
} from '@creatorops/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from './platform/errors.js';
import { makeApp, type MakeAppOverrides, type TestApp } from './test/app-helpers.js';

const WEB_ORIGIN = 'http://localhost:5173';
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const EVIL_ORIGIN = 'https://evil.example';
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const itemBody = z.object({ name: z.string().min(1), tags: z.array(z.string()) });

/** Test-only routes. Only registered when a test passes them through registerRoutes. */
function registerTestRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/test/items', { schema: { body: itemBody } }, () => ({ ok: true as const }));

  typed.get('/test/conflict', () => {
    throw new AppError('CONFLICT', 'Already exists');
  });

  typed.get('/test/boom', () => {
    throw new Error('db password is hunter2');
  });

  typed.get(
    '/test/bad-response',
    { schema: { response: { 200: z.object({ ok: z.literal(true) }) } } },
    () => {
      const wrong: unknown = { ok: false };
      return wrong as { ok: true };
    },
  );
}

function headerOf(response: { readonly headers: Record<string, unknown> }, name: string) {
  const value = response.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function errorBodyOf(response: { readonly body: string }): ErrorBody {
  return ErrorBodySchema.parse(JSON.parse(response.body));
}

describe('app', () => {
  const opened: TestApp[] = [];

  afterEach(async () => {
    await Promise.all(opened.splice(0).map(({ app }) => app.close()));
  });

  async function open(overrides?: MakeAppOverrides): Promise<TestApp> {
    const created = await makeApp(overrides);
    opened.push(created);
    return created;
  }

  describe('GET /api/v1/health', () => {
    it('returns 200 with a body that matches HealthResponseSchema', async () => {
      const { app } = await open();

      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(response.statusCode).toBe(200);
      const body = HealthResponseSchema.parse(JSON.parse(response.body));
      expect(body.status).toBe('ok');
      expect(body.service).toBe('creatorops-api');
      expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    });

    it('sets nosniff, no-referrer and no-store headers', async () => {
      const { app } = await open();

      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(headerOf(response, 'x-content-type-options')).toBe('nosniff');
      expect(headerOf(response, 'referrer-policy')).toBe('no-referrer');
      expect(headerOf(response, 'cache-control')).toBe('no-store');
    });
  });

  describe('request correlation id', () => {
    it('sends x-request-id on 200, 404 and error responses', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const ok = await app.inject({ method: 'GET', url: '/api/v1/health' });
      const notFound = await app.inject({ method: 'GET', url: '/no/such/route' });
      const error = await app.inject({ method: 'GET', url: '/test/conflict' });

      for (const response of [ok, notFound, error]) {
        expect(headerOf(response, REQUEST_ID_HEADER)?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('generates a UUID when the request carries no id', async () => {
      const { app } = await open();

      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(headerOf(response, REQUEST_ID_HEADER)).toMatch(UUID_PATTERN);
    });

    it('echoes a valid incoming id', async () => {
      const { app } = await open();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { [REQUEST_ID_HEADER]: 'client-req-12345' },
      });

      expect(headerOf(response, REQUEST_ID_HEADER)).toBe('client-req-12345');
    });

    it.each([
      ['too short', 'short'],
      ['contains spaces', 'has spaces in it'],
      ['contains a newline', 'bad\nid-value-x'],
      ['longer than 64 characters', 'a'.repeat(65)],
    ])('replaces an incoming id that is %s and does not echo it', async (_label, supplied) => {
      const { app } = await open();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { [REQUEST_ID_HEADER]: supplied },
      });

      const generated = headerOf(response, REQUEST_ID_HEADER);
      expect(generated).toMatch(UUID_PATTERN);
      expect(generated).not.toBe(supplied);
    });

    it('records the same id in the request log lines', async () => {
      const { app, logLines } = await open();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { [REQUEST_ID_HEADER]: 'client-req-12345' },
      });

      const id = headerOf(response, REQUEST_ID_HEADER);
      expect(id).toBe('client-req-12345');
      const matching = logLines().filter((line) => line.reqId === id);
      expect(matching.length).toBeGreaterThan(0);
    });
  });

  describe('error responses', () => {
    it('returns 404 NOT_FOUND with requestId matching the header', async () => {
      const { app } = await open();

      const response = await app.inject({ method: 'GET', url: '/no/such/route' });

      expect(response.statusCode).toBe(404);
      const body = errorBodyOf(response);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.requestId).toBe(headerOf(response, REQUEST_ID_HEADER));
    });

    it('maps a thrown AppError to its status and a body with no stack', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({ method: 'GET', url: '/test/conflict' });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body)).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'Already exists',
          requestId: headerOf(response, REQUEST_ID_HEADER),
        },
      });
      expect(response.body).not.toContain('stack');
    });

    it('hides unexpected errors behind a generic INTERNAL_ERROR and logs the failure', async () => {
      const { app, logLines } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({ method: 'GET', url: '/test/boom' });

      expect(response.statusCode).toBe(500);
      const body = errorBodyOf(response);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe(GENERIC_MESSAGE);
      expect(response.body).not.toContain('hunter2');
      expect(response.body).not.toContain('stack');

      const failed = logLines().filter((line) => line.event === 'request.failed');
      expect(failed.length).toBeGreaterThan(0);
    });

    it('reports invalid body fields as VALIDATION_ERROR with dotted paths', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({
        method: 'POST',
        url: '/test/items',
        headers: { 'content-type': 'application/json' },
        payload: { name: '', tags: [1] },
      });

      expect(response.statusCode).toBe(400);
      const body = errorBodyOf(response);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      const fields = body.error.details?.fields ?? [];
      const paths = fields.map((field) => field.path);
      expect(paths).toContain('name');
      expect(paths.some((path) => path.startsWith('tags'))).toBe(true);
      for (const field of fields) {
        expect(typeof field.message).toBe('string');
      }
    });

    it('returns 400 BAD_REQUEST for a malformed JSON body', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({
        method: 'POST',
        url: '/test/items',
        headers: { 'content-type': 'application/json' },
        payload: '{bad',
      });

      expect(response.statusCode).toBe(400);
      expect(errorBodyOf(response).error.code).toBe('BAD_REQUEST');
    });

    it('returns 413 PAYLOAD_TOO_LARGE when the body exceeds bodyLimit', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes, bodyLimit: 100 });
      const payload = JSON.stringify({ name: 'x'.repeat(479), tags: [] });
      expect(Buffer.byteLength(payload)).toBe(500);

      const response = await app.inject({
        method: 'POST',
        url: '/test/items',
        headers: { 'content-type': 'application/json' },
        payload,
      });

      expect(response.statusCode).toBe(413);
      expect(errorBodyOf(response).error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('returns 415 UNSUPPORTED_MEDIA_TYPE for an unsupported content type', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({
        method: 'POST',
        url: '/test/items',
        headers: { 'content-type': 'application/xml' },
        payload: '<item/>',
      });

      expect(response.statusCode).toBe(415);
      expect(errorBodyOf(response).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rate limits after rateLimitMax requests with RATE_LIMITED and retry-after', async () => {
      const { app } = await open({ rateLimitMax: 3 });

      for (let i = 0; i < 3; i += 1) {
        const allowed = await app.inject({ method: 'GET', url: '/api/v1/health' });
        expect(allowed.statusCode).toBe(200);
      }
      const limited = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(limited.statusCode).toBe(429);
      expect(errorBodyOf(limited).error.code).toBe('RATE_LIMITED');
      expect(headerOf(limited, 'retry-after')).toBeDefined();
      expect(headerOf(limited, REQUEST_ID_HEADER)).toBeDefined();
    });

    it('returns 500 INTERNAL_ERROR when a response does not match its schema', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({ method: 'GET', url: '/test/bad-response' });

      expect(response.statusCode).toBe(500);
      const body = errorBodyOf(response);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe(GENERIC_MESSAGE);
    });
  });

  describe('CORS', () => {
    it('allows the configured web origin exactly and varies on Origin', async () => {
      const { app } = await open();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { origin: WEB_ORIGIN },
      });

      expect(headerOf(response, 'access-control-allow-origin')).toBe(WEB_ORIGIN);
      expect(headerOf(response, 'vary')?.toLowerCase()).toContain('origin');
    });

    it('sends no allow-origin header to an unlisted origin', async () => {
      const { app } = await open();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { origin: EVIL_ORIGIN },
      });

      expect(response.statusCode).toBe(200);
      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
    });

    it('never returns a wildcard or credentialed allow headers', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });
      const responses = [
        await app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin: WEB_ORIGIN } }),
        await app.inject({
          method: 'GET',
          url: '/api/v1/health',
          headers: { origin: EVIL_ORIGIN },
        }),
        await app.inject({ method: 'GET', url: '/api/v1/health' }),
        await app.inject({
          method: 'OPTIONS',
          url: '/test/items',
          headers: {
            origin: WEB_ORIGIN,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,content-type',
          },
        }),
      ];

      for (const response of responses) {
        expect(headerOf(response, 'access-control-allow-origin')).not.toBe('*');
        expect(headerOf(response, 'access-control-allow-credentials')).not.toBe('true');
      }
    });

    it('allows the extension origin only when EXTENSION_ORIGIN is configured', async () => {
      const withExtension = await open({ env: { EXTENSION_ORIGIN } });
      const withoutExtension = await open();

      const allowed = await withExtension.app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { origin: EXTENSION_ORIGIN },
      });
      const notAllowed = await withoutExtension.app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { origin: EXTENSION_ORIGIN },
      });

      expect(headerOf(allowed, 'access-control-allow-origin')).toBe(EXTENSION_ORIGIN);
      expect(headerOf(notAllowed, 'access-control-allow-origin')).toBeUndefined();
    });

    it('answers a preflight from the web origin with authorization allowed', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({
        method: 'OPTIONS',
        url: '/test/items',
        headers: {
          origin: WEB_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(200);
      expect(response.statusCode).toBeLessThan(300);
      expect(headerOf(response, 'access-control-allow-origin')).toBe(WEB_ORIGIN);
      expect(headerOf(response, 'access-control-allow-headers')).toContain('authorization');
    });

    it('does not allow a preflight from an unlisted origin', async () => {
      const { app } = await open({ registerRoutes: registerTestRoutes });

      const response = await app.inject({
        method: 'OPTIONS',
        url: '/test/items',
        headers: {
          origin: EVIL_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });

      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
    });

    it('sends no allow-origin header when the request has no Origin', async () => {
      const { app } = await open();

      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
    });
  });

  describe('OpenAPI', () => {
    it('serves a document that lists the health route and matches the snapshot', async () => {
      const { app } = await open();

      const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });

      expect(response.statusCode).toBe(200);
      expect(headerOf(response, 'content-type')).toContain('application/json');
      const body: unknown = JSON.parse(response.body);
      const document = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(body);
      expect(Object.keys(document.paths)).toContain('/api/v1/health');
      await expect(JSON.stringify(body, null, 2)).toMatchFileSnapshot(
        './__snapshots__/openapi.json',
      );
    });
  });
});
