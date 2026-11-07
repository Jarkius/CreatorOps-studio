import { ApiError, PRODUCT_LIMITS, type ApiClient, type Product } from '@creatorops/contracts';
import { Button } from '@creatorops/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { dashboardHref } from '../format.js';
import { createChromeBrowser } from '../metaai/browser.js';
import type { MetaAiBrowser } from '../metaai/runner.js';
import { importShopeeOffers, ShopeeImportError } from './import.js';
import { earningPerSale, visibleOffers, type OfferSort } from './offers.js';
import { advanceShopeeList, readShopeeOffers, type ShopeeOffer } from './page.js';
import { SHOPEE_AFFILIATE_PATTERN, SHOPEE_MAX_STEPS, SHOPEE_STEP_DELAY_MS } from './selectors.js';

/** The Shopee Affiliate site, for the shared browser wrapper (D-082). */
export const SHOPEE_SITE = {
  name: 'Shopee Affiliate',
  origins: [SHOPEE_AFFILIATE_PATTERN],
  tabPatterns: [SHOPEE_AFFILIATE_PATTERN],
} as const;

export interface ShopeePanelProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly dashboardUrl: string;
  /** Owner, admin and editor: may create products. Anyone may import (it only reads a page). */
  readonly canCreate: boolean;
  /** Replaced in tests. */
  readonly browser?: MetaAiBrowser;
  readonly read?: typeof readShopeeOffers;
  readonly advance?: typeof advanceShopeeList;
  /** Replaced in tests so the wait between steps is instant. */
  readonly stepDelayMs?: number;
}

