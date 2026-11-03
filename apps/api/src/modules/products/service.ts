import type {
  CreateProductRequest,
  Product,
  ProductListQueryParsed,
  ProductListResponse,
  UpdateProductRequest,
} from '@creatorops/contracts';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import { recordAuditEvent } from '../audit/repo.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanWrite } from '../identity/permissions.js';
import { lockReadyImage } from '../assets/repo.js';
import {
  findProduct,
  insertProduct,
  listProducts as listProductRows,
  setProductArchived,
  updateProductVersioned,
  type ProductPatch,
  type ProductRow,
  type ProductValues,
} from './repo.js';

// Control characters other than newline (and carriage return/tab are folded away too).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

/** NFC-normalises (Thai combining marks), removes control characters except newline, trims. */
export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(CONTROL_CHARS, '').trim();
}

function normalizeOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = normalizeText(value);
  return text === '' ? null : text;
}

function normalizeList(values: readonly string[], field: string): string[] {
  const out = values.map(normalizeText);
  if (out.some((item) => item === '')) {
    throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
      { path: field, message: 'items must not be empty' },
    ]);
  }
  return out;
}

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    sourceUrl: row.sourceUrl,
    priceAmount: row.priceAmount,
    currency: row.currency,
    sellingPoints: row.sellingPoints,
    targetAudience: row.targetAudience,
    brandTone: row.brandTone,
    restrictedClaims: row.restrictedClaims,
    primaryAssetId: row.primaryAssetId,
    status: row.status === 'archived' ? 'archived' : 'active',
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
  };
}

const notFound = () => new AppError('NOT_FOUND', 'Product not found.');

function pairError(): AppError {
  return new AppError('VALIDATION_ERROR', 'The request is not valid.', [
    { path: 'currency', message: 'priceAmount and currency must be given together' },
  ]);
}

/** Drizzle wraps driver errors, so look through the `cause` chain for the PostgreSQL error. */
function postgresError(error: unknown): { code?: unknown; constraint?: unknown } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const record = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof record.code === 'string' && /^[0-9A-Z]{5}$/.test(record.code)) return record;
    current = record.cause;
  }
  return null;
}

function isPriceCurrencyViolation(error: unknown): boolean {
  const pg = postgresError(error);
  return pg?.code === '23514' && pg.constraint === 'products_price_currency_check';
}

function isPrimaryAssetViolation(error: unknown): boolean {
  const pg = postgresError(error);
  return pg?.code === '23503' && pg.constraint === 'products_primary_asset_fk';
}

export async function createProduct(
  db: Db,
  ctx: RequestContext,
  input: CreateProductRequest,
): Promise<Product> {
  assertCanWrite(ctx);
  const values: ProductValues = {
    name: normalizeText(input.name),
    description: normalizeOptional(input.description) ?? null,
    sourceUrl: input.sourceUrl ? new URL(input.sourceUrl.trim()).toString() : null,
    priceAmount: input.priceAmount ?? null,
    currency: input.currency ?? null,
    sellingPoints: normalizeList(input.sellingPoints ?? [], 'sellingPoints'),
    targetAudience: normalizeOptional(input.targetAudience) ?? null,
    brandTone: normalizeOptional(input.brandTone) ?? null,
    restrictedClaims: normalizeList(input.restrictedClaims ?? [], 'restrictedClaims'),
  };
  if (values.name === '') {
    throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
      { path: 'name', message: 'must not be empty' },
    ]);
  }

  const row = await db.transaction(async (tx) => {
    const created = await insertProduct(tx, ctx, values);
    await recordAuditEvent(tx, ctx, {
      action: 'product.created',
      resourceType: 'product',
      resourceId: created.id,
      metadata: { name: created.name },
    });
    return created;
  });
  return toProduct(row);
}

export async function getProduct(db: Db, ctx: RequestContext, productId: string): Promise<Product> {
  const row = await findProduct(db, ctx, productId);
  if (row === null) throw notFound();
  return toProduct(row);
}

interface Cursor {
  readonly createdAt: Date;
  readonly id: string;
}

function encodeCursor(row: ProductRow): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): Cursor {
  const invalid = () =>
    new AppError('VALIDATION_ERROR', 'The request is not valid.', [
      { path: 'cursor', message: 'is not a valid cursor' },
    ]);
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: unknown;
      i?: unknown;
    };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') throw invalid();
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(parsed.i)) throw invalid();
    return { createdAt, id: parsed.i };
  } catch (error) {
    throw error instanceof AppError ? error : invalid();
  }
}

