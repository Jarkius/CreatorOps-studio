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
import { assertCanManageProvider } from '../identity/permissions.js';
import { recordAuditEvent } from '../audit/repo.js';
import { acknowledgeAnomalies, hasCostHold, monthSummary } from './ledger.js';

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
  const [summary, credential, costHold] = await Promise.all([
    monthSummary(db, ctx.workspaceId),
    findCredential(db, ctx),
    hasCostHold(db, ctx.workspaceId),
  ]);
  const capUsd = credential?.monthlyCapUsd == null ? null : Number(credential.monthlyCapUsd);
  return {
    ...summary,
    byModel: [...summary.byModel],
    capUsd,
    countedUsd: summary.spentUsd + summary.reservedUsd,
    costHold,
  };
}

/**
 * Owner or admin: says they have seen the calls that cost far more than expected, which lets new
 * real-provider calls run again. Recorded in the audit trail with how many were cleared.
 */
export async function acknowledgeUsageAnomalies(
  db: Db,
  ctx: RequestContext,
): Promise<UsageSummary> {
  assertCanManageProvider(ctx);
  await db.transaction(async (tx) => {
    const cleared = await acknowledgeAnomalies(tx, ctx.workspaceId);
    if (cleared > 0) {
      await recordAuditEvent(tx, ctx, {
        action: 'usage.anomalies_acknowledged',
        resourceType: 'usage',
        resourceId: ctx.workspaceId,
        metadata: { cleared },
      });
    }
  });
  return getUsageSummary(db, ctx);
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

  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/workspaces/:workspaceId/usage/acknowledge-anomalies',
    {
      onRequest: options.guard,
      preValidation: options.scope,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['provider'],
        summary: 'Clear the hold after a cost anomaly (owner or admin)',
        security: [{ bearerAuth: [] }],
        params: ProviderSettingsParamsSchema,
        response: { 200: UsageSummarySchema },
      },
    },
    (request) => acknowledgeUsageAnomalies(options.db, contextOf(request)),
  );
}
