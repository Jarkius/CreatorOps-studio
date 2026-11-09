import { and, count, desc, eq, ilike, inArray, lt, ne, or, sql, sum } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { assets, products, uploadIntents, workspaces } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';

export type AssetRow = typeof assets.$inferSelect;
export type IntentRow = typeof uploadIntents.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowMs = sql`date_trunc('milliseconds', now())`;

// --- Workspace-scoped functions: every one takes the resolved RequestContext. -----------------

/** Serialises quota checks for one workspace. Call inside a transaction. */
export async function lockWorkspace(tx: DbOrTx, ctx: RequestContext): Promise<void> {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .for('update');
}

export async function workspaceUsage(
  db: DbOrTx,
  ctx: RequestContext,
  now: Date,
): Promise<{ assets: number; bytes: number; openIntents: number }> {
  // Files on disk: ready AND soft-deleted ones. A deleted file keeps its bytes until the purge
  // removes it, so an upload-then-delete loop cannot fill the disk without limit.
  const stored = await db
    .select({ bytes: sum(assets.sizeBytes) })
    .from(assets)
    .where(eq(assets.workspaceId, ctx.workspaceId));
  const ready = await db
    .select({ n: count() })
    .from(assets)
    .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.status, 'ready')));
  // Uploads on their way reserve their share. A `pending` intent stops counting once it has
  // expired (it can no longer be used), but `receiving` and `received` ones keep counting until
  // they are completed or swept: their bytes are already on disk and can still be completed.
  const open = await db
    .select({ n: count(), bytes: sum(uploadIntents.declaredSize) })
    .from(uploadIntents)
    .where(
      and(
        eq(uploadIntents.workspaceId, ctx.workspaceId),
        or(
          and(eq(uploadIntents.status, 'pending'), sql`${uploadIntents.expiresAt} > ${now}`),
          inArray(uploadIntents.status, ['receiving', 'received']),
        ),
      ),
    );
  return {
    assets: Number(ready[0]?.n ?? 0) + Number(open[0]?.n ?? 0),
    bytes: Number(stored[0]?.bytes ?? 0) + Number(open[0]?.bytes ?? 0),
    openIntents: Number(open[0]?.n ?? 0),
  };
}

export interface NewIntent {
  readonly userId: string;
  readonly productId: string | null;
  readonly assetId: string;
  readonly declaredMime: string;
  readonly declaredSize: number;
  readonly originalFilename: string;
  readonly expiresAt: Date;
}

export async function insertIntent(
  db: DbOrTx,
  ctx: RequestContext,
  values: NewIntent,
): Promise<IntentRow> {
  const rows = await db
    .insert(uploadIntents)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to create the upload intent');
  return row;
}

export async function findIntent(
  db: DbOrTx,
  ctx: RequestContext,
  intentId: string,
): Promise<IntentRow | null> {
  if (!UUID.test(intentId)) return null;
  const rows = await db
    .select()
    .from(uploadIntents)
    .where(and(eq(uploadIntents.workspaceId, ctx.workspaceId), eq(uploadIntents.id, intentId)))
    .limit(1);
  return rows[0] ?? null;
}