const baht = (value: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(value);

type Status =
  | { readonly phase: 'idle' }
  | { readonly phase: 'reading' }
  | { readonly phase: 'failed'; readonly message: string; readonly diagnostics: string };

/**
 * Lists the products shown on the owner's own Shopee Affiliate page, with their commission, and
 * turns one into a CreatorOps product (D-082). The list lives in the panel only; nothing about
 * Shopee is stored except the product the owner chooses to create.
 */
export function ShopeePanel(props: ShopeePanelProps) {
  const { api, workspaceId, dashboardUrl, canCreate } = props;
  const queryClient = useQueryClient();
  const [offers, setOffers] = useState<readonly ShopeeOffer[]>([]);
  const [status, setStatus] = useState<Status>({ phase: 'idle' });
  const [sort, setSort] = useState<OfferSort>('commission');
  const [minimum, setMinimum] = useState('');
  const [created, setCreated] = useState<Readonly<Record<string, Product>>>({});
  const [copied, setCopied] = useState(false);
  const [loadMore, setLoadMore] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [stopNote, setStopNote] = useState<string | null>(null);
  const cancelled = useRef(false);

  const minCommission = Number(minimum.trim() === '' ? '0' : minimum);
  const shown = visibleOffers(offers, sort, Number.isFinite(minCommission) ? minCommission : 0);

  const runImport = () => {
    const browser = props.browser ?? createChromeBrowser(SHOPEE_SITE);
    // Chrome only shows its prompt from a click, so ask before anything else is awaited.
    const granted = browser.requestPermission();
    setStatus({ phase: 'reading' });
    setCopied(false);
    setProgress(null);
    setStopNote(null);
    cancelled.current = false;
    void (async () => {
      try {
        if (!(await granted)) {
          setStatus({
            phase: 'failed',
            message:
              'Shopee Affiliate was not allowed. The importer only reads that one site, and only after you allow it.',
            diagnostics: 'permission refused',
          });
          return;
        }
        const found = await importShopeeOffers({
          browser,
          read: props.read ?? readShopeeOffers,
          ...(loadMore
            ? {
                loadMore: {
                  advance: props.advance ?? advanceShopeeList,
                  maxSteps: SHOPEE_MAX_STEPS,
                  delayMs: props.stepDelayMs ?? SHOPEE_STEP_DELAY_MS,
                  cancelled: () => cancelled.current,
                  onProgress: (count: number, step: number) =>
                    setProgress(`Step ${step} of ${SHOPEE_MAX_STEPS}: ${count} products read`),
                  onStop: (reason: string) => setStopNote(reason),
                },
              }
            : {}),
        });
        setOffers(found);
        setStatus({ phase: 'idle' });
      } catch (error) {
        const known = error instanceof ShopeeImportError ? error : null;
        setStatus({
          phase: 'failed',
          message:
            known?.message ?? 'Something went wrong. Use Copy diagnostics and send it for a fix.',
          diagnostics: known?.diagnostics ?? 'unexpected error',
        });
      }
    })();
  };

  const create = useMutation({
    mutationFn: (offer: ShopeeOffer) =>
      api.products.create(workspaceId, {
        name: offer.name.slice(0, PRODUCT_LIMITS.name),
        ...(offer.priceThb === null
          ? {}
          : { priceAmount: offer.priceThb.toFixed(2), currency: 'THB' }),
        sourceUrl: offer.link,
      }),
    onSuccess: (product, offer) => {
      setCreated((previous) => ({ ...previous, [offer.link]: product }));
      void queryClient.invalidateQueries({ queryKey: ['products', workspaceId] });
    },
  });

  return (
    <section
      aria-label="Shopee Affiliate"
      className="rounded-md border border-[var(--co-border)] p-3"
    >
      <h2 className="text-base font-semibold">Shopee Affiliate</h2>
      <p className="mt-1 text-sm text-[var(--co-text-muted)]">
        Open your Shopee Affiliate product list in a tab, then import it here. The importer only
        reads what the page shows and never signs in. With "Load more" ticked it also scrolls down
        the list and presses the page's own Next button, a few steps with a fixed wait, in the tab
        you can see; it stops at a Shopee check, a slow-down notice or a sign-in page and never gets
        past them. Chrome asks once to allow Shopee Affiliate.
      </p>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={loadMore}
          disabled={status.phase === 'reading'}
          onChange={(event) => setLoadMore(event.target.checked)}
        />
        {`Load more of the list (up to ${SHOPEE_MAX_STEPS} steps)`}
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button disabled={status.phase === 'reading'} onClick={runImport}>
          {status.phase === 'reading'
            ? 'Reading the page…'
            : offers.length === 0
              ? 'Import from Shopee affiliate page'
              : 'Import again'}
        </Button>
        {status.phase === 'reading' && loadMore ? (
          <Button variant="secondary" onClick={() => (cancelled.current = true)}>
            Stop loading
          </Button>
        ) : null}
      </div>
      {progress !== null && status.phase === 'reading' ? (
        <p role="status" className="mt-2 text-sm">
          {progress}
        </p>
      ) : null}
      {stopNote !== null && status.phase !== 'reading' ? (
        <p role="status" className="mt-2 text-sm">
          {stopNote}
        </p>
      ) : null}
      {status.phase === 'failed' ? (
        <div className="mt-2 space-y-1">
          <p role="alert" className="text-sm text-[var(--co-danger)] [overflow-wrap:anywhere]">
            {status.message}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(status.diagnostics).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            Copy diagnostics
          </Button>
          {copied ? (
            <span role="status" className="ml-2 text-sm">
              Copied
            </span>
          ) : null}
        </div>
      ) : null}

      {offers.length > 0 ? (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block">Sort by</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as OfferSort)}
                className="mt-1 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] p-1"
              >
                <option value="commission">Commission %</option>
                <option value="earning">Earning per sale</option>
                <option value="sales">Sales</option>
                <option value="price">Price</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block">Minimum commission %</span>
              <input
                inputMode="decimal"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                className="mt-1 w-20 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] p-1"
              />
            </label>
          </div>
          <p className="mt-2 text-sm text-[var(--co-text-muted)]">
            {`${shown.length} of ${offers.length} products. Earning per sale is price × commission, before Shopee's own deductions and caps.`}
          </p>
          <ul aria-label="Shopee offers" className="mt-2 space-y-2">
            {shown.map((offer) => {
              const earning = earningPerSale(offer);
              const product = created[offer.link];
              return (
                <li
                  key={offer.link}
                  className="min-w-0 rounded-md border border-[var(--co-border)] p-2"
                >
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">{offer.name}</p>
                  <p className="mt-1 text-sm">
                    <span>
                      {offer.priceThb === null ? 'Price not shown' : baht(offer.priceThb)}
                    </span>
                    {' · '}
                    <span>
                      {offer.commissionPercent === null
                        ? 'Commission not shown'
                        : `Commission ${offer.commissionPercent}%`}
                    </span>
                    {earning === null ? null : <span>{` · ≈ ${baht(earning)} per sale`}</span>}
                    {offer.sales === null ? null : <span>{` · Sold ${offer.sales}`}</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {product !== undefined ? (
                      <a
                        href={dashboardHref(
                          dashboardUrl,
                          `/w/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(product.id)}`,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline"
                      >
                        Product created: open it
                      </a>
                    ) : canCreate ? (
                      <Button
                        variant="secondary"
                        aria-label={`Create product from ${offer.name}`}
                        disabled={create.isPending}
                        onClick={() => create.mutate(offer)}
                      >
                        {create.isPending && create.variables?.link === offer.link
                          ? 'Creating…'
                          : 'Create product'}
                      </Button>
                    ) : null}
                  </div>
                  {create.isError && create.variables?.link === offer.link ? (
                    <p role="alert" className="mt-1 text-sm text-[var(--co-danger)]">
                      {create.error instanceof ApiError
                        ? create.error.message
                        : 'Could not create the product. Please try again.'}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
