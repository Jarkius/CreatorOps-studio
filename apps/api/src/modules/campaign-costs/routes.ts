import {
  CampaignCostItemParamsSchema,
  CampaignCostParamsSchema,
  CampaignCostSchema,
  CostReportQuerySchema,
  CostReportSchema,
  CreateManualCostRequestSchema,
  ProviderSettingsParamsSchema,
  ManualCostSchema,
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
import { addManualCost, getCampaignCost, getCostReport, removeManualCost } from './service.js';

export interface CampaignCostRouteOptions {
  readonly db: Db;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

export function registerCampaignCostRoutes(
  app: FastifyInstance,
  options: CampaignCostRouteOptions,
): void {
  const { db, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/workspaces/:workspaceId/campaigns/:campaignId';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['campaigns'];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/api/v1/workspaces/:workspaceId/cost-report',
    {
      ...common,
      schema: {
        tags,
        summary: 'What the workspace spent in one month, per campaign, in baht',
        security,
        params: ProviderSettingsParamsSchema,
        querystring: CostReportQuerySchema,
        response: { 200: CostReportSchema },
      },
    },
    (request) => getCostReport(db, contextOf(request), request.query),
  );

  typed.get(
    `${base}/cost`,
    {
      ...common,
      schema: {
        tags,
        summary:
          'What a campaign cost in baht: AI text from the usage ledger plus hand-typed costs',
        security,
        params: CampaignCostParamsSchema,
        response: { 200: CampaignCostSchema },
      },
    },
    (request) => getCampaignCost(db, contextOf(request), request.params.campaignId),
  );

  typed.post(
    `${base}/costs`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Add a hand-typed cost line (a scene or tool cost) in baht',
        security,
        params: CampaignCostParamsSchema,
        body: CreateManualCostRequestSchema,
        response: { 201: ManualCostSchema },
      },
    },
    async (request, reply) => {
      const created = await addManualCost(
        db,
        contextOf(request),
        request.params.campaignId,
        request.body,
      );
      return reply.code(201).send(created);
    },
  );

  typed.delete(
    `${base}/costs/:costId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Remove a hand-typed cost line; answers with the campaign cost that is left',
        security,
        params: CampaignCostItemParamsSchema,
        response: { 200: CampaignCostSchema },
      },
    },
    async (request) => {
      const ctx = contextOf(request);
      await removeManualCost(db, ctx, request.params.campaignId, request.params.costId);
      return getCampaignCost(db, ctx, request.params.campaignId);
    },
  );
}
