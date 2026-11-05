import {
  ProviderCheckResponseSchema,
  ProviderSettingsParamsSchema,
  ProviderSettingsSchema,
  PutProviderSettingsRequestSchema,
} from '@creatorops/contracts';
import type {
  FastifyInstance,
  FastifyRequest,
  onRequestAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { AppError } from '../../platform/errors.js';
import type { RequestContext } from '../identity/context.js';
import {
  checkProviderSettings,
  deleteProviderSettings,
  getProviderSettings,
  putProviderSettings,
  type ProviderSettingsDeps,
} from './service.js';

export interface ProviderSettingsRouteOptions {
  readonly deps: ProviderSettingsDeps;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
  /** Saves and checks per minute per client address. Default 20 and 10. */
  readonly writesPerMinute?: number;
  readonly checksPerMinute?: number;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

export function registerProviderSettingsRoutes(
  app: FastifyInstance,
  options: ProviderSettingsRouteOptions,
): void {
  const { deps, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const url = '/api/v1/workspaces/:workspaceId/provider-settings';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['provider'];
  const security = [{ bearerAuth: [] }];

  typed.get(
    url,
    {
      ...common,
      schema: {
        tags,
        summary: 'Read the text provider settings (the key is never returned)',
        security,
        params: ProviderSettingsParamsSchema,
        response: { 200: ProviderSettingsSchema },
      },
    },
    (request) => getProviderSettings(deps, contextOf(request)),
  );

  typed.put(
    url,
    {
      ...common,
      config: { rateLimit: { max: options.writesPerMinute ?? 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Save the text provider, model, key, prices and monthly limit (owner or admin)',
        security,
        params: ProviderSettingsParamsSchema,
        body: PutProviderSettingsRequestSchema,
        response: { 200: ProviderSettingsSchema },
      },
    },
    (request) => putProviderSettings(deps, contextOf(request), request.body),
  );

  typed.delete(
    url,
    {
      ...common,
      schema: {
        tags,
        summary: 'Remove the saved provider and key (owner or admin)',
        security,
        params: ProviderSettingsParamsSchema,
        response: { 200: ProviderSettingsSchema },
      },
    },
    (request) => deleteProviderSettings(deps, contextOf(request)),
  );

  typed.post(
    `${url}/check`,
    {
      ...common,
      config: { rateLimit: { max: options.checksPerMinute ?? 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Check the connection with one free read-only call (owner or admin)',
        security,
        params: ProviderSettingsParamsSchema,
        response: { 200: ProviderCheckResponseSchema },
      },
    },
    (request) => checkProviderSettings(deps, contextOf(request)),
  );
}
