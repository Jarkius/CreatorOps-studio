import type { Product, Workspace } from '@creatorops/contracts';

export const WORKSPACE: Workspace = {
  id: 'ws_1',
  name: 'Studio One',
  defaultLanguage: 'th',
  brandVoice: null,
  role: 'owner',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

export const SECOND_WORKSPACE: Workspace = { ...WORKSPACE, id: 'ws_2', name: 'Studio Two' };

export const THAI_NAME = 'พัดลมตั้งโต๊ะ';

export function makeProduct(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    workspaceId: WORKSPACE.id,
    description: null,
    sourceUrl: null,
    priceAmount: null,
    currency: null,
    sellingPoints: [],
    targetAudience: null,
    brandTone: null,
    restrictedClaims: [],
    primaryAssetId: null,
    status: 'active',
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeApiOptions {
  workspaces?: Workspace[];
  products?: Product[];
  /** Rows per page. Defaults to 25, the same as the app. */
  pageSize?: number;
  /** Return a response to answer a request yourself, or undefined to use the fake's behaviour. */
  intercept?: (call: RecordedCall) => Response | undefined | Promise<Response | undefined>;
}

export interface FakeApi {
  fetch: typeof fetch;
  calls: RecordedCall[];
  products: Product[];
  /** Simulates another person saving the product: bumps its version and changes fields. */
  saveElsewhere(id: string, patch: Partial<Product>): void;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });
}

function apiError(code: string, message: string, status: number, fields?: unknown[]): Response {
  return json(
    {
      error: {
        code,
        message,
        requestId: 'req-test',
        ...(fields === undefined ? {} : { details: { fields } }),
      },
    },
    status,
  );
}

const PRODUCT_ROUTE =
  /^\/api\/v1\/workspaces\/([^/]+)\/products(?:\/([^/]+)(?:\/(archive|unarchive))?)?$/;

/** An in-memory stand-in for the products and workspaces endpoints, with real version checks. */
export function createFakeApi(options: FakeApiOptions = {}): FakeApi {
  const workspaces = options.workspaces ?? [WORKSPACE];
  const products = [...(options.products ?? [])];
  const pageSize = options.pageSize ?? 25;
  const calls: RecordedCall[] = [];
  let nextId = 1;

  const handle = async (method: string, url: URL, body: unknown): Promise<Response> => {
    if (method === 'GET' && url.pathname === '/api/v1/workspaces') {
      return json({ items: workspaces });
    }
    const match = PRODUCT_ROUTE.exec(url.pathname);
    if (match === null) return apiError('NOT_FOUND', 'Not found.', 404);
    const [, workspaceId = '', productId, action] = match;
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
      return apiError('NOT_FOUND', 'Workspace not found.', 404);
    }
    const inWorkspace = products.filter((product) => product.workspaceId === workspaceId);

    if (productId === undefined) {
      if (method === 'GET') {
        const status = url.searchParams.get('status') ?? 'active';
        const offset = Number(url.searchParams.get('cursor') ?? '0');
        const matching = inWorkspace.filter((product) => product.status === status);
        const page = matching.slice(offset, offset + pageSize);
        const more = offset + pageSize < matching.length;
        return json({ items: page, nextCursor: more ? String(offset + pageSize) : null });
      }
      if (method === 'POST') {
        const input = body as Record<string, unknown>;
        const created = makeProduct({
          id: `prod_${nextId++}`,
          workspaceId,
          name: String(input.name),
          ...(input as Partial<Product>),
        });
        products.push(created);
        return json(created, 201);
      }
    }

    const product = inWorkspace.find((item) => item.id === productId);
    if (product === undefined) return apiError('NOT_FOUND', 'Product not found.', 404);

    if (action === undefined && method === 'GET') return json(product);
    if (action === undefined && method === 'PATCH') {
      const { version, ...changes } = body as Record<string, unknown> & { version: number };
      if (version !== product.version) {
        return apiError('CONFLICT', 'The product was changed by someone else.', 409);
      }
      Object.assign(product, changes, { version: product.version + 1 });
      return json(product);
    }
    if (action === 'archive' || action === 'unarchive') {
      product.status = action === 'archive' ? 'archived' : 'active';
      product.archivedAt = action === 'archive' ? '2026-11-03T00:00:00.000Z' : null;
      product.version += 1;
      return json(product);
    }
    return apiError('NOT_FOUND', 'Not found.', 404);
  };

  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { method, path: `${url.pathname}${url.search}`, body };
    calls.push(call);
    const override = await options.intercept?.(call);
    if (override !== undefined) return override;
    return handle(method, url, body);
  };

  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    products,
    saveElsewhere(id, patch) {
      const product = products.find((item) => item.id === id);
      if (product === undefined) throw new Error(`no product ${id}`);
      Object.assign(product, patch, { version: product.version + 1 });
    },
  };
}
