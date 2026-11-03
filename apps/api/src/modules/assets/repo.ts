import { and, count, desc, eq, inArray, lt, sql, sum } from 'drizzle-orm';

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
  const stored = await db
    .select({ n: count(), bytes: sum(assets.sizeBytes) })
    .from(assets)
    .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.status, 'ready')));
  // Uploads that are on their way count against the quota too, so a burst of intents cannot
  // exceed it. Completed intents are already counted as assets.
  const open = await db
    .select({ n: count(), bytes: sum(uploadIntents.declaredSize) })
    .from(uploadIntents)
    .where(
      and(
        eq(uploadIntents.workspaceId, ctx.workspaceId),
        inArray(uploadIntents.status, ['pending', 'receiving', 'received']),
        sql`${uploadIntents.expiresAt} > ${now}`,
      ),
    );
  return {
    assets: Number(stored[0]?.n ?? 0) + Number(open[0]?.n ?? 0),
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

export async function markIntentFailedScoped(
  db: DbOrTx,
  ctx: RequestContext,
  intentId: string,
): Promise<void> {
  await db
    .update(uploadIntents)
    .set({ status: 'failed', updatedAt: nowMs })
    .where(and(eq(uploadIntents.workspaceId, ctx.workspaceId), eq(uploadIntents.id, intentId)));
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

export interface AssetListOptions {
  readonly productId?: string | undefined;
  readonly type?: 'image' | 'video' | undefined;
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

export async function deleteIntent(db: DbOrTx, intentId: string): Promise<void> {
  await db.delete(uploadIntents).where(eq(uploadIntents.id, intentId));
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
  // Completed intents keep a reference by asset id only (no foreign key), so nothing else blocks this.
  await db.delete(assets).where(and(eq(assets.id, assetId), eq(assets.status, 'deleted')));
}
