import { ApiError, type ApiClient, type Product } from '@creatorops/contracts';
import { EmptyState, ErrorState, LoadingState, StatusPill } from '@creatorops/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { dashboardHref, formatPrice } from './format.js';

/** How many of the newest active products the panel shows. */
export const PANEL_PRODUCT_LIMIT = 10;

export interface ProductsPanelProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly dashboardUrl: string;
}

/**
 * Read-only list of a workspace's newest active products, with links into the dashboard where
 * products are created and edited. It holds no business logic.
 */
export function ProductsPanel({ api, workspaceId, dashboardUrl }: ProductsPanelProps) {
  const products = useQuery({
    queryKey: ['products', workspaceId],
    queryFn: () => api.products.list(workspaceId, { status: 'active', limit: PANEL_PRODUCT_LIMIT }),
  });
  const error = products.error instanceof ApiError ? products.error : null;

  const workspacePath = `/w/${encodeURIComponent(workspaceId)}`;
  const createHref = dashboardHref(dashboardUrl, `${workspacePath}/products/new`);
  const viewAllHref = dashboardHref(dashboardUrl, `${workspacePath}/products`);
  const productHref = (product: Product) =>
    dashboardHref(dashboardUrl, `${workspacePath}/products/${encodeURIComponent(product.id)}`);
  const items = products.data?.items ?? [];

  return (
    <section
      aria-labelledby="products-heading"
      className="rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4"
    >
      <h2 id="products-heading" className="text-base font-semibold">
        Products
      </h2>

      {products.isPending ? <LoadingState label="Loading products…" /> : null}

      {products.isError ? (
        <div className="mt-3">
          <ErrorState
            message={error?.message ?? 'Something went wrong. Please try again.'}
            {...(error?.requestId ? { requestId: error.requestId } : {})}
            onRetry={() => void products.refetch()}
            retrying={products.isFetching}
          />
        </div>
      ) : null}

      {products.isSuccess && items.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No products yet"
            description="Products you create in the dashboard appear here."
            action={<ActionLink href={createHref}>Create product</ActionLink>}
          />
        </div>
      ) : null}

      {products.isSuccess && items.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {items.map((product) => (
            <ProductRow key={product.id} product={product} href={productHref(product)} />
          ))}
        </ul>
      ) : null}

      {products.isSuccess ? (
        <footer className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {items.length > 0 ? <ActionLink href={createHref}>Create product</ActionLink> : null}
          <ActionLink href={viewAllHref}>View all products</ActionLink>
        </footer>
      ) : null}
    </section>
  );
}

function ProductRow({ product, href }: { product: Product; href: string }) {
  const price =
    product.priceAmount === null ? null : formatPrice(product.priceAmount, product.currency);
  return (
    <li className="min-w-0 rounded-md border border-[var(--co-border)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{product.name}</p>
        <div className="shrink-0">
          <StatusPill status="active" />
        </div>
      </div>
      {price === null ? null : (
        <p className="mt-1 text-sm text-[var(--co-text-muted)] [overflow-wrap:anywhere]">{price}</p>
      )}
      <div className="mt-2">
        <ActionLink href={href} label={`Open ${product.name}`}>
          Open
        </ActionLink>
      </div>
    </li>
  );
}

/** A link into the dashboard; it opens in a new tab without giving the page access to the panel. */
function ActionLink({
  href,
  label,
  children,
}: {
  href: string;
  /** Accessible name when the visible text alone is not enough, for example "Open <product>". */
  label?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      {...(label === undefined ? {} : { 'aria-label': label })}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center py-2 text-sm underline [overflow-wrap:anywhere]"
    >
      {children}
    </a>
  );
}
