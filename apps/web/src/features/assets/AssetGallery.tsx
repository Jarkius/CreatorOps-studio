import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import type { ApiClient, Asset, AssetType, Product } from '@creatorops/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
} from '@creatorops/ui';

import { useDashboard } from '../../app/dashboard-context.js';
import { describeError } from '../errors.js';
import { useAssetList, useMediaRefresh } from './assetQueries.js';
import type { AssetScope } from './assetQueries.js';
import { AssetPreviewDialog } from './AssetPreviewDialog.js';
import { formatBytes } from './uploadFile.js';

/** How long the search box waits after the last key before it asks the server. */
export const SEARCH_DELAY_MS = 300;

export type AssetTypeFilter = 'all' | AssetType;

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
];

/** Only `image` and `video` filter; anything else in the URL means All. */
export function typeFilterFromParam(value: string | null): AssetTypeFilter {
  return value === 'image' || value === 'video' ? value : 'all';
}

export interface AssetGalleryProps {
  readonly workspaceId: string;
  /** Lists only this product's files, and enables cover actions when `product` is given. */
  readonly productId?: string;
  /** The current product. Its version is sent with every cover change. */
  readonly product?: Product;
}

function VideoGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-10 text-[var(--co-text-muted)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}

interface AssetTileProps {
  readonly asset: Asset;
  readonly client: ApiClient;
  readonly isCover: boolean;
  readonly onOpen: () => void;
  readonly onMediaError: () => void;
}

function AssetTile({ asset, client, isCover, onOpen, onMediaError }: AssetTileProps) {
  const isImageWithThumb = asset.type === 'image' && asset.thumbUrl !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-2 text-left leading-relaxed hover:brightness-110"
    >
      <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-[var(--co-bg)]">
        {isImageWithThumb ? (
          <img
            src={client.resolveUrl(asset.thumbUrl ?? '')}
            alt={asset.originalFilename}
            loading="lazy"
            onError={onMediaError}
            className="size-full object-cover"
          />
        ) : (
          <VideoGlyph />
        )}
      </span>
      <span className="mt-2 block text-sm font-medium [overflow-wrap:anywhere]">
        {asset.originalFilename}
      </span>
      <span className="block text-xs text-[var(--co-text-muted)]">
        {asset.type === 'image' ? 'Image' : 'Video'} · {formatBytes(asset.sizeBytes)}
      </span>
      {isCover ? (
        <span className="mt-1 inline-block w-fit rounded-full border border-[var(--co-accent)] px-2 text-xs font-medium text-[var(--co-accent)]">
          Cover
        </span>
      ) : null}
    </button>
  );
}

/**
 * A grid of the workspace's files (or one product's), filterable by type, with "Load more" and a
 * preview for each file. Shown on the asset library and on a product page.
 */
export function AssetGallery({ workspaceId, productId, product }: AssetGalleryProps) {
  const { client } = useDashboard();
  const [params, setParams] = useSearchParams();
  const typeFilter = typeFilterFromParam(params.get('type'));
  const query = (params.get('q') ?? '').trim();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const scope: AssetScope = {
    ...(productId === undefined ? {} : { productId }),
    ...(typeFilter === 'all' ? {} : { type: typeFilter }),
    ...(query === '' ? {} : { q: query }),
  };
  const list = useAssetList(workspaceId, scope);
  const refreshMedia = useMediaRefresh(workspaceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;

  // The search box writes to the URL a moment after typing stops, so a request is not sent per key.
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (search.trim() === '') next.delete('q');
          else next.set('q', search.trim());
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, query, setParams]);

  const setTypeFilter = (value: string) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === 'all') next.delete('type');
        else next.set('type', value);
        return next;
      },
      { replace: true },
    );
  };

  let body: ReactNode;
  if (list.data === undefined && list.isError) {
    const { message, requestId } = describeError(list.error);
    body = (
      <ErrorState
        title="Could not load files"
        message={message}
        requestId={requestId}
        retrying={list.isFetching}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (list.data === undefined) {
    body = <LoadingState label="Loading files…" />;
  } else if (items.length === 0) {
    const noun = typeFilter === 'image' ? 'images' : typeFilter === 'video' ? 'videos' : 'files';
    body =
      query !== '' ? (
        <EmptyState
          title="No files match"
          description={`Nothing has a name containing “${query}”. Clear the search to see every file.`}
        />
      ) : (
        <EmptyState
          title={typeFilter === 'all' ? 'No files yet' : `No ${noun} yet`}
          description={
            productId === undefined
              ? 'Upload images or videos above. They appear here.'
              : 'Upload images or videos above. Then choose one as the cover.'
          }
        />
      );
  } else {
    body = (
      <div className="space-y-4">
        {list.isError ? (
          <ErrorState
            title="Could not refresh files"
            message={describeError(list.error).message}
            requestId={describeError(list.error).requestId}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        <ul aria-label="Files" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((asset) => (
            <li key={asset.id}>
              <AssetTile
                asset={asset}
                client={client}
                isCover={product?.primaryAssetId === asset.id}
                onOpen={() => setSelectedId(asset.id)}
                onMediaError={refreshMedia}
              />
            </li>
          ))}
        </ul>
        {list.hasNextPage ? (
          <div>
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={galleryRef} tabIndex={-1} className="space-y-4 focus:outline-none">
      <div className="flex max-w-xl flex-wrap items-end gap-3">
        <TextField
          label="Search by name"
          type="search"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label="Type"
          options={TYPE_OPTIONS}
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        />
      </div>

      {body}

      {selected === null ? null : (
        <AssetPreviewDialog
          key={selected.id}
          workspaceId={workspaceId}
          asset={selected}
          {...(product === undefined ? {} : { product })}
          onClose={() => setSelectedId(null)}
          onDeleted={() => {
            setSelectedId(null);
            galleryRef.current?.focus();
          }}
          onMediaError={refreshMedia}
        />
      )}
    </div>
  );
}
