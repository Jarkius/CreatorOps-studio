import type { Asset, Product, Workspace } from '@creatorops/contracts';

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

export function makeAsset(
  overrides: Partial<Asset> & { id: string; originalFilename: string },
): Asset {
  const isVideo = overrides.type === 'video' || overrides.mimeType === 'video/mp4';
  return {
    workspaceId: WORKSPACE.id,
    productId: null,
    type: isVideo ? 'video' : 'image',
    status: 'ready',
    mimeType: isVideo ? 'video/mp4' : 'image/png',
    sizeBytes: 1024,
    width: isVideo ? null : 1,
    height: isVideo ? null : 1,
    durationMs: null,
    sha256: 'a'.repeat(64),
    url: `/api/v1/media/${overrides.id}/original?exp=1&sig=test`,
    thumbUrl: isVideo ? null : `/api/v1/media/${overrides.id}/thumb?exp=1&sig=test`,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  };
}

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
  assets?: Asset[];
  /** Rows per page. Defaults to 25, the same as the app. */
  pageSize?: number;
  /** Return a response to answer a request yourself, or undefined to use the fake's behaviour. */
  intercept?: (call: RecordedCall) => Response | undefined | Promise<Response | undefined>;
}

export interface FakeApi {
  fetch: typeof fetch;
  calls: RecordedCall[];
  products: Product[];
  assets: Asset[];
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

const ASSET_ROUTE =
  /^\/api\/v1\/workspaces\/([^/]+)\/assets(?:\/(upload-intent|complete-upload|[^/]+))?$/;

const PRODUCT_ROUTE =
  /^\/api\/v1\/workspaces\/([^/]+)\/products(?:\/([^/]+)(?:\/(archive|unarchive))?)?$/;

/** An in-memory stand-in for the products and workspaces endpoints, with real version checks. */
export function createFakeApi(options: FakeApiOptions = {}): FakeApi {
  const workspaces = options.workspaces ?? [WORKSPACE];
  const products = [...(options.products ?? [])];
  const pageSize = options.pageSize ?? 25;
  const assets = [...(options.assets ?? [])];
  const intents = new Map<string, { input: Record<string, unknown>; asset: Asset | null }>();
  const calls: RecordedCall[] = [];
  let nextId = 1;

  const handleAssets = (
    method: string,
    url: URL,
    body: unknown,
    workspaceId: string,
    part: string | undefined,
  ): Response => {
    const inWorkspace = assets.filter((asset) => asset.workspaceId === workspaceId);
    if (part === undefined && method === 'GET') {
      const productId = url.searchParams.get('productId');
      const type = url.searchParams.get('type');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const matching = inWorkspace.filter(
        (asset) =>
          (productId === null || asset.productId === productId) &&
          (type === null || asset.type === type) &&
          asset.originalFilename.toLowerCase().includes(q),
      );
      const limit = Number(url.searchParams.get('limit') ?? '25');
      const offset = Number(url.searchParams.get('cursor') ?? '0');
      const page = matching.slice(offset, offset + limit);
      const more = offset + limit < matching.length;
      return json({ items: page, nextCursor: more ? String(offset + limit) : null });
    }
    if (part === 'upload-intent' && method === 'POST') {
      const input = body as Record<string, unknown>;
      const intentId = `intent_${nextId++}`;
      intents.set(intentId, { input, asset: null });
      return json(
        {
          intentId,
          uploadUrl: `/api/v1/uploads/${intentId}?exp=1&sig=test`,
          method: 'PUT',
          contentType: input.mimeType,
          expiresAt: '2026-11-03T01:00:00.000Z',
        },
        201,
      );
    }
    if (part === 'complete-upload' && method === 'POST') {
      const { intentId } = body as { intentId: string };
      const intent = intents.get(intentId);
      if (intent === undefined) return apiError('NOT_FOUND', 'Upload not found.', 404);
      if (intent.asset !== null) return json(intent.asset);
      const input = intent.input;
      const id = `asset_${nextId++}`;
      const mimeType = String(input.mimeType);
      const created = makeAsset({
        id,
        workspaceId,
        productId: typeof input.productId === 'string' ? input.productId : null,
        originalFilename: String(input.filename),
        mimeType: mimeType as Asset['mimeType'],
        type: mimeType.startsWith('video/') ? 'video' : 'image',
        sizeBytes: Number(input.sizeBytes),
      });
      assets.push(created);
      intent.asset = created;
      return json(created);
    }
    if (part !== undefined && method === 'GET') {
      const asset = inWorkspace.find((item) => item.id === part);
      return asset === undefined ? apiError('NOT_FOUND', 'File not found.', 404) : json(asset);
    }
    if (part !== undefined && method === 'DELETE') {
      const index = assets.findIndex(
        (item) => item.id === part && item.workspaceId === workspaceId,
      );
      if (index === -1) return apiError('NOT_FOUND', 'File not found.', 404);
      const [removed] = assets.splice(index, 1);
      for (const product of products) {
        if (product.primaryAssetId === removed?.id) {
          product.primaryAssetId = null;
          product.version += 1;
        }
      }
      return json({ id: part, deleted: true });
    }
    return apiError('NOT_FOUND', 'Not found.', 404);
  };

  const handle = async (method: string, url: URL, body: unknown): Promise<Response> => {
    if (method === 'GET' && url.pathname === '/api/v1/health') {
      return json({ status: 'ok', service: 'creatorops-api', time: '2026-11-03T00:00:00.000Z' });
    }
    if (method === 'GET' && url.pathname === '/api/v1/me') {
      return json({
        user: { id: 'usr_1', email: 'dev@example.test', displayName: 'Dev User' },
        workspaces: workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
        })),
      });
    }
    if (method === 'GET' && url.pathname === '/api/v1/workspaces') {
      return json({ items: workspaces });
    }
    if (method === 'POST' && url.pathname === '/api/v1/workspaces') {
      const input = body as Record<string, unknown>;
      const created: Workspace = {
        ...WORKSPACE,
        id: `ws_created_${nextId++}`,
        name: String(input.name),
        defaultLanguage: input.defaultLanguage === 'en' ? 'en' : 'th',
        brandVoice: typeof input.brandVoice === 'string' ? input.brandVoice : null,
      };
      workspaces.push(created);
      return json(created, 201);
    }
    const assetMatch = ASSET_ROUTE.exec(url.pathname);
    if (assetMatch !== null) {
      const [, assetWorkspace = '', part] = assetMatch;
      if (!workspaces.some((workspace) => workspace.id === assetWorkspace)) {
        return apiError('NOT_FOUND', 'Workspace not found.', 404);
      }
      return handleAssets(method, url, body, assetWorkspace, part);
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
    assets,
    saveElsewhere(id, patch) {
      const product = products.find((item) => item.id === id);
      if (product === undefined) throw new Error(`no product ${id}`);
      Object.assign(product, patch, { version: product.version + 1 });
    },
  };
}
