import {
  CreateWorkspaceRequestSchema,
  WorkspaceListResponseSchema,
  WorkspaceParamsSchema,
  WorkspaceSchema,
} from '@creatorops/contracts';
import type {
  FastifyInstance,
  onRequestAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import { createWorkspace, getWorkspace, listWorkspacesForUser } from './service.js';

export interface WorkspaceRouteOptions {
  readonly db: Db;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  options: WorkspaceRouteOptions,
): void {
  const { db, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/api/v1/workspaces',
    {
      onRequest: guard,
      schema: {
        tags: ['workspaces'],
        summary: 'Workspaces the signed-in user belongs to',
        security,
        response: { 200: WorkspaceListResponseSchema },
      },
    },
    async (request) => {
      if (request.auth === null)
        throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
      return { items: await listWorkspacesForUser(db, request.auth.userId) };
    },
  );

  typed.post(
    '/api/v1/workspaces',
    {
      onRequest: guard,
      schema: {
        tags: ['workspaces'],
        summary: 'Create a workspace owned by the signed-in user',
        security,
        body: CreateWorkspaceRequestSchema,
        response: { 201: WorkspaceSchema },
      },
    },
    async (request, reply) => {
      if (request.auth === null)
        throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
      const workspace = await createWorkspace(db, request.auth, request.body, request.id);
      return reply.code(201).send(workspace);
    },
  );

  typed.get(
    '/api/v1/workspaces/:workspaceId',
    {
      onRequest: guard,
      preValidation: scope,
      schema: {
        tags: ['workspaces'],
        summary: 'One workspace the signed-in user belongs to',
        security,
        params: WorkspaceParamsSchema,
        response: { 200: WorkspaceSchema },
      },
    },
    async (request) => {
      if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
      return getWorkspace(db, request.workspace);
    },
  );
}
