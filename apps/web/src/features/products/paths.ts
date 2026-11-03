import type { ProductStatus } from '@creatorops/contracts';

export const productsPath = (workspaceId: string): string =>
  `/w/${encodeURIComponent(workspaceId)}/products`;

export const newProductPath = (workspaceId: string): string => `${productsPath(workspaceId)}/new`;

export const productPath = (workspaceId: string, productId: string): string =>
  `${productsPath(workspaceId)}/${encodeURIComponent(productId)}`;

/** The only query-string value the product list keeps: `?status=archived`. Anything else is Active. */
export function statusFromParam(value: string | null): ProductStatus {
  return value === 'archived' ? 'archived' : 'active';
}
