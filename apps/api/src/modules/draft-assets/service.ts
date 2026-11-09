import type {
  DraftAsset,
  DraftAssetListResponse,
  SetDraftAssetsRequestParsed,
} from '@creatorops/contracts';

import { AppError } from '../../platform/errors.js';
import { toAsset } from '../assets/service.js';
import type { AssetDeps } from '../assets/service.js';
import { recordAuditEvent } from '../audit/repo.js';
import { findDraft } from '../drafts/repo.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanWrite } from '../identity/permissions.js';
import { listLinked, lockReadyAssets, replaceLinks, type LinkedAsset } from './repo.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new AppError('NOT_FOUND', 'Draft not found.');

const SCENES = ['product_hero', 'detail', 'usage', 'final_shot'] as const;

function toDraftAsset(item: LinkedAsset, deps: AssetDeps, nowSeconds: number): DraftAsset {
  const { link, asset } = item;
  return {
    assetId: link.assetId,
    role: link.role === 'cover' ? 'cover' : 'media',
    sortOrder: link.sortOrder,
    scene: SCENES.find((scene) => scene === link.scene) ?? null,
    aiGenerated: link.aiGenerated,
    generator: link.generator,
    asset: toAsset(asset, deps.media, nowSeconds),
    createdAt: link.createdAt.toISOString(),
  };
}

const nowSeconds = (deps: AssetDeps): number =>
  Math.floor((deps.now ? deps.now() : new Date()).getTime() / 1000);

/** The files attached to a draft, in package order. Any member of the workspace may read. */
export async function listDraftAssets(
  deps: AssetDeps,
  ctx: RequestContext,
  draftId: string,
): Promise<DraftAssetListResponse> {
  const draft = await findDraft(deps.db, ctx, draftId);
  if (draft === null) throw notFound();
  const linked = await listLinked(deps.db, ctx.workspaceId, draft.id);
  const now = nowSeconds(deps);
  return { items: linked.map((item) => toDraftAsset(item, deps, now)) };
}

/**
 * Replaces the draft's attachments with the given ordered list (D-067, D-071). One atomic,
 * repeatable call covers attach, detach, reorder, cover and scene. Every file must be a ready file
 * of this workspace and either belong to no product or to the draft's product; a file that is
 * missing, deleted, from another workspace or from another product is refused alike, so the
 * answer reveals nothing about other workspaces.
 */
export async function setDraftAssets(
  deps: AssetDeps,
  ctx: RequestContext,
  draftId: string,
  input: SetDraftAssetsRequestParsed,
): Promise<DraftAssetListResponse> {
  assertCanWrite(ctx);

  await deps.db.transaction(async (tx) => {
    // The row lock orders this call against another replace of the same draft.
    const draft = await findDraft(tx, ctx, draftId, { forUpdate: true });
    if (draft === null) throw notFound();

    const ids = input.assets.map((item) => item.assetId.toLowerCase());
    const rejected = (index: number) =>
      new AppError('VALIDATION_ERROR', 'The request is not valid.', [
        { path: `assets.${index}.assetId`, message: 'File not found' },
      ]);
    ids.forEach((id, index) => {
      if (!UUID.test(id)) throw rejected(index);
    });
    const found = new Map((await lockReadyAssets(tx, ctx.workspaceId, ids)).map((a) => [a.id, a]));
    ids.forEach((id, index) => {
      const asset = found.get(id);
      if (asset === undefined) throw rejected(index);
      if (asset.productId !== null && asset.productId !== draft.productId) throw rejected(index);
    });

    await replaceLinks(
      tx,
      ctx.workspaceId,
      draft.id,
      input.assets.map((item, index) => ({
        workspaceId: ctx.workspaceId,
        draftId: draft.id,
        assetId: ids[index] ?? '',
        role: item.role,
        sortOrder: index,
        scene: item.scene ?? null,
        aiGenerated: item.aiGenerated,
        generator: item.generator ?? null,
        createdBy: ctx.userId,
      })),
    );
    await recordAuditEvent(tx, ctx, {
      action: 'draft.assets.updated',
      resourceType: 'draft',
      resourceId: draft.id,
      metadata: {
        count: input.assets.length,
        hasCover: input.assets.some((item) => item.role === 'cover'),
        aiGenerated: input.assets.filter((item) => item.aiGenerated).length,
      },
    });
  });

  return listDraftAssets(deps, ctx, draftId);
}
