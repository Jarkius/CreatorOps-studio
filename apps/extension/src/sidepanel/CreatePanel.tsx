import { ApiError, type ApiClient, type Product, type Template } from '@creatorops/contracts';
import { Button, EmptyState, ErrorState, LoadingState } from '@creatorops/ui';
import { useState } from 'react';

import { createSteps, pickedInputs } from './create.js';
import { useCreateContent, useCreateProducts, useCreateTemplates } from './createHooks.js';
import { dashboardHref } from './format.js';

export interface CreatePanelProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly dashboardUrl: string;
  /** Owner, admin and editor only; the API still enforces it. */
  readonly canStart: boolean;
}

/**
 * The quick-start of the side panel (A1): pick a product and a mode, see the checklist, press one
 * button. It creates the campaign and starts generation; progress shows in Campaigns below.
 */
export function CreatePanel({ api, workspaceId, dashboardUrl, canStart }: CreatePanelProps) {
  const products = useCreateProducts(api, workspaceId);
  const templates = useCreateTemplates(api, workspaceId);
  const create = useCreateContent(api, workspaceId);
  const [productId, setProductId] = useState('');
  const [templateId, setTemplateId] = useState('');

  const productItems: readonly Product[] = products.data?.items ?? [];
  const templateItems: readonly Template[] = templates.data?.items ?? [];
  // Until the user chooses, the first mode is selected so one click is enough for a quick start.
  const effectiveTemplateId = templateId || templateItems[0]?.id || '';
  const picked = pickedInputs(productItems, templateItems, productId, effectiveTemplateId);
  const loadError = [products.error, templates.error].find((error) => error instanceof ApiError);
  const startError = create.error instanceof ApiError ? create.error : null;
  const newProductHref = dashboardHref(
    dashboardUrl,
    `/w/${encodeURIComponent(workspaceId)}/products/new`,
  );

  return (
    <section
      aria-labelledby="create-heading"
      className="rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4"
    >
      <h2 id="create-heading" className="text-base font-semibold">
        Create content
      </h2>

      {products.isPending || templates.isPending ? (
        <LoadingState label="Loading products and modes…" />
      ) : null}

      {products.isError || templates.isError ? (
        <div className="mt-3">
          <ErrorState
            message={loadError?.message ?? 'Something went wrong. Please try again.'}
            {...(loadError?.requestId ? { requestId: loadError.requestId } : {})}
            onRetry={() => {
              void products.refetch();
              void templates.refetch();
            }}
            retrying={products.isFetching || templates.isFetching}
          />
        </div>
      ) : null}

      {products.isSuccess && templates.isSuccess && productItems.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="Add a product first"
            description="Content is made from a product. Create one in the dashboard, then come back."
            action={
              <a
                href={newProductHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-[var(--co-accent)] underline underline-offset-4"
              >
                Create product
              </a>
            }
          />
        </div>
      ) : null}

      {products.isSuccess && templates.isSuccess && productItems.length > 0 ? (
        <form
          className="mt-3 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (picked !== null) create.mutate(picked);
          }}
        >
          <div>
            <label htmlFor="create-product" className="text-sm font-medium">
              Product
            </label>
            <select
              id="create-product"
              value={productId}
              onChange={(event) => {
                setProductId(event.target.value);
                create.reset();
              }}
              className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] px-2 text-sm [overflow-wrap:anywhere]"
            >
              <option value="">Choose a product</option>
              {productItems.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Mode</legend>
            <div className="mt-1 grid grid-cols-1 gap-2">
              {templateItems.map((template) => (
                <label
                  key={template.id}
                  className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-[var(--co-border)] p-2 has-[:checked]:border-[var(--co-accent)]"
                >
                  <input
                    type="radio"
                    name="create-mode"
                    value={template.id}
                    checked={template.id === effectiveTemplateId}
                    onChange={() => {
                      setTemplateId(template.id);
                      create.reset();
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{template.name.en}</span>
                    <span className="block text-sm text-[var(--co-text-muted)] [overflow-wrap:anywhere]">
                      {template.name.th}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <ol aria-label="What happens" className="space-y-1 text-sm">
            {createSteps().map((step) => (
              <li key={step.id} className="flex items-center gap-2">
                <span aria-hidden="true">{step.state === 'ready' ? '☑' : '☐'}</span>
                <span className={step.state === 'soon' ? 'text-[var(--co-text-muted)]' : ''}>
                  {step.label}
                  {step.state === 'soon' ? ' (coming next)' : ''}
                </span>
              </li>
            ))}
          </ol>

          {canStart ? (
            <Button type="submit" loading={create.isPending} disabled={picked === null}>
              {create.isPending ? 'Starting…' : 'Create content'}
            </Button>
          ) : (
            <p className="text-sm text-[var(--co-text-muted)]">
              You can view content here. Ask an owner or editor to create it.
            </p>
          )}

          {startError !== null ? (
            <p role="alert" className="text-sm text-[var(--co-danger)]">
              {startError.message}
              {startError.requestId ? ` (request ${startError.requestId})` : ''}
            </p>
          ) : null}
          {create.error !== null && startError === null ? (
            <p role="alert" className="text-sm text-[var(--co-danger)]">
              Something went wrong. Please try again.
            </p>
          ) : null}
          {create.isSuccess ? (
            <p role="status" className="text-sm">
              Started. Follow it under Campaigns below.
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