export async function listProducts(
  db: Db,
  ctx: RequestContext,
  query: ProductListQueryParsed,
): Promise<ProductListResponse> {
  const rows = await listProductRows(db, ctx, {
    status: query.status,
    limit: query.limit + 1,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toProduct),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  };
}

export async function updateProduct(
  db: Db,
  ctx: RequestContext,
  productId: string,
  input: UpdateProductRequest,
): Promise<Product> {
  assertCanWrite(ctx);

  const patch: { -readonly [K in keyof ProductPatch]?: ProductPatch[K] } = {};
  if (input.name !== undefined) {
    const name = normalizeText(input.name);
    if (name === '') {
      throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
        { path: 'name', message: 'must not be empty' },
      ]);
    }
    patch.name = name;
  }
  const description = normalizeOptional(input.description);
  if (description !== undefined) patch.description = description;
  if (input.sourceUrl !== undefined) {
    patch.sourceUrl = input.sourceUrl === null ? null : new URL(input.sourceUrl.trim()).toString();
  }
  if (input.priceAmount !== undefined) patch.priceAmount = input.priceAmount;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.sellingPoints !== undefined)
    patch.sellingPoints = normalizeList(input.sellingPoints, 'sellingPoints');
  const targetAudience = normalizeOptional(input.targetAudience);
  if (targetAudience !== undefined) patch.targetAudience = targetAudience;
  const brandTone = normalizeOptional(input.brandTone);
  if (brandTone !== undefined) patch.brandTone = brandTone;
  if (input.restrictedClaims !== undefined) {
    patch.restrictedClaims = normalizeList(input.restrictedClaims, 'restrictedClaims');
  }

  if (input.primaryAssetId !== undefined) patch.primaryAssetId = input.primaryAssetId;

  try {
    const row = await db.transaction(async (tx) => {
      if (typeof patch.primaryAssetId === 'string') {
        // The cover must be a ready image of this workspace, and stay so until we commit: the lock
        // blocks a concurrent delete of that file (the database also enforces the workspace).
        if (!(await lockReadyImage(tx, ctx, patch.primaryAssetId))) {
          throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
            { path: 'primaryAssetId', message: 'must be an image file in this workspace' },
          ]);
        }
      }
      const updated = await updateProductVersioned(tx, ctx, productId, input.version, patch);
      if (updated === null) return null;
      await recordAuditEvent(tx, ctx, {
        action: 'product.updated',
        resourceType: 'product',
        resourceId: updated.id,
        // Field names only: values may be long or sensitive.
        metadata: { fields: Object.keys(patch), version: updated.version },
      });
      return updated;
    });
    if (row !== null) return toProduct(row);
  } catch (error) {
    if (isPriceCurrencyViolation(error)) throw pairError();
    if (isPrimaryAssetViolation(error)) {
      throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
        { path: 'primaryAssetId', message: 'must be an image file in this workspace' },
      ]);
    }
    throw error;
  }

  // Nothing was updated: the product is missing, or its version moved on.
  const current = await findProduct(db, ctx, productId);
  if (current === null) throw notFound();
  throw new AppError(
    'CONFLICT',
    'This product was changed by someone else. Reload it and try again.',
    undefined,
    { currentVersion: current.version },
  );
}

async function changeArchiveState(
  db: Db,
  ctx: RequestContext,
  productId: string,
  archived: boolean,
): Promise<Product> {
  assertCanWrite(ctx);
  const row = await db.transaction(async (tx) => {
    const changed = await setProductArchived(tx, ctx, productId, archived);
    if (changed === null) return null;
    await recordAuditEvent(tx, ctx, {
      action: archived ? 'product.archived' : 'product.unarchived',
      resourceType: 'product',
      resourceId: changed.id,
    });
    return changed;
  });
  if (row !== null) return toProduct(row);

  // Either missing, or already in the requested state (then this is a harmless no-op).
  const current = await findProduct(db, ctx, productId);
  if (current === null) throw notFound();
  return toProduct(current);
}

export const archiveProduct = (db: Db, ctx: RequestContext, productId: string) =>
  changeArchiveState(db, ctx, productId, true);

export const unarchiveProduct = (db: Db, ctx: RequestContext, productId: string) =>
  changeArchiveState(db, ctx, productId, false);
