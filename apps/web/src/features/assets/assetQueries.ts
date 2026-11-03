import { useCallback, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';

import type { AssetListResponse, AssetType, Product } from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';
import { productKeys } from '../products/productQueries.js';

export const ASSET_PAGE_SIZE = 24;

/** What a gallery shows: the whole workspace, or one product's files, optionally one type. */
export interface AssetScope {
  readonly productId?: string;
  readonly type?: AssetType;
}

/** Every asset key starts with ['assets', workspaceId] so one prefix clears them all. */
export const assetKeys = {
  all: (workspaceId: string) => ['assets', workspaceId] as const,
  lists: (workspaceId: string) => ['assets', workspaceId, 'list'] as const,
  list: (workspaceId: string, scope: AssetScope) => ['assets', workspaceId, 'list', scope] as const,
  detail: (workspaceId: string, assetId: string) =>
    ['assets', workspaceId, 'detail', assetId] as const,
};

export function useAssetList(workspaceId: string, scope: AssetScope) {
  const { client } = useDashboard();
  return useInfiniteQuery({
    queryKey: assetKeys.list(workspaceId, scope),
    queryFn: ({ pageParam }) =>
      client.assets.list(workspaceId, { ...scope, limit: ASSET_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useAsset(workspaceId: string, assetId: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: assetKeys.detail(workspaceId, assetId),
    queryFn: () => client.assets.get(workspaceId, assetId),
  });
}

/**
 * Signed media URLs expire after 15 minutes. When an image or video fails to load, the lists are
 * refetched so fresh URLs arrive. Only the first failure per mount does this, so a broken file
 * cannot cause a loop.
 */
export function useMediaRefresh(workspaceId: string): () => void {
  const queryClient = useQueryClient();
  const refreshed = useRef(false);
  return useCallback(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    void queryClient.invalidateQueries({ queryKey: assetKeys.all(workspaceId) });
  }, [queryClient, workspaceId]);
}

/** Deletes a file and removes it from every cached list at once. Covers pointing at it are cleared by the API. */
export function useDeleteAsset(workspaceId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => client.assets.delete(workspaceId, assetId),
    onSuccess: (_result, assetId) => {
      queryClient.setQueriesData<InfiniteData<AssetListResponse>>(
        { queryKey: assetKeys.lists(workspaceId) },
        (data) =>
          data === undefined
            ? data
            : {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((item) => item.id !== assetId),
                })),
              },
      );
      queryClient.removeQueries({ queryKey: assetKeys.detail(workspaceId, assetId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.lists(workspaceId) });
      // Deleting a cover changes its product (cleared cover, new version), so product data is stale.
      void queryClient.invalidateQueries({ queryKey: ['products', workspaceId] });
    },
  });
}

/** Sets or clears a product's cover. Sends the version the caller last saw; a stale one is a 409. */
export function useSetCover(workspaceId: string, productId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ version, primaryAssetId }: { version: number; primaryAssetId: string | null }) =>
      client.products.update(workspaceId, productId, { version, primaryAssetId }),
    onSuccess: (product: Product) => {
      queryClient.setQueryData(productKeys.detail(workspaceId, productId), product);
      // Refetch so the page shows the server's version, not just the one we sent.
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(workspaceId, productId) });
    },
  });
}

/** Reloads one product, for example after a cover conflict. */
export function useRefreshProduct(workspaceId: string, productId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: productKeys.detail(workspaceId, productId) }),
    [queryClient, workspaceId, productId],
  );
}
