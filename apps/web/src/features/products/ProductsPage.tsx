import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import type { Product, ProductStatus } from '@creatorops/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusPill,
  buttonClassName,
} from '@creatorops/ui';

import { describeError, isNotFound } from '../errors.js';
import { formatDate, formatPrice } from './format.js';
import { productPath, newProductPath, productsPath, statusFromParam } from './paths.js';
import { useProductList } from './productQueries.js';
import { NotFoundNotice } from './ProductStates.js';

const TABS: { status: ProductStatus; label: string }[] = [
  { status: 'active', label: 'Active' },
  { status: 'archived', label: 'Archived' },
];

const tabClass = (current: boolean) =>
  [
    'inline-flex min-h-11 items-center rounded-md px-4 py-2 font-medium leading-relaxed',
    current
      ? 'bg-[var(--co-accent)] text-[var(--co-accent-text)]'
      : 'border border-[var(--co-border)] hover:bg-[var(--co-surface)]',
  ].join(' ');

function ProductRow({ workspaceId, product }: { workspaceId: string; product: Product }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 leading-relaxed">
      <div className="min-w-0 flex-1">
        <Link
          to={productPath(workspaceId, product.id)}
          className="font-medium text-[var(--co-accent)] underline underline-offset-4 [overflow-wrap:anywhere]"
        >
          {product.name}
        </Link>
        <p className="text-sm text-[var(--co-text-muted)]">
          {formatPrice(product.priceAmount, product.currency)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusPill status={product.status} />
        <time dateTime={product.updatedAt} className="text-[var(--co-text-muted)]">
          Updated {formatDate(product.updatedAt)}
        </time>
      </div>
    </li>
  );
}

export function ProductsPage() {
  const { workspaceId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const status = statusFromParam(searchParams.get('status'));
  const list = useProductList(workspaceId, status);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const hasData = list.data !== undefined;

  if (!hasData && list.isError && isNotFound(list.error)) {
    return (
      <NotFoundNotice
        title="Workspace not found"
        description="This workspace does not exist or you cannot open it."
        backTo="/"
        backLabel="Go to Overview"
      />
    );
  }

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold leading-relaxed">Products</h1>
      <Link to={newProductPath(workspaceId)} className={buttonClassName('primary')}>
        Create product
      </Link>
    </header>
  );

  const tabs = (
    <nav aria-label="Product status">
      <ul className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <li key={tab.status}>
            <Link
              to={{ pathname: productsPath(workspaceId), search: `?status=${tab.status}` }}
              aria-current={status === tab.status ? 'page' : undefined}
              className={tabClass(status === tab.status)}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  let content: ReactNode;
  if (!hasData && list.isError) {
    const { message, requestId } = describeError(list.error);
    content = (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={list.isFetching}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (!hasData) {
    content = <LoadingState label="Loading products…" />;
  } else if (items.length === 0) {
    content =
      status === 'active' ? (
        <EmptyState
          title="No products yet"
          description="Add a product to start planning content for it."
          action={
            <Link to={newProductPath(workspaceId)} className={buttonClassName('primary')}>
              Create product
            </Link>
          }
        />
      ) : (
        <EmptyState title="No archived products" description="Archived products appear here." />
      );
  } else {
    content = (
      <div className="space-y-4">
        {list.isError ? (
          <ErrorState
            message={describeError(list.error).message}
            requestId={describeError(list.error).requestId}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        <ul
          aria-label={status === 'active' ? 'Active products' : 'Archived products'}
          className="divide-y divide-[var(--co-border)] rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)]"
        >
          {items.map((product) => (
            <ProductRow key={product.id} workspaceId={workspaceId} product={product} />
          ))}
        </ul>
        {list.hasNextPage ? (
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading more…' : 'Load more'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {header}
      {tabs}
      {content}
    </div>
  );
}
