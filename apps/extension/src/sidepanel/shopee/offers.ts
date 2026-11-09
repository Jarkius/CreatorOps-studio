import type { ShopeeOffer } from './page.js';

export type OfferSort = 'commission' | 'earning' | 'price' | 'sales';

/** "1.2พัน" → 1200, "10k" → 10000, "3.5หมื่น" → 35000, "1ล้าน" → 1000000; null when unreadable. */
export function salesNumber(sales: string | null): number | null {
  if (sales === null) return null;
  const match = /^([\d.,]+)\s*(พัน|หมื่น|แสน|ล้าน|k|K|m|M)?\+?$/.exec(sales.trim());
  if (match === null) return null;
  const base = Number((match[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const unit = match[2] ?? '';
  const scale: Record<string, number> = {
    '': 1,
    k: 1_000,
    K: 1_000,
    พัน: 1_000,
    หมื่น: 10_000,
    แสน: 100_000,
    ล้าน: 1_000_000,
    m: 1_000_000,
    M: 1_000_000,
  };
  return Math.round(base * (scale[unit] ?? 1));
}

/** Price times commission, in baht, before Shopee's own deductions and caps; null when unknown. */
export function earningPerSale(offer: ShopeeOffer): number | null {
  if (offer.priceThb === null || offer.commissionPercent === null) return null;
  return Math.round(offer.priceThb * offer.commissionPercent) / 100;
}

/**
 * The offers to show: at least the minimum commission (offers without a commission are kept only
 * when the minimum is 0), sorted largest first; unknown values go last, ties keep page order.
 */
export function visibleOffers(
  offers: readonly ShopeeOffer[],
  sort: OfferSort,
  minCommission: number,
): ShopeeOffer[] {
  const value = (offer: ShopeeOffer): number | null => {
    if (sort === 'commission') return offer.commissionPercent;
    if (sort === 'earning') return earningPerSale(offer);
    if (sort === 'price') return offer.priceThb;
    return salesNumber(offer.sales);
  };
  return offers
    .map((offer, index) => ({ offer, index }))
    .filter(({ offer }) =>
      minCommission <= 0 ? true : (offer.commissionPercent ?? -1) >= minCommission,
    )
    .sort((a, b) => {
      const left = value(a.offer);
      const right = value(b.offer);
      if (left === null && right === null) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left || a.index - b.index;
    })
    .map(({ offer }) => offer);
}
