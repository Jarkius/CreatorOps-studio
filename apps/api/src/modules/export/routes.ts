import {
  ExportDownloadSchema,
  ExportListQuerySchema,
  ExportListResponseSchema,
  ExportParamsSchema,
  ExportSchema,
  WorkspaceParamsSchema,
} from '@creatorops/contracts';
import type {
  FastifyInstance,
  FastifyRequest,
  onRequestAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError } from '../../platform/errors.js';
import type { RequestContext } from '../identity/context.js';
import {
  createDownloadUrl,
  getExport,
  listExports,
  readExport,
  type ExportDeps,
} from './service.js';

export interface ExportRouteOptions {
  readonly deps: ExportDeps;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

export function registerExportRoutes(app: FastifyInstance, options: ExportRouteOptions): void {
  const { deps, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/workspaces/:workspaceId/exports';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['exports'];
  const security = [{ bearerAuth: [] }];

  typed.get(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'List export packages',
        security,
        params: WorkspaceParamsSchema,
        querystring: ExportListQuerySchema,
        response: { 200: ExportListResponseSchema },
      },
    },
    (request) => listExports(deps, contextOf(request), request.query),
  );

  typed.get(
    `${base}/:exportId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Get an export package',
        security,
        params: ExportParamsSchema,
        response: { 200: ExportSchema },
      },
    },
    (request) => getExport(deps, contextOf(request), request.params.exportId),
  );

  typed.post(
    `${base}/:exportId/download-url`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Get a signed download link that works for five minutes',
        security,
        params: ExportParamsSchema,
        response: { 200: ExportDownloadSchema },
      },
    },
    (request) => createDownloadUrl(deps, contextOf(request), request.params.exportId),
  );
}

const SignedQuery = z
  .object({ u: z.string().max(64), exp: z.string().max(20), sig: z.string().max(100) })
  .strict();

/** Authorised by the signed URL (PUBLIC_ROUTES), with its own tampered, expired and replay tests. */
export function registerExportDownloadRoute(app: FastifyInstance, deps: ExportDeps): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/exports/:exportId/download',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['exports'],
        summary: 'Download a package with a signed URL',
        params: z.object({ exportId: z.string().max(64) }),
        querystring: SignedQuery,
      },
    },
    async (request, reply) => {
      const result = await readExport(deps, {
        exportId: request.params.exportId,
        userId: request.query.u,
        exp: request.query.exp,
        sig: request.query.sig,
      });
      for (const [name, value] of Object.entries(result.headers)) void reply.header(name, value);
      return reply.send(result.stream);
    },
  );
}
