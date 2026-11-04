import {
  CampaignListQuerySchema,
  CampaignListResponseSchema,
  CampaignParamsSchema,
  CampaignSchema,
  CreateCampaignRequestSchema,
  TemplateListResponseSchema,
  UpdateCampaignRequestSchema,
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
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  listTemplateItems,
  updateCampaign,
} from './service.js';

export interface CampaignRouteOptions {
  readonly db: Db;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

export function registerCampaignRoutes(app: FastifyInstance, options: CampaignRouteOptions): void {
  const { db, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/workspaces/:workspaceId/campaigns';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['campaigns'];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/api/v1/workspaces/:workspaceId/templates',
    {
      ...common,
      schema: {
        tags,
        summary: 'List product templates',
        security,
        params: WorkspaceParamsSchema,
        response: { 200: TemplateListResponseSchema },
      },
    },
    () => listTemplateItems(),
  );

  typed.get(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'List campaigns',
        security,
        params: WorkspaceParamsSchema,
        querystring: CampaignListQuerySchema,
        response: { 200: CampaignListResponseSchema },
      },
    },
    (request) => listCampaigns(db, contextOf(request), request.query),
  );

  typed.post(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'Create a campaign for a product',
        security,
        params: WorkspaceParamsSchema,
        body: CreateCampaignRequestSchema,
        response: { 201: CampaignSchema },
      },
    },
    async (request, reply) => {
      const campaign = await createCampaign(db, contextOf(request), request.body);
      return reply.code(201).send(campaign);
    },
  );

  typed.get(
    `${base}/:campaignId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Get a campaign',
        security,
        params: CampaignParamsSchema,
        response: { 200: CampaignSchema },
      },
    },
    (request) => getCampaign(db, contextOf(request), request.params.campaignId),
  );

  typed.patch(
    `${base}/:campaignId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Update a campaign (send the version you last saw)',
        security,
        params: CampaignParamsSchema,
        body: UpdateCampaignRequestSchema,
        response: { 200: CampaignSchema },
      },
    },
    (request) => updateCampaign(db, contextOf(request), request.params.campaignId, request.body),
  );
}
