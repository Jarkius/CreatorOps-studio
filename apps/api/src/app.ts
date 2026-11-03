import { REQUEST_ID_HEADER, type ErrorCode, type FieldIssue } from '@creatorops/contracts';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import type { Db } from './db/client.js';
import { createAuthGuard } from './modules/identity/guard.js';
import { registerIdentityRoutes } from './modules/identity/routes.js';
import { createWorkspaceScope } from './modules/identity/scope.js';
import { createAssetDeps } from './modules/assets/deps.js';
import { registerAssetRoutes, registerSignedRoutes } from './modules/assets/routes.js';
import { registerProductRoutes } from './modules/products/routes.js';
import { registerWorkspaceRoutes } from './modules/workspace/routes.js';
import type { ApiConfig } from './platform/config.js';
import { AppError, STATUS_BY_CODE, toErrorBody } from './platform/errors.js';
import type { Logger } from './platform/logger.js';
import { generateRequestId } from './platform/request-id.js';
import { installRoutePolicy } from './platform/route-policy.js';
import type { Storage } from './storage/storage.js';
import { registerHealthRoutes } from './routes/health.js';

export interface AppOptions {
  readonly config: ApiConfig;
  readonly logger: Logger;
  readonly db: Db;
  readonly storage: Storage;
  /** Requests per minute per client address. Defaults to 300. */
  readonly rateLimitMax?: number;
  /** Uploads per minute per client address (the PUT to a signed upload URL). Defaults to 30. */
  readonly uploadRateLimitMax?: number;
  /** Maximum JSON body size in bytes. Defaults to 1 MiB. */
  readonly bodyLimit?: number;
  /** Extra routes, used by tests. Registered before the app is ready. */
  readonly registerRoutes?: (app: FastifyInstance) => void;
}

const ALLOWED_HEADERS = ['authorization', 'content-type', 'idempotency-key', REQUEST_ID_HEADER];
const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/** Converts a JSON pointer such as "/sellingPoints/0" to a dotted path "sellingPoints.0". */
function toDottedPath(instancePath: string): string {
  return instancePath.replace(/^\//, '').replaceAll('/', '.');
}

function validationFields(error: FastifyError): FieldIssue[] {
  if (!hasZodFastifySchemaValidationErrors(error)) return [];
  return error.validation.map((entry) => ({
    path: toDottedPath(entry.instancePath),
    message: entry.message ?? 'Invalid value',
  }));
}

/** Maps any thrown value to an API error without exposing internals. */
function classify(error: unknown): {
  code: ErrorCode;
  message: string;
  fields?: FieldIssue[];
  currentVersion?: number;
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: [...error.fields] }),
      ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
    };
  }

  const fastifyError = error as FastifyError;
  if (hasZodFastifySchemaValidationErrors(fastifyError)) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'The request is not valid.',
      fields: validationFields(fastifyError),
    };
  }

  switch (fastifyError.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' };
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type.' };
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
      return { code: 'BAD_REQUEST', message: 'The request body is malformed.' };
    default:
      break;
  }

  const status = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
  if (status >= 400 && status < 500)
    return { code: 'BAD_REQUEST', message: 'The request is not valid.' };
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, logger } = options;

  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    genReqId: (request) => generateRequestId(request.headers),
    requestIdHeader: false,
    // Trust X-Forwarded-For only from the configured number of proxies; never blindly.
    trustProxy:
      config.TRUST_PROXY_HOPS > 0
        ? (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS
        : false,
    bodyLimit: options.bodyLimit ?? 1_048_576,
  });

  // Secure by default: install before any route so every /api/v1 route is checked (and recorded).
  installRoutePolicy(app);
  app.decorateRequest('auth', null);
  app.decorateRequest('workspace', null);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Correlation id and baseline security headers on every response, including errors.
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  app.addHook('onSend', (_request, reply, _payload, done) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('referrer-policy', 'no-referrer');
    // Private API responses are never cached; routes that set their own policy (signed media) win.
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    done();
  });

  const allowedOrigins = new Set<string>([config.WEB_ORIGIN]);
  if (config.EXTENSION_ORIGIN !== undefined) allowedOrigins.add(config.EXTENSION_ORIGIN);

  // Explicit allow-list only: no wildcard, and no credentials (bearer-only auth, D-027).
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowedOrigins.has(origin) ? origin : false);
    },
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: [REQUEST_ID_HEADER, 'retry-after'],
    credentials: false,
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () =>
      new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'),
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'CreatorOps Studio API', version: '0.1.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
    transform: jsonSchemaTransform,
  });

  // Unknown routes count against the rate limit too, so probing cannot bypass it.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) => {
    void reply
      .code(STATUS_BY_CODE.NOT_FOUND)
      .send(toErrorBody('NOT_FOUND', 'The requested resource was not found.', request.id));
  });

  app.setErrorHandler((error, request, reply) => {
    const { code, message, fields, currentVersion } = classify(error);
    const status = STATUS_BY_CODE[code];

    if (isResponseSerializationError(error) || status >= 500) {
      request.log.error({ event: 'request.failed', err: error }, 'request failed');
    } else {
      request.log.info({ event: 'request.rejected', code, status }, 'request rejected');
    }

    void reply
      .code(isResponseSerializationError(error) ? 500 : status)
      .send(
        isResponseSerializationError(error)
          ? toErrorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.', request.id)
          : toErrorBody(code, message, request.id, fields, { currentVersion }),
      );
  });

  registerHealthRoutes(app);
  const guard = createAuthGuard({ db: options.db, sessionSecret: config.SESSION_SECRET });
  const scope = createWorkspaceScope({ db: options.db });
  registerIdentityRoutes(app, { config, db: options.db, guard });
  registerWorkspaceRoutes(app, { db: options.db, guard, scope });
  registerProductRoutes(app, { db: options.db, guard, scope });
  const assetDeps = createAssetDeps({
    db: options.db,
    storage: options.storage,
    sessionSecret: config.SESSION_SECRET,
  });
  registerAssetRoutes(app, { deps: assetDeps, guard, scope });
  registerSignedRoutes(app, assetDeps, {
    ...(options.uploadRateLimitMax === undefined
      ? {}
      : { uploadsPerMinute: options.uploadRateLimitMax }),
  });
  app.get('/api/v1/openapi.json', { schema: { hide: true } }, () => app.swagger());
  options.registerRoutes?.(app);

  await app.ready();
  return app;
}
