import {
  AssetListQuerySchema,
  AssetListResponseSchema,
  AssetParamsSchema,
  AssetSchema,
  CompleteUploadRequestSchema,
  CreateUploadIntentRequestSchema,
  DeleteAssetResponseSchema,
  UPLOAD_MIME_VALUES,
  UploadIntentSchema,
  WorkspaceParamsSchema,
} from '@creatorops/contracts';
import type {
  FastifyInstance,
  FastifyRequest,
  onRequestAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Readable } from 'node:stream';
import { z } from 'zod';

import { AppError } from '../../platform/errors.js';
import type { RequestContext } from '../identity/context.js';
import {
  completeUpload,
  createUploadIntent,
  deleteAsset,
  getAsset,
  listAssets,
  readMedia,
  receiveUpload,
  type AssetDeps,
} from './service.js';

export interface AssetRouteOptions {
  readonly deps: AssetDeps;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

/** Bearer-authenticated, workspace-scoped asset routes. */
export function registerAssetRoutes(app: FastifyInstance, options: AssetRouteOptions): void {
  const { deps, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/workspaces/:workspaceId/assets';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['assets'];
  const security = [{ bearerAuth: [] }];

  typed.post(
    `${base}/upload-intent`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Declare a file you are about to upload (step 1)',
        security,
        params: WorkspaceParamsSchema,
        body: CreateUploadIntentRequestSchema,
        response: { 201: UploadIntentSchema },
      },
    },
    async (request, reply) => {
      const intent = await createUploadIntent(deps, contextOf(request), request.body);
      return reply.code(201).send(intent);
    },
  );

  typed.post(
    `${base}/complete-upload`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Finish an upload after the file was sent (step 3); safe to repeat',
        security,
        params: WorkspaceParamsSchema,
        body: CompleteUploadRequestSchema,
        response: { 200: AssetSchema },
      },
    },
    (request) => completeUpload(deps, contextOf(request), request.body),
  );

  typed.get(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'List files',
        security,
        params: WorkspaceParamsSchema,
        querystring: AssetListQuerySchema,
        response: { 200: AssetListResponseSchema },
      },
    },
    (request) => listAssets(deps, contextOf(request), request.query),
  );

  typed.get(
    `${base}/:assetId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Get a file',
        security,
        params: AssetParamsSchema,
        response: { 200: AssetSchema },
      },
    },
    (request) => getAsset(deps, contextOf(request), request.params.assetId),
  );

  typed.delete(
    `${base}/:assetId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Delete a file (removes it from the library; clears it as a cover image)',
        security,
        params: AssetParamsSchema,
        response: { 200: DeleteAssetResponseSchema },
      },
    },
    (request) => deleteAsset(deps, contextOf(request), request.params.assetId),
  );
}

const SignedQuery = z.object({ exp: z.string().max(20), sig: z.string().max(100) }).strict();

/**
 * Routes authorised by a signed URL instead of a bearer token (D-038, D-039). Both are listed in
 * PUBLIC_ROUTES and have their own tests for tampered, expired and replayed signatures.
 */
export interface SignedRouteOptions {
  /** Uploads per minute per client address. Defaults to 30. */
  readonly uploadsPerMinute?: number;
}

export function registerSignedRoutes(
  app: FastifyInstance,
  deps: AssetDeps,
  options: SignedRouteOptions = {},
): void {
  // The upload body is streamed, not buffered, so it gets its own parser in an isolated scope.
  void app.register(async (scoped) => {
    scoped.addContentTypeParser([...UPLOAD_MIME_VALUES], (_request, payload, done) => {
      done(null, payload);
    });

    scoped.withTypeProvider<ZodTypeProvider>().put(
      '/api/v1/uploads/:intentId',
      {
        // Uploads are the expensive route, so they get a tighter limit than the global one.
        config: { rateLimit: { max: options.uploadsPerMinute ?? 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['assets'],
          summary: 'Send the file bytes to a signed upload URL (step 2)',
          params: z.object({ intentId: z.string().max(64) }),
          querystring: SignedQuery,
        },
      },
      async (request, reply) => {
        const length = request.headers['content-length'];
        try {
          await receiveUpload(deps, {
            intentId: request.params.intentId,
            exp: request.query.exp,
            sig: request.query.sig,
            contentType: request.headers['content-type'],
            contentLength: length === undefined ? undefined : Number(length),
            body: request.body as Readable,
          });
        } catch (error) {
          // The body may still be arriving. Closing the connection after this response stops the
          // server from reading (and discarding) an unbounded amount of data from a rejected upload.
          void reply.header('connection', 'close');
          throw error;
        }
        return reply.code(204).send();
      },
    );
  });

  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/media/:assetId/:variant',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['assets'],
        summary: 'Download a file or its thumbnail with a signed URL',
        params: z.object({ assetId: z.string().max(64), variant: z.enum(['original', 'thumb']) }),
        querystring: SignedQuery,
      },
    },
    async (request, reply) => {
      const media = await readMedia(deps, {
        assetId: request.params.assetId,
        variant: request.params.variant,
        exp: request.query.exp,
        sig: request.query.sig,
        range: request.headers.range,
      });
      for (const [name, value] of Object.entries(media.headers)) void reply.header(name, value);
      void reply.code(media.status);
      return media.stream === null ? reply.send() : reply.send(media.stream);
    },
  );
}
