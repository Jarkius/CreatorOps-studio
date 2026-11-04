import type { FastifyInstance } from 'fastify';

/**
 * Walks every registered /api/v1 route and checks it against a caller who must not have access
 * (D-025). For each non-public route:
 *  - without a token it must answer 401, even when the body is invalid (authentication runs
 *    before validation, so a stranger learns nothing about the route's schema);
 *  - with the attacker's token and path parameters that belong to someone else's workspace it
 *    must answer 404, never 200, 403 or a validation error.
 * A route that takes no path parameter acts on the caller's own data and must be declared in
 * `selfScoped`. A route whose parameters have no fixture fails the harness, so a new route cannot
 * be added without its authorization test.
 */
export interface HarnessFixtures {
  /** Values for path parameters that belong to a workspace the attacker is NOT a member of. */
  readonly foreignParams: Readonly<Record<string, string>>;
  /** Valid sample request bodies, keyed `METHOD /url/with/:params`. */
  readonly bodies?: Readonly<Record<string, unknown>>;
  /** Routes without path parameters that act only on the caller's own data. */
  readonly selfScoped: ReadonlySet<string>;
}

export interface HarnessReport {
  readonly checked: readonly string[];
  readonly failures: readonly string[];
}

function paramNames(url: string): string[] {
  return [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '');
}

function fill(url: string, values: Readonly<Record<string, string>>): string | null {
  let missing = false;
  const filled = url.replace(/:([A-Za-z0-9_]+)/g, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing = true;
      return name;
    }
    return encodeURIComponent(value);
  });
  return missing ? null : filled;
}

export async function runAuthorizationHarness(
  app: FastifyInstance,
  attackerToken: string,
  fixtures: HarnessFixtures,
): Promise<HarnessReport> {
  const checked: string[] = [];
  const failures: string[] = [];

  for (const route of app.registeredRoutes) {
    if (route.isPublic) continue;
    const key = `${route.method} ${route.url}`;
    checked.push(key);

    const names = paramNames(route.url);
    const method = route.method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    const sampleBody = fixtures.bodies?.[key];
    const hasBody = method !== 'GET' && method !== 'DELETE';

    // 1) No token: always 401, even with a body the schema would reject.
    const anonymousUrl =
      fill(route.url, Object.fromEntries(names.map((name) => [name, 'x']))) ?? route.url;
    const anonymous = await app.inject({
      method,
      url: anonymousUrl,
      ...(hasBody ? { payload: { definitely: 'not valid' } } : {}),
    });
    if (anonymous.statusCode !== 401) {
      failures.push(`${key}: expected 401 without a token, got ${anonymous.statusCode}`);
    }

    // 2) Attacker's token.
    if (names.length === 0) {
      if (!fixtures.selfScoped.has(key)) {
        failures.push(
          `${key}: has no path parameters and is not declared selfScoped; review it, then declare it`,
        );
      }
      continue;
    }
    const url = fill(route.url, fixtures.foreignParams);
    if (url === null) {
      failures.push(`${key}: no foreign fixture for parameters ${names.join(', ')}`);
      continue;
    }
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${attackerToken}` },
      ...(hasBody ? { payload: sampleBody ?? {} } : {}),
    });
    if (response.statusCode !== 404) {
      failures.push(
        `${key}: expected 404 for a foreign workspace's ids, got ${response.statusCode}`,
      );
    }
  }
  return { checked, failures };
}

/**
 * Role check (D-025 follow-up): a read-only member (viewer or reviewer) of a workspace must get
 * 403 on every route that changes data inside that workspace. The sample ids belong to the
 * workspace the caller IS a member of, so a 404 would mean the route never reached its permission
 * check, and a 2xx or 4xx other than 403 means the route lets a read-only member through.
 * Routes with no workspace path parameter (such as creating a workspace) are not in scope.
 */
export async function runReadOnlyMemberHarness(
  app: FastifyInstance,
  readOnlyToken: string,
  fixtures: Pick<HarnessFixtures, 'bodies'> & {
    /** Path parameter values for the workspace the caller is a read-only member of. */
    readonly ownParams: Readonly<Record<string, string>>;
  },
): Promise<HarnessReport> {
  const checked: string[] = [];
  const failures: string[] = [];

  for (const route of app.registeredRoutes) {
    if (route.isPublic) continue;
    if (route.method === 'GET' || route.method === 'HEAD' || route.method === 'OPTIONS') continue;
    const names = paramNames(route.url);
    if (!names.includes('workspaceId')) continue;
    const key = `${route.method} ${route.url}`;
    checked.push(key);

    const url = fill(route.url, fixtures.ownParams);
    if (url === null) {
      failures.push(`${key}: no fixture for parameters ${names.join(', ')}`);
      continue;
    }
    const method = route.method as 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${readOnlyToken}` },
      ...(method === 'DELETE' ? {} : { payload: fixtures.bodies?.[key] ?? {} }),
    });
    if (response.statusCode !== 403) {
      failures.push(`${key}: expected 403 for a read-only member, got ${response.statusCode}`);
    }
  }
  return { checked, failures };
}