/** received -> completed, once. Returns null if the intent was not in the `received` state. */
export async function completeIntent(
  db: DbOrTx,
  ctx: RequestContext,
  intentId: string,
): Promise<IntentRow | null> {
  const rows = await db
    .update(uploadIntents)
    .set({ status: 'completed', updatedAt: nowMs })
    .where(
      and(
        eq(uploadIntents.workspaceId, ctx.workspaceId),
        eq(uploadIntents.id, intentId),
        eq(uploadIntents.status, 'received'),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** received -> failed. Returns true only if this call made the change (nothing else completed it). */
export async function markReceivedIntentFailed(
  db: DbOrTx,
  ctx: RequestContext,
  intentId: string,
): Promise<boolean> {
  const rows = await db
    .update(uploadIntents)
    .set({ status: 'failed', updatedAt: nowMs })
    .where(
      and(
        eq(uploadIntents.workspaceId, ctx.workspaceId),
        eq(uploadIntents.id, intentId),
        eq(uploadIntents.status, 'received'),
      ),
    )
    .returning({ id: uploadIntents.id });
  return rows.length === 1;
}

export interface NewAsset {
  readonly id: string;
  readonly productId: string | null;
  readonly type: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly originalFilename: string;
  readonly sha256: string;
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
  readonly createdBy: string;
}

export async function insertAsset(
  db: DbOrTx,
  ctx: RequestContext,
  values: NewAsset,
): Promise<AssetRow> {
  const rows = await db
    .insert(assets)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to insert the asset');
  return row;
}

export async function findAsset(
  db: DbOrTx,
  ctx: RequestContext,
  assetId: string,
): Promise<AssetRow | null> {
  if (!UUID.test(assetId)) return null;
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, assetId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Finds a ready image of this workspace and locks it against deletion until the transaction ends
 * (FOR SHARE conflicts with the UPDATE that soft-deletes it). Used before pointing a product's
 * cover at it, so a concurrent delete cannot leave a cover that points at a deleted file.
 */
export async function lockReadyImage(
  db: DbOrTx,
  ctx: RequestContext,
  assetId: string,
): Promise<boolean> {
  if (!UUID.test(assetId)) return false;
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, assetId),
        eq(assets.status, 'ready'),
        eq(assets.type, 'image'),
      ),
    )
    .for('share');
  return rows.length === 1;
}

export interface AssetListOptions {
  readonly productId?: string | undefined;
  readonly type?: 'image' | 'video' | undefined;
  /** Part of the file name; `%`, `_` and `\` match themselves. */
  readonly q?: string | undefined;
  readonly limit: number;
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

export async function listAssets(
  db: DbOrTx,
  ctx: RequestContext,
  options: AssetListOptions,
): Promise<AssetRow[]> {
  const after = options.after;
  // A product id that is not a UUID can match nothing, so the list is simply empty.
  if (options.productId !== undefined && !UUID.test(options.productId)) return [];
  return db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.status, 'ready'),
        options.productId === undefined ? undefined : eq(assets.productId, options.productId),
        options.type === undefined ? undefined : eq(assets.type, options.type),
        options.q === undefined || options.q === ''
          ? undefined
          : ilike(assets.originalFilename, `%${options.q.replace(/[\\%_]/g, '\\$&')}%`),
        after === undefined
          ? undefined
          : sql`(${assets.createdAt}, ${assets.id}) < (${after.createdAt}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(options.limit);
}

/** ready -> deleted. Returns null if missing or already deleted. */
export async function softDeleteAsset(
  db: DbOrTx,
  ctx: RequestContext,
  assetId: string,
): Promise<AssetRow | null> {
  if (!UUID.test(assetId)) return null;
  const rows = await db
    .update(assets)
    .set({ status: 'deleted', deletedAt: nowMs, updatedAt: nowMs })
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, assetId),
        eq(assets.status, 'ready'),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Clears the cover image of every product that uses this asset; returns those product ids. */
export async function clearPrimaryAsset(
  db: DbOrTx,
  ctx: RequestContext,
  assetId: string,
): Promise<string[]> {
  const rows = await db
    .update(products)
    .set({ primaryAssetId: null, version: sql`${products.version} + 1`, updatedAt: nowMs })
    .where(and(eq(products.workspaceId, ctx.workspaceId), eq(products.primaryAssetId, assetId)))
    .returning({ id: products.id });
  return rows.map((row) => row.id);
}

// --- Signed-URL functions. -------------------------------------------------------------------
// These look a row up by id alone, because the caller has no bearer token. They are safe only
// because the caller must then present a valid signature that covers the row's own workspace
// and user. Never use them from a bearer-authenticated route.

export async function findIntentForSignedUpload(
  db: DbOrTx,
  intentId: string,
): Promise<IntentRow | null> {
  if (!UUID.test(intentId)) return null;
  const rows = await db.select().from(uploadIntents).where(eq(uploadIntents.id, intentId)).limit(1);
  return rows[0] ?? null;
}

/** pending -> receiving, once, and only before the intent expires. */
export async function claimIntentForReceiving(
  db: DbOrTx,
  intentId: string,
  now: Date,
): Promise<IntentRow | null> {
  const rows = await db
    .update(uploadIntents)
    .set({ status: 'receiving', updatedAt: nowMs })
    .where(
      and(
        eq(uploadIntents.id, intentId),
        eq(uploadIntents.status, 'pending'),
        sql`${uploadIntents.expiresAt} > ${now}`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function markIntentReceived(
  db: DbOrTx,
  intentId: string,
  facts: { detectedMime: string; receivedSize: number; sha256: string; storageKey: string },
): Promise<void> {
  await db
    .update(uploadIntents)
    .set({ ...facts, status: 'received', updatedAt: nowMs })
    .where(and(eq(uploadIntents.id, intentId), eq(uploadIntents.status, 'receiving')));
}

export async function markIntentFailed(db: DbOrTx, intentId: string): Promise<void> {
  await db
    .update(uploadIntents)
    .set({ status: 'failed', updatedAt: nowMs })
    .where(
      and(
        eq(uploadIntents.id, intentId),
        inArray(uploadIntents.status, ['pending', 'receiving', 'received']),
      ),
    );
}

export async function findAssetForSignedRead(
  db: DbOrTx,
  assetId: string,
): Promise<AssetRow | null> {
  if (!UUID.test(assetId)) return null;
  const rows = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  return rows[0] ?? null;
}

// --- Maintenance (no request, no caller). ------------------------------------------------------

export async function listStaleIntents(
  db: DbOrTx,
  olderThan: Date,
  limit: number,
): Promise<IntentRow[]> {
  return db
    .select()
    .from(uploadIntents)
    .where(
      and(
        inArray(uploadIntents.status, ['pending', 'receiving', 'received', 'failed']),
        lt(uploadIntents.updatedAt, olderThan),
      ),
    )
    .limit(limit);
}

/**
 * Deletes a stale intent only if it is still stale and not completed, and returns it so the
 * caller removes its files only when this call really removed the row. A completion that commits
 * between listing and deleting makes this return null, so a finished asset's file is never swept.
 */
export async function deleteStaleIntent(
  db: DbOrTx,
  intentId: string,
  cutoff: Date,
): Promise<IntentRow | null> {
  const rows = await db
    .delete(uploadIntents)
    .where(
      and(
        eq(uploadIntents.id, intentId),
        ne(uploadIntents.status, 'completed'),
        lt(uploadIntents.updatedAt, cutoff),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function listPurgeableAssets(
  db: DbOrTx,
  deletedBefore: Date,
  limit: number,
): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.status, 'deleted'), lt(assets.deletedAt, deletedBefore)))
    .limit(limit);
}

export async function hardDeleteAsset(db: DbOrTx, assetId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Defensive: nothing should still use a deleted asset as a cover, but if something does, it
    // must not block the purge (the foreign key would refuse the delete, forever).
    await tx
      .update(products)
      .set({ primaryAssetId: null })
      .where(eq(products.primaryAssetId, assetId));
    await tx.delete(assets).where(and(eq(assets.id, assetId), eq(assets.status, 'deleted')));
  });
}
