import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import { WORKSPACE_SCOPE_MARKER } from '../../platform/route-policy.js';
import { resolveWorkspaceContext } from './service.js';

/**
 * Builds the preValidation hook for `/workspaces/:workspaceId/...` routes (D-025). It runs after
 * authentication and before body validation, so a caller who is not a member gets 404 whatever
 * they send, and learns nothing about the route's schema or the workspace's existence. A
 * malformed id, an unknown id, and a workspace the caller is not in all answer the same way.
 */
export function createWorkspaceScope(options: { readonly db: Db }): preValidationAsyncHookHandler {
  const workspaceScope: preValidationAsyncHookHandler = async function workspaceScope(
    request: FastifyRequest,
  ): Promise<void> {
    const auth = request.auth;
    if (auth === null) throw new AppError('UNAUTHENTICATED', 'Authentication is required.');

    const { workspaceId } = request.params as { workspaceId?: unknown };
    const context =
      typeof workspaceId === 'string'
        ? await resolveWorkspaceContext(options.db, auth.userId, workspaceId, request.id)
        : null;
    if (context === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
    request.workspace = context;
  };

  return Object.assign(workspaceScope, { [WORKSPACE_SCOPE_MARKER]: true as const });
}
