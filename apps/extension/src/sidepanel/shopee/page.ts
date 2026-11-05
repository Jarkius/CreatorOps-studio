/**
 * Runs inside the owner's own Shopee Affiliate tab through `chrome.scripting.executeScript`
 * (D-082). It only READS what the page already shows: it clicks nothing, types nothing, makes no
 * request, and reads no cookies or storage. It must be self-contained (no imports, no closure
 * variables), because it is serialised and sent to the page.
 *
 * Shopee's markup is not known (the list needs a sign-in), so products are found by content: a
 * link to a Shopee product, and the block around it that shows a ฿ price; the commission is the
 * % next to a commission label (discounts such as "-20%" are ignored).
 */
export interface ShopeeHints {
  readonly loginHints: readonly string[];
  readonly challengeHints: readonly string[];
  /** Paths that mean Shopee's traffic check is showing. */
  readonly challengePaths: readonly string[];
  readonly limitHints: readonly string[];
}

export interface ShopeeOffer {
  readonly name: string;
  /** Lowest price shown, in baht, or null when none was found. */
  readonly priceThb: number | null;
  /** Commission in percent (12.5 means 12.5%), or null when the card shows none. */
  readonly commissionPercent: number | null;
  /** Sales as the page writes them, for example "1.2พัน" or "10k sold". */
  readonly sales: string | null;
  /** The product link without query string or fragment. */
  readonly link: string;
}

export interface ShopeeRead {
  readonly title: string;
  readonly path: string;
  readonly state: 'ready' | 'login' | 'challenge' | 'limit' | 'unknown';
  readonly offers: readonly ShopeeOffer[];
  /** Product links seen on the page (before de-duplication and the cap). */
  readonly linksSeen: number;
}

export function readShopeeOffers(hints: ShopeeHints, maxItems: number): ShopeeRead {
  const PRODUCT_PATH = /-i\.\d+\.\d+|\/product\/\d+\/\d+/;
  const COMMISSION_WORD = /ค่าคอม|คอมมิชชั่น|คอมมิชชัน|commission/i;
  const PERCENT = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/;
  const PRICE = /฿\s*([\d,]+(?:\.\d{1,2})?)/;
  const SALES_TH = /ขายแล้ว\s*([\d.,]+\s*(?:พัน|หมื่น|แสน|ล้าน|k|K)?\+?)/;
  const SALES_EN = /([\d.,]+\s*[kKmM]?\+?)\s*sold/i;
  const okHost = (host: string) =>
    host === 'shopee.co.th' || host.endsWith('.shopee.co.th') || host === 'shope.ee';

  const pageText = (document.body?.innerText ?? document.body?.textContent ?? '')
    .toLowerCase()
    .slice(0, 20_000);
  const has = (list: readonly string[]) => list.some((hint) => pageText.includes(hint));

  /** The visible text of an element, as separate lines (one per leaf element). */
  const linesOf = (root: Element): string[] => {
    const out: string[] = [];
    const walk = (node: Element) => {
      if (node.children.length === 0) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text !== '') out.push(text);
        return;
      }
      for (const child of Array.from(node.children)) walk(child);
    };
    walk(root);
    return out;
  };

  const anchors = Array.from(document.querySelectorAll('a[href]')).filter(
    (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
  );
  const productAnchors: { anchor: HTMLAnchorElement; link: string }[] = [];
  for (const anchor of anchors) {
    let url: URL;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !okHost(url.hostname)) continue;
    if (url.hostname !== 'shope.ee' && !PRODUCT_PATH.test(url.pathname)) continue;
    productAnchors.push({ anchor, link: `${url.origin}${url.pathname}` });
  }

  const offers: ShopeeOffer[] = [];
  const seen = new Set<string>();
  for (const { anchor, link } of productAnchors) {
    if (offers.length >= maxItems) break;
    if (seen.has(link)) continue;
    // The card: the nearest block around the link that shows a price.
    let card: Element = anchor;
    for (let depth = 0; depth < 8 && card.parentElement !== null; depth += 1) {
      if (PRICE.test(card.textContent ?? '')) break;
      card = card.parentElement;
    }
    const lines = linesOf(card);
    const joined = lines.join('\n');
    const priceMatch = PRICE.exec(joined);
    let commission: number | null = null;
    for (let index = 0; index < lines.length && commission === null; index += 1) {
      const line = lines[index] ?? '';
      if (!COMMISSION_WORD.test(line)) continue;
      const here = PERCENT.exec(line) ?? PERCENT.exec(lines[index + 1] ?? '');
      if (here !== null) commission = Number((here[1] ?? '').replace(',', '.'));
    }
    const salesMatch = SALES_TH.exec(joined) ?? SALES_EN.exec(joined);
    const nameFromLines = lines
      .filter(
        (line) =>
          !PRICE.test(line) &&
          !PERCENT.test(line) &&
          !COMMISSION_WORD.test(line) &&
          !/ขายแล้ว|sold/i.test(line) &&
          line.length >= 4,
      )
      .sort((a, b) => b.length - a.length)[0];
    const image = card.querySelector('img');
    const name = (anchor.title || image?.alt || nameFromLines || '').trim().slice(0, 200);
    if (name === '') continue;
    seen.add(link);
    offers.push({
      name,
      priceThb: priceMatch === null ? null : Number((priceMatch[1] ?? '').replace(/,/g, '')),
      commissionPercent:
        commission !== null && commission > 0 && commission <= 100 ? commission : null,
      sales: salesMatch === null ? null : (salesMatch[1] ?? '').trim(),
      link,
    });
  }

  let state: ShopeeRead['state'] = 'unknown';
  if (
    hints.challengePaths.some((part) => location.pathname.includes(part)) ||
    has(hints.challengeHints)
  ) {
    state = 'challenge';
  } else if (has(hints.limitHints)) state = 'limit';
  else if (productAnchors.length > 0) state = 'ready';
  else if (has(hints.loginHints)) state = 'login';

  return {
    title: document.title.slice(0, 120),
    path: location.pathname.slice(0, 120),
    state,
    offers,
    linksSeen: productAnchors.length,
  };
}
