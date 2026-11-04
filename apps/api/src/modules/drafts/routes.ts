import {
  DraftListQuerySchema,
  DraftListResponseSchema,
  DraftParamsSchema,
  DraftSchema,
  UpdateDraftRequestSchema,
  WorkspaceParamsSchema,
} from '@creatorops/contracts';
import type {
  FastifyInstance,
  FastifyRequest,
  onRequestAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import type { RequestContext } from '../identity/context.js';
import { getDraft, listDrafts, updateDraft } from './service.js';

export interface DraftRouteOptions {
  readonly db: Db;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

export function registerDraftRoutes(app: FastifyInstance, options: DraftRouteOptions): void {
  const { db, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/workspaces/:workspaceId/drafts';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['drafts'];
  const security = [{ bearerAuth: [] }];

  typed.get(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'List drafts, newest first (optionally for one campaign)',
        security,
        params: WorkspaceParamsSchema,
        querystring: DraftListQuerySchema,
        response: { 200: DraftListResponseSchema },
      },
    },
    (request) => listDrafts(db, contextOf(request), request.query),
  );

  typed.get(
    `${base}/:draftId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Get a draft',
        security,
        params: DraftParamsSchema,
        response: { 200: DraftSchema },
      },
    },
    (request) => getDraft(db, contextOf(request), request.params.draftId),
  );

  typed.patch(
    `${base}/:draftId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Edit sections of a draft (send the version you last saw)',
        security,
        params: DraftParamsSchema,
        body: UpdateDraftRequestSchema,
        response: { 200: DraftSchema },
      },
    },
    (request) => updateDraft(db, contextOf(request), request.params.draftId, request.body),
  );
}
