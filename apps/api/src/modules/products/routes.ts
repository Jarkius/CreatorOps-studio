import {
  CreateProductRequestSchema,
  ProductListQuerySchema,
  ProductListResponseSchema,
  ProductParamsSchema,
  ProductSchema,
  UpdateProductRequestSchema,
  WorkspaceParamsSchema,
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
import {
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  unarchiveProduct,
  updateProduct,
} from './service.js';

export interface ProductRouteOptions {
  readonly db: Db;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

export function registerProductRoutes(app: FastifyInstance, options: ProductRouteOptions): void {
  const { db, guard, scope } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/workspaces/:workspaceId/products';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['products'];
  const security = [{ bearerAuth: [] }];

  typed.get(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'List products',
        security,
        params: WorkspaceParamsSchema,
        querystring: ProductListQuerySchema,
        response: { 200: ProductListResponseSchema },
      },
    },
    (request) => listProducts(db, contextOf(request), request.query),
  );

  typed.post(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'Create a product',
        security,
        params: WorkspaceParamsSchema,
        body: CreateProductRequestSchema,
        response: { 201: ProductSchema },
      },
    },
    async (request, reply) => {
      const product = await createProduct(db, contextOf(request), request.body);
      return reply.code(201).send(product);
    },
  );

  typed.get(
    `${base}/:productId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Get a product',
        security,
        params: ProductParamsSchema,
        response: { 200: ProductSchema },
      },
    },
    (request) => getProduct(db, contextOf(request), request.params.productId),
  );

  typed.patch(
    `${base}/:productId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Update a product (send the version you last saw)',
        security,
        params: ProductParamsSchema,
        body: UpdateProductRequestSchema,
        response: { 200: ProductSchema },
      },
    },
    (request) => updateProduct(db, contextOf(request), request.params.productId, request.body),
  );

  typed.post(
    `${base}/:productId/archive`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Archive a product',
        security,
        params: ProductParamsSchema,
        response: { 200: ProductSchema },
      },
    },
    (request) => archiveProduct(db, contextOf(request), request.params.productId),
  );

  typed.post(
    `${base}/:productId/unarchive`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Restore an archived product',
        security,
        params: ProductParamsSchema,
        response: { 200: ProductSchema },
      },
    },
    (request) => unarchiveProduct(db, contextOf(request), request.params.productId),
  );
}
