import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { assets, draftAssets } from '../../db/schema.js';

export type DraftAssetRow = typeof draftAssets.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type NewDraftAsset = typeof draftAssets.$inferInsert;

export interface LinkedAsset {
  readonly link: DraftAssetRow;
  readonly asset: AssetRow;
}

/** The ready files attached to a draft, in package order. Deleted files are not listed. */
export async function listLinked(
  db: DbOrTx,
  workspaceId: string,
  draftId: string,
): Promise<LinkedAsset[]> {
  return db
    .select({ link: draftAssets, asset: assets })
    .from(draftAssets)
    .innerJoin(
      assets,
      and(eq(assets.workspaceId, draftAssets.workspaceId), eq(assets.id, draftAssets.assetId)),
    )
    .where(
      and(
        eq(draftAssets.workspaceId, workspaceId),
        eq(draftAssets.draftId, draftId),
        eq(assets.status, 'ready'),
      ),
    )
    .orderBy(asc(draftAssets.sortOrder));
}

/**
 * The ready files of this workspace among `ids`, locked against deletion until the transaction
 * ends (FOR SHARE conflicts with the UPDATE that soft-deletes a file), so a concurrent delete
 * cannot leave a link to a deleted file.
 */
export async function lockReadyAssets(
  tx: DbOrTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<AssetRow[]> {
  if (ids.length === 0) return [];
  return tx
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.status, 'ready'),
        inArray(assets.id, [...ids]),
      ),
    )
    .for('share');
}

/** Replaces every link of the draft with `rows` (which may be empty). */
export async function replaceLinks(
  tx: DbOrTx,
  workspaceId: string,
  draftId: string,
  rows: readonly NewDraftAsset[],
): Promise<void> {
  await tx
    .delete(draftAssets)
    .where(and(eq(draftAssets.workspaceId, workspaceId), eq(draftAssets.draftId, draftId)));
  if (rows.length > 0) await tx.insert(draftAssets).values([...rows]);
}

/** Removes the file from every draft it is attached to; returns how many links went. */
export async function detachAsset(
  tx: DbOrTx,
  workspaceId: string,
  assetId: string,
): Promise<number> {
  const removed = await tx
    .delete(draftAssets)
    .where(and(eq(draftAssets.workspaceId, workspaceId), eq(draftAssets.assetId, assetId)))
    .returning({ assetId: draftAssets.assetId });
  return removed.length;
}
