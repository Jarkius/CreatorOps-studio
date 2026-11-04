import {
  DraftAssetListResponseSchema,
  DraftAssetsParamsSchema,
  SetDraftAssetsRequestSchema,
} from '@creatorops/contracts';
import type {
  FastifyInstance,
  FastifyRequest,
  onRequestAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { AppError } from '../../platform/errors.js';
import type { AssetDeps } from '../assets/service.js';
import type { RequestContext } from '../identity/context.js';
import { listDraftAssets, setDraftAssets } from './service.js';

export interface DraftAssetRouteOptions {
  readonly deps: AssetDeps;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

export function registerDraftAssetRoutes(
  app: FastifyInstance,
  options: DraftAssetRouteOptions,
): void {
  const { deps, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const url = '/api/v1/workspaces/:workspaceId/drafts/:draftId/assets';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['drafts'];
  const security = [{ bearerAuth: [] }];

  typed.get(
    url,
    {
      ...common,
      schema: {
        tags,
        summary: 'List the files attached to a draft, in package order',
        security,
        params: DraftAssetsParamsSchema,
        response: { 200: DraftAssetListResponseSchema },
      },
    },
    (request) => listDraftAssets(deps, contextOf(request), request.params.draftId),
  );

  typed.put(
    url,
    {
      ...common,
      schema: {
        tags,
        summary:
          'Replace the draft attachments with an ordered list (attach, detach, reorder, cover)',
        security,
        params: DraftAssetsParamsSchema,
        body: SetDraftAssetsRequestSchema,
        response: { 200: DraftAssetListResponseSchema },
      },
    },
    (request) => setDraftAssets(deps, contextOf(request), request.params.draftId, request.body),
  );
}
