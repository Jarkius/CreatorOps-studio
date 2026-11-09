import { EXPORT_LIMITS } from '@creatorops/contracts';
import type { DraftAsset, SetDraftAssetsRequest } from '@creatorops/contracts';

type Item = SetDraftAssetsRequest['assets'][number];

/**
 * The whole list to send for the user's choice. Files that stay keep their scene and AI label
 * and their place; new files are added at the end as plain media. Only a picture can be the
 * cover, and at most one file is.
 */
export function buildAttachments(
  current: readonly DraftAsset[],
  selectedIds: readonly string[],
  coverId: string | null,
): Item[] {
  const keep = new Set(selectedIds);
  const existing = new Map(current.map((item) => [item.assetId, item]));
  const order = [
    ...current.map((item) => item.assetId).filter((id) => keep.has(id)),
    ...selectedIds.filter((id) => !existing.has(id)),
  ].slice(0, EXPORT_LIMITS.maxAssetsPerDraft);
  return order.map((assetId) => {
    const before = existing.get(assetId);
    const item: Item = {
      assetId,
      role: assetId === coverId ? 'cover' : 'media',
      aiGenerated: before?.aiGenerated ?? false,
    };
    if (before?.scene != null) item.scene = before.scene;
    if (before?.generator != null) item.generator = before.generator;
    return item;
  });
}
