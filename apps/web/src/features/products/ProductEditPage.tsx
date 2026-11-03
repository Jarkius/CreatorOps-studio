import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ApiError } from '@creatorops/contracts';
import type { CreateProductRequest, Product, UpdateProductRequest } from '@creatorops/contracts';
import { Button, ConfirmDialog, ErrorState, LoadingState, StatusPill } from '@creatorops/ui';

import { describeError, isNotFound } from '../errors.js';
import { formatDate } from './format.js';
import { ProductForm } from './ProductForm.js';
import { productsPath } from './paths.js';
import { useProduct, useSetProductArchived, useUpdateProduct } from './productQueries.js';
import { NotFoundNotice } from './ProductStates.js';

export function ProductEditPage() {
  const { workspaceId = '', productId = '' } = useParams();
  const navigate = useNavigate();
  const productQuery = useProduct(workspaceId, productId);
  const update = useUpdateProduct(workspaceId, productId);
  const archive = useSetProductArchived(workspaceId, productId);

  const [conflict, setConflict] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const product = productQuery.data;

  if (product === undefined) {
    if (productQuery.isError && isNotFound(productQuery.error)) {
      return (
        <NotFoundNotice
          title="Product not found"
          description="This product does not exist in this workspace, or it was removed."
          backTo={productsPath(workspaceId)}
          backLabel="Back to products"
        />
      );
    }
    if (productQuery.isError) {
      const { message, requestId } = describeError(productQuery.error);
      return (
        <ErrorState
          message={message}
          requestId={requestId}
          retrying={productQuery.isFetching}
          onRetry={() => void productQuery.refetch()}
        />
      );
    }
    return <LoadingState label="Loading product…" />;
  }

  // Sent to the API with the version we loaded; a 409 means someone else saved first.
  const save = async (body: CreateProductRequest | UpdateProductRequest): Promise<Product> => {
    setActionMessage(null);
    setActionError(null);
    try {
      const saved = await update.mutateAsync(body as UpdateProductRequest);
      setConflict(false);
      return saved;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') setConflict(true);
      throw error;
    }
  };

  const loadLatest = async () => {
    const result = await productQuery.refetch();
    if (result.data !== undefined) {
      setConflict(false);
      setResetKey((value) => value + 1);
    }
  };

  const runArchive = async () => {
    setActionError(null);
    try {
      await archive.mutateAsync(true);
      setConfirmOpen(false);
      navigate(productsPath(workspaceId));
    } catch (error) {
      setConfirmOpen(false);
      setActionError(describeError(error).message);
    }
  };

  const restore = async () => {
    setActionMessage(null);
    setActionError(null);
    try {
      await archive.mutateAsync(false);
      setActionMessage('Product restored');
    } catch (error) {
      setActionError(describeError(error).message);
    }
  };

  const isArchived = product.status === 'archived';

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-3">
        <Link
          to={productsPath(workspaceId)}
          className="inline-flex min-h-11 items-center text-[var(--co-accent)] underline underline-offset-4"
        >
          Back to products
        </Link>
        <h1 className="text-2xl font-semibold leading-relaxed [overflow-wrap:anywhere]">
          {product.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--co-text-muted)]">
          <StatusPill status={product.status} />
          <span>Version {product.version}</span>
          <span>Updated {formatDate(product.updatedAt)}</span>
        </div>
      </header>

      {conflict ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--co-danger)] p-4 leading-relaxed"
        >
          <p>This product was changed by someone else.</p>
          <Button variant="secondary" onClick={() => void loadLatest()}>
            Load latest
          </Button>
        </div>
      ) : null}

      {productQuery.isError ? (
        <ErrorState
          title="Could not refresh the product"
          message={describeError(productQuery.error).message}
          requestId={describeError(productQuery.error).requestId}
          retrying={productQuery.isFetching}
          onRetry={() => void productQuery.refetch()}
        />
      ) : null}

      <section aria-labelledby="status-heading" className="space-y-3">
        <h2 id="status-heading" className="text-base font-semibold">
          Status
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {isArchived ? (
            <Button variant="secondary" loading={archive.isPending} onClick={() => void restore()}>
              Restore
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Archive
            </Button>
          )}
          {actionMessage === null ? null : (
            <p role="status" className="font-medium text-[var(--co-success)]">
              {actionMessage}
            </p>
          )}
          {actionError === null ? null : (
            <p role="alert" className="text-[var(--co-danger)]">
              {actionError}
            </p>
          )}
        </div>
      </section>

      <ProductForm
        mode="edit"
        product={product}
        resetKey={resetKey}
        submitLabel="Save product"
        onSave={save}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={`Archive ${product.name}?`}
        description="It moves to Archived and leaves the Active list. You can restore it at any time."
        confirmLabel="Archive product"
        confirmVariant="danger"
        busy={archive.isPending}
        onConfirm={() => void runArchive()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
