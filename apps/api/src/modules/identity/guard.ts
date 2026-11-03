import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import { AUTH_GUARD_MARKER } from '../../platform/route-policy.js';
import type { AuthContext, RequestContext } from './context.js';
import { findAuthContextById } from './service.js';
import { verifyToken } from './token.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guard; null on routes that do not use it. */
    auth: AuthContext | null;
    /** Set by the workspace scope hook on /workspaces/:workspaceId routes; null elsewhere. */
    workspace: RequestContext | null;
  }
}

export interface GuardOptions {
  readonly db: Db;
  readonly sessionSecret: string;
  /** Injectable clock for tests; seconds since the epoch. */
  readonly now?: () => number;
}

function unauthenticated(reply: FastifyReply): AppError {
  void reply.header('www-authenticate', 'Bearer');
  return new AppError('UNAUTHENTICATED', 'Authentication is required.');
}

/**
 * Builds the onRequest hook that authenticates a bearer token and loads the user. It runs before
 * body validation on purpose: an unauthenticated caller must get 401 and learn nothing about the
 * route's request schema.
 *
 * Authenticates a bearer token and loads the user. Every failure
 * (missing header, wrong scheme, bad signature, expiry, unknown user) gives the same 401, so a
 * caller learns nothing about why.
 */
export function createAuthGuard(options: GuardOptions): onRequestAsyncHookHandler {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  const authGuard: onRequestAsyncHookHandler = async function authGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer /i.test(header)) throw unauthenticated(reply);

    const payload = verifyToken(header.slice(7).trim(), options.sessionSecret, now());
    if (payload === null) throw unauthenticated(reply);

    const auth = await findAuthContextById(options.db, payload.sub);
    if (auth === null) throw unauthenticated(reply);

    request.auth = auth;
  };

  return Object.assign(authGuard, { [AUTH_GUARD_MARKER]: true as const });
}
