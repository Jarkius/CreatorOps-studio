import type { MetaAiBrowser } from '../metaai/runner.js';
import type { AdvanceResult, ShopeeHints, ShopeeOffer, ShopeeRead } from './page.js';
import { SHOPEE_HINTS, SHOPEE_MAX_OFFERS, SHOPEE_OFFER_URL } from './selectors.js';

export type ShopeeImportCode =
  | 'PERMISSION_DENIED'
  | 'OPENED'
  | 'LOGIN_REQUIRED'
  | 'CHALLENGE'
  | 'RATE_LIMITED'
  | 'NOTHING_FOUND'
  | 'PAGE_NOT_RECOGNISED';

export class ShopeeImportError extends Error {
  readonly code: ShopeeImportCode;
  /** What the reader saw, for "Copy diagnostics". Never page text, links or cookies. */
  readonly diagnostics: string;
  constructor(code: ShopeeImportCode, message: string, diagnostics: string) {
    super(message);
    this.name = 'ShopeeImportError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

/** Optional: scroll and page down the list, visibly, within fixed limits (the owner's request). */
export interface LoadMoreOptions {
  readonly advance: () => AdvanceResult;
  /** At most this many scroll or next-page steps. */
  readonly maxSteps: number;
  /** A fixed wait after each step so the page can load (not randomised, not disguised). */
  readonly delayMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Checked before every step; true stops and keeps what was read. */
  readonly cancelled?: () => boolean;
  /** Called with the number of products read so far, and a stop reason when loading ends. */
  readonly onProgress?: (count: number, step: number) => void;
  readonly onStop?: (reason: string) => void;
}

export interface ImportOptions {
  readonly browser: MetaAiBrowser;
  readonly read: (hints: ShopeeHints, maxItems: number) => ShopeeRead;
  readonly hints?: ShopeeHints;
  readonly loadMore?: LoadMoreOptions;
}

function describe(read: ShopeeRead | null, note: string): string {
  return [
    'CreatorOps Shopee importer diagnostics',
    `time: ${new Date().toISOString()}`,
    `note: ${note}`,
    ...(read === null
      ? []
      : [
          `title: ${read.title}`,
          `path: ${read.path}`,
          `state: ${read.state}`,
          `product links seen: ${read.linksSeen}`,
          `products read: ${read.offers.length}`,
          `with a commission: ${read.offers.filter((o) => o.commissionPercent !== null).length}`,
          `with a price: ${read.offers.filter((o) => o.priceThb !== null).length}`,
        ]),
  ].join('\n');
}

/**
 * Reads the products shown in the owner's own Shopee Affiliate tab (D-082). The permission must
 * already be granted (the panel asks for it in the click handler, before any wait). Nothing is
 * clicked, typed or fetched: when no tab is open, one is opened visibly and the owner is asked to
 * sign in, filter the list, and press Import again.
 */
export async function importShopeeOffers(options: ImportOptions): Promise<readonly ShopeeOffer[]> {
  const { browser } = options;
  const hints = options.hints ?? SHOPEE_HINTS;
  if (!(await browser.hasPermission())) {
    throw new ShopeeImportError(
      'PERMISSION_DENIED',
      'Chrome has not allowed this extension to read the Shopee Affiliate site.',
      describe(null, 'no permission'),
    );
  }
  const tab = await browser.findTab();
  if (tab === null) {
    await browser.openTab(SHOPEE_OFFER_URL, 30_000).catch(() => undefined);
    throw new ShopeeImportError(
      'OPENED',
      'Opened Shopee Affiliate in a new tab. Sign in, open the product list you want, then press Import again.',
      describe(null, 'no Shopee Affiliate tab was open; one was opened'),
    );
  }
  let read: ShopeeRead;
  try {
    read = await browser.run(tab, options.read, [hints, SHOPEE_MAX_OFFERS]);
  } catch {
    throw new ShopeeImportError(
      'PAGE_NOT_RECOGNISED',
      'The importer could not read the Shopee Affiliate tab. Keep it open and try again.',
      describe(null, 'the tab could not be read'),
    );
  }
  if (read.state === 'challenge') {
    await browser.focusTab?.(tab).catch(() => undefined);
    throw new ShopeeImportError(
      'CHALLENGE',
      'Shopee is showing a check in that tab. Finish it there, then press Import again. The importer does not solve it.',
      describe(read, 'check page'),
    );
  }
  if (read.state === 'limit') {
    throw new ShopeeImportError(
      'RATE_LIMITED',
      'Shopee says to slow down. Wait a while, then try again.',
      describe(read, 'limit page'),
    );
  }
  if (read.state === 'login') {
    await browser.focusTab?.(tab).catch(() => undefined);
    throw new ShopeeImportError(
      'LOGIN_REQUIRED',
      'Shopee Affiliate is asking you to sign in. Sign in in that tab, then press Import again.',
      describe(read, 'sign-in page'),
    );
  }
  if (read.offers.length === 0) {
    throw new ShopeeImportError(
      'NOTHING_FOUND',
      'No products were found on that page. Open the product list, scroll so the products show, then try again.',
      describe(read, 'no products'),
    );
  }
  const more = options.loadMore;
  if (more === undefined) return read.offers;

  const byLink = new Map<string, ShopeeOffer>(read.offers.map((offer) => [offer.link, offer]));
  const sleep = more.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let quiet = 0;
  for (let step = 1; step <= more.maxSteps; step += 1) {
    if (more.cancelled?.() === true) return stop(more, byLink, 'Stopped by you.');
    if (byLink.size >= SHOPEE_MAX_OFFERS) {
      return stop(more, byLink, `Reached the limit of ${SHOPEE_MAX_OFFERS} products.`);
    }
    let moved: AdvanceResult;
    try {
      moved = await browser.run(tab, more.advance, []);
    } catch {
      return stop(more, byLink, 'The tab could not be scrolled. Kept what was read.');
    }
    if (moved === 'none') return stop(more, byLink, 'Reached the end of the list.');
    await sleep(more.delayMs);
    let next: ShopeeRead;
    try {
      next = await browser.run(tab, options.read, [hints, SHOPEE_MAX_OFFERS]);
    } catch {
      return stop(more, byLink, 'The tab could not be read. Kept what was read.');
    }
    if (next.state === 'challenge' || next.state === 'limit' || next.state === 'login') {
      if (next.state !== 'limit') await browser.focusTab?.(tab).catch(() => undefined);
      return stop(
        more,
        byLink,
        next.state === 'challenge'
          ? 'Shopee is showing a check. Loading stopped; finish the check in that tab yourself.'
          : next.state === 'limit'
            ? 'Shopee says to slow down. Loading stopped; wait a while before importing again.'
            : 'Shopee asked you to sign in. Loading stopped.',
      );
    }
    const before = byLink.size;
    for (const offer of next.offers) if (!byLink.has(offer.link)) byLink.set(offer.link, offer);
    more.onProgress?.(byLink.size, step);
    quiet = byLink.size === before ? quiet + 1 : 0;
    if (quiet >= 3) return stop(more, byLink, 'No new products after three steps.');
  }
  return stop(more, byLink, `Stopped after ${more.maxSteps} steps.`);
}

function stop(
  more: LoadMoreOptions,
  byLink: ReadonlyMap<string, ShopeeOffer>,
  reason: string,
): readonly ShopeeOffer[] {
  more.onStop?.(reason);
  return Array.from(byLink.values());
}
