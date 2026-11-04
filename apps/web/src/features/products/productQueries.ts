import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateProductRequest,
  Product,
  ProductStatus,
  UpdateProductRequest,
} from '@creatorops/contracts';

import { useDashboard } from '../../app/dashboard-context.js';

export const PAGE_SIZE = 25;

/** Query keys. Every product key starts with ['products', workspaceId] so one prefix clears them. */
export const productKeys = {
  lists: (workspaceId: string) => ['products', workspaceId, 'list'] as const,
  list: (workspaceId: string, status: ProductStatus) =>
    ['products', workspaceId, 'list', status] as const,
  detail: (workspaceId: string, productId: string) =>
    ['products', workspaceId, 'detail', productId] as const,
};

export function useProductList(workspaceId: string, status: ProductStatus) {
  const { client } = useDashboard();
  return useInfiniteQuery({
    queryKey: productKeys.list(workspaceId, status),
    queryFn: ({ pageParam }) =>
      client.products.list(workspaceId, { status, limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useProduct(
  workspaceId: string,
  productId: string,
  options: { enabled?: boolean } = {},
) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: productKeys.detail(workspaceId, productId),
    queryFn: () => client.products.get(workspaceId, productId),
    enabled: options.enabled ?? true,
  });
}

export function useCreateProduct(workspaceId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductRequest) => client.products.create(workspaceId, body),
    onSuccess: (product) => {
      queryClient.setQueryData(productKeys.detail(workspaceId, product.id), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.lists(workspaceId) });
    },
  });
}

export function useUpdateProduct(workspaceId: string, productId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProductRequest) =>
      client.products.update(workspaceId, productId, body),
    onSuccess: (product: Product) => {
      queryClient.setQueryData(productKeys.detail(workspaceId, productId), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.lists(workspaceId) });
    },
  });
}

/** Archive (true) or restore (false). */
export function useSetProductArchived(workspaceId: string, productId: string) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) =>
      archived
        ? client.products.archive(workspaceId, productId)
        : client.products.unarchive(workspaceId, productId),
    onSuccess: (product: Product) => {
      queryClient.setQueryData(productKeys.detail(workspaceId, productId), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.lists(workspaceId) });
    },
  });
}
