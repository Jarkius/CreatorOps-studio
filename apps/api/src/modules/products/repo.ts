import { and, desc, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { products } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';

export type ProductRow = typeof products.$inferSelect;

/** Editable product fields after normalisation. Null clears an optional field. */
export interface ProductValues {
  readonly name: string;
  readonly description: string | null;
  readonly sourceUrl: string | null;
  readonly priceAmount: string | null;
  readonly currency: string | null;
  readonly sellingPoints: string[];
  readonly targetAudience: string | null;
  readonly brandTone: string | null;
  readonly restrictedClaims: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowMs = sql`date_trunc('milliseconds', now())`;

/** Every function takes the resolved context, so every query is scoped to its workspace. */
export async function insertProduct(
  db: DbOrTx,
  ctx: RequestContext,
  values: ProductValues,
): Promise<ProductRow> {
  const rows = await db
    .insert(products)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to insert the product');
  return row;
}

export async function findProduct(
  db: DbOrTx,
  ctx: RequestContext,
  productId: string,
): Promise<ProductRow | null> {
  if (!UUID.test(productId)) return null;
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, ctx.workspaceId), eq(products.id, productId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ListOptions {
  readonly status: 'active' | 'archived';
  readonly limit: number;
  /** Exclusive position: rows strictly older than this (created_at, id) pair. */
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

/** Newest first, ties broken by id so the order is total and pages never repeat or skip. */
export async function listProducts(
  db: DbOrTx,
  ctx: RequestContext,
  options: ListOptions,
): Promise<ProductRow[]> {
  const after = options.after;
  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.workspaceId, ctx.workspaceId),
        eq(products.status, options.status),
        after === undefined
          ? undefined
          : sql`(${products.createdAt}, ${products.id}) < (${after.createdAt}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(options.limit);
}

export type ProductPatch = Partial<ProductValues> & { readonly primaryAssetId?: string | null };

/** Applies the patch only if the stored version still equals `version`; null otherwise. */
export async function updateProductVersioned(
  db: DbOrTx,
  ctx: RequestContext,
  productId: string,
  version: number,
  patch: ProductPatch,
): Promise<ProductRow | null> {
  if (!UUID.test(productId)) return null;
  const rows = await db
    .update(products)
    .set({ ...patch, version: sql`${products.version} + 1`, updatedAt: nowMs })
    .where(
      and(
        eq(products.workspaceId, ctx.workspaceId),
        eq(products.id, productId),
        eq(products.version, version),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Moves a product between active and archived. Returns null when the product is missing or
 * already in the requested state; callers tell the two apart with findProduct.
 */
export async function setProductArchived(
  db: DbOrTx,
  ctx: RequestContext,
  productId: string,
  archived: boolean,
): Promise<ProductRow | null> {
  if (!UUID.test(productId)) return null;
  const rows = await db
    .update(products)
    .set({
      status: archived ? 'archived' : 'active',
      archivedAt: archived ? nowMs : null,
      version: sql`${products.version} + 1`,
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(products.workspaceId, ctx.workspaceId),
        eq(products.id, productId),
        eq(products.status, archived ? 'active' : 'archived'),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
