import { MeResponseSchema, MockTokenResponseSchema } from '@creatorops/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Db } from '../../db/client.js';
import { DEV_USER_EMAIL } from '../../db/seed.js';
import type { ApiConfig } from '../../platform/config.js';
import { AppError } from '../../platform/errors.js';
import { createAuthGuard } from './guard.js';
import { allowedMockHosts } from './mock-host.js';
import { findAuthContextByEmail, listMemberships } from './service.js';
import { signToken, TOKEN_TTL_SECONDS } from './token.js';

export interface IdentityRouteOptions {
  readonly config: ApiConfig;
  readonly db: Db;
}

export function registerIdentityRoutes(app: FastifyInstance, options: IdentityRouteOptions): void {
  const { config, db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const guard = createAuthGuard({ db, sessionSecret: config.SESSION_SECRET });
  const mockHosts = allowedMockHosts(config.API_BASE_URL);

  app.decorateRequest('auth', null);

  // Development only (D-027). The route does not exist in any other auth mode, and the API
  // refuses to start with mock auth in production. It only ever issues a token for the seeded
  // development user; it cannot mint a token for any other account.
  if (config.AUTH_MODE === 'mock') {
    typed.post(
      '/api/v1/auth/mock-token',
      {
        schema: {
          tags: ['auth'],
          summary: 'Issue a development token for the seeded user (mock auth only)',
          response: { 200: MockTokenResponseSchema },
        },
      },
      async (request) => {
        const host = request.headers.host?.toLowerCase();
        if (host === undefined || !mockHosts.has(host)) {
          throw new AppError(
            'FORBIDDEN',
            'This endpoint is only available on the local API address.',
          );
        }
        const user = await findAuthContextByEmail(db, DEV_USER_EMAIL);
        if (user === null) {
          throw new AppError('NOT_FOUND', 'The development user does not exist. Run: pnpm db:seed');
        }
        const iat = Math.floor(Date.now() / 1000);
        const exp = iat + TOKEN_TTL_SECONDS;
        return {
          token: signToken({ sub: user.userId, iat, exp }, config.SESSION_SECRET),
          expiresAt: new Date(exp * 1000).toISOString(),
          user: { id: user.userId, email: user.email, displayName: user.displayName },
        };
      },
    );
  }

  typed.get(
    '/api/v1/me',
    {
      preHandler: guard,
      schema: {
        tags: ['auth'],
        summary: 'The signed-in user and their workspaces',
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponseSchema },
      },
    },
    async (request) => {
      const auth = request.auth;
      if (auth === null) throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
      return {
        user: { id: auth.userId, email: auth.email, displayName: auth.displayName },
        workspaces: await listMemberships(db, auth.userId),
      };
    },
  );
}
