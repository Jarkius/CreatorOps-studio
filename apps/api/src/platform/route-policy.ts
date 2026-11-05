import type { FastifyInstance, RouteOptions } from 'fastify';

/** Set on the auth guard hook so the policy below can recognise it among a route's hooks. */
export const AUTH_GUARD_MARKER = Symbol('creatorops.authGuard');
/** Set on the workspace scope hook for the same reason. */
export const WORKSPACE_SCOPE_MARKER = Symbol('creatorops.workspaceScope');

/**
 * Routes that need no authentication. Everything else under /api/v1 must use the auth guard.
 * Adding a route here is a security decision: review it as one.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/v1/health',
  'GET /api/v1/openapi.json',
  'POST /api/v1/auth/mock-token',
  // Authorised by a signed URL (D-038, D-039), each with its own signature tests.
  'PUT /api/v1/uploads/:intentId',
  'GET /api/v1/media/:assetId/:variant',
  'GET /api/v1/exports/:exportId/download',
]);

export interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
  readonly isPublic: boolean;
  /** True when the URL contains :workspaceId. */
  readonly isWorkspaceScoped: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every /api/v1 route that was registered, for tests and tooling. */
    registeredRoutes: readonly RegisteredRoute[];
  }
}

const API_PREFIX = '/api/v1/';
const WORKSPACE_PARAM = /\/workspaces\/:workspaceId(\/|$)/;

function hooksOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value as unknown[];
  return value === undefined ? [] : [value];
}

function hasMarker(value: unknown, marker: symbol): boolean {
  return (
    typeof value === 'function' && (value as unknown as Record<symbol, unknown>)[marker] === true
  );
}

/**
 * Secure by default. Install it before any route is registered. A route under /api/v1 that is
 * neither listed as public nor protected by the auth guard (and, for /workspaces/:workspaceId
 * routes, the workspace scope hook) makes the app refuse to start, so a forgotten guard can never
 * ship. It also records every route so the authorization test harness can walk them all.
 */
export function installRoutePolicy(app: FastifyInstance): void {
  const registry: RegisteredRoute[] = [];
  app.decorate('registeredRoutes', registry);

  app.addHook('onRoute', (route: RouteOptions) => {
    if (!route.url.startsWith(API_PREFIX)) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];

    for (const method of methods) {
      // Fastify adds a HEAD twin for every GET; it is governed by the GET rule.
      const effective = method === 'HEAD' ? 'GET' : method;
      const key = `${effective} ${route.url}`;
      const isPublic = PUBLIC_ROUTES.has(key);
      const isWorkspaceScoped = WORKSPACE_PARAM.test(route.url);

      if (!isPublic) {
        if (!hooksOf(route.onRequest).some((hook) => hasMarker(hook, AUTH_GUARD_MARKER))) {
          throw new Error(
            `Route ${key} is not listed in PUBLIC_ROUTES and does not use the auth guard (onRequest).`,
          );
        }
        if (
          isWorkspaceScoped &&
          !hooksOf(route.preValidation).some((hook) => hasMarker(hook, WORKSPACE_SCOPE_MARKER))
        ) {
          throw new Error(
            `Route ${key} contains :workspaceId but does not use the workspace scope hook (preValidation).`,
          );
        }
      }
      if (method !== 'HEAD')
        registry.push({ method: effective, url: route.url, isPublic, isWorkspaceScoped });
    }
  });
}
