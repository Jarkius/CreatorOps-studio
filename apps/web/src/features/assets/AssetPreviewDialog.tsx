import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { ApiError } from '@creatorops/contracts';
import type { Asset, Product } from '@creatorops/contracts';
import { Button, ConfirmDialog } from '@creatorops/ui';

import { useDashboard } from '../../app/dashboard-context.js';
import { describeError } from '../errors.js';
import { formatDate } from '../products/format.js';
import { useDeleteAsset, useRefreshProduct, useSetCover } from './assetQueries.js';
import { formatBytes } from './uploadFile.js';

const FOCUSABLE =
  'button:not([disabled]), a[href], video[controls], input:not([disabled]), select, textarea';

export interface AssetPreviewDialogProps {
  readonly workspaceId: string;
  readonly asset: Asset;
  /** Present on a product page: enables "Use as cover" for images. */
  readonly product?: Product;
  readonly onClose: () => void;
  /** Called after the file is deleted; the dialog is gone by then. */
  readonly onDeleted: () => void;
  /** Called when the media fails to load (expired link); the gallery refreshes its lists. */
  readonly onMediaError: () => void;
}

/**
 * A modal preview of one file. Focus moves in on open and returns to the opener on close; Escape
 * closes; Tab stays inside. Delete asks for confirmation first.
 */
export function AssetPreviewDialog({
  workspaceId,
  asset,
  product,
  onClose,
  onDeleted,
  onMediaError,
}: AssetPreviewDialogProps) {
  const { client } = useDashboard();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Captured on the first render, before focus moves into the dialog.
  const [opener] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  // After a delete the opener is gone, so the gallery takes focus instead.
  const keepFocus = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [coverConflict, setCoverConflict] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const deleteAsset = useDeleteAsset(workspaceId);
  const setCover = useSetCover(workspaceId, product?.id ?? '');
  const refreshProduct = useRefreshProduct(workspaceId, product?.id ?? '');

  useEffect(() => {
    closeRef.current?.focus();
    return () => {
      if (!keepFocus.current && opener !== null && opener.isConnected) opener.focus();
    };
  }, [opener]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || dialogRef.current === null) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const mediaUrl = client.resolveUrl(asset.url);
  const isImage = asset.type === 'image';
  const typeLabel = isImage ? 'Image' : 'Video';
  const dimensions =
    asset.width !== null && asset.height !== null
      ? `${asset.width} × ${asset.height}`
      : 'Not available';
  const canUseAsCover = product !== undefined && isImage;
  const isCover = product?.primaryAssetId === asset.id;

  const changeCover = async (primaryAssetId: string | null) => {
    if (product === undefined) return;
    setActionError(null);
    setCoverConflict(false);
    try {
      // The product's current version: a stale one is answered with a conflict.
      await setCover.mutateAsync({ version: product.version, primaryAssetId });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') setCoverConflict(true);
      else setActionError(describeError(error).message);
    }
  };

  const confirmDelete = async () => {
    setActionError(null);
    try {
      await deleteAsset.mutateAsync(asset.id);
      setConfirmOpen(false);
      keepFocus.current = true;
      onDeleted();
    } catch (error) {
      setConfirmOpen(false);
      setActionError(describeError(error).message);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          className="w-full max-w-3xl space-y-5 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-5 leading-relaxed"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
              {asset.originalFilename}
            </h2>
            <Button ref={closeRef} variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>

          <div className="flex justify-center rounded-md bg-[var(--co-bg)] p-2">
            {isImage ? (
              <img
                src={mediaUrl}
                alt={asset.originalFilename}
                onError={onMediaError}
                className="max-h-[60vh] max-w-full object-contain"
              />
            ) : (
              <video
                controls
                preload="metadata"
                src={mediaUrl}
                aria-label={`Video: ${asset.originalFilename}`}
                onError={onMediaError}
                className="max-h-[60vh] max-w-full"
              />
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-[var(--co-text-muted)]">Type</dt>
              <dd>{typeLabel}</dd>
            </div>
            <div>
              <dt className="text-[var(--co-text-muted)]">Size</dt>
              <dd>{formatBytes(asset.sizeBytes)}</dd>
            </div>
            <div>
              <dt className="text-[var(--co-text-muted)]">Dimensions</dt>
              <dd>{dimensions}</dd>
            </div>
            <div>
              <dt className="text-[var(--co-text-muted)]">Added</dt>
              <dd>
                <time dateTime={asset.createdAt}>{formatDate(asset.createdAt)}</time>
              </dd>
            </div>
          </dl>

          {coverConflict ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--co-danger)] p-3"
            >
              <p>This product was changed by someone else.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setCoverConflict(false);
                  void refreshProduct();
                }}
              >
                Load latest
              </Button>
            </div>
          ) : null}
          {actionError === null ? null : (
            <p role="alert" className="text-[var(--co-danger)]">
              {actionError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {canUseAsCover && isCover ? (
              <>
                <span className="rounded-full border border-[var(--co-accent)] px-3 py-1 text-sm font-medium text-[var(--co-accent)]">
                  Cover
                </span>
                <Button
                  variant="secondary"
                  loading={setCover.isPending}
                  onClick={() => void changeCover(null)}
                >
                  Remove cover
                </Button>
              </>
            ) : null}
            {canUseAsCover && !isCover ? (
              <Button
                variant="secondary"
                loading={setCover.isPending}
                onClick={() => void changeCover(asset.id)}
              >
                Use as cover
              </Button>
            ) : null}
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Delete
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${asset.originalFilename}?`}
        description="The file is removed from this workspace. If a product uses it as its cover, that product loses its cover."
        confirmLabel="Delete file"
        confirmVariant="danger"
        busy={deleteAsset.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
