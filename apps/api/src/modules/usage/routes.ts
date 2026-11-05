import {
  ProviderSettingsParamsSchema,
  UsageSummarySchema,
  type UsageSummary,
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
import { findCredential } from '../provider-settings/repo.js';
import { monthSummary } from './ledger.js';

export interface UsageRouteOptions {
  readonly db: Db;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

/** This month's real-provider usage of one workspace. Any member may read it. */
export async function getUsageSummary(db: Db, ctx: RequestContext): Promise<UsageSummary> {
  const [summary, credential] = await Promise.all([
    monthSummary(db, ctx.workspaceId),
    findCredential(db, ctx),
  ]);
  const capUsd = credential?.monthlyCapUsd == null ? null : Number(credential.monthlyCapUsd);
  return {
    ...summary,
    byModel: [...summary.byModel],
    capUsd,
    countedUsd: summary.spentUsd + summary.reservedUsd,
  };
}

export function registerUsageRoutes(app: FastifyInstance, options: UsageRouteOptions): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/workspaces/:workspaceId/usage',
    {
      onRequest: options.guard,
      preValidation: options.scope,
      schema: {
        tags: ['provider'],
        summary: 'Real-provider usage and cost this month',
        security: [{ bearerAuth: [] }],
        params: ProviderSettingsParamsSchema,
        response: { 200: UsageSummarySchema },
      },
    },
    (request) => getUsageSummary(options.db, contextOf(request)),
  );
}
