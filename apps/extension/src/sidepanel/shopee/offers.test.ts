import { describe, expect, it } from 'vitest';

import { earningPerSale, salesNumber, visibleOffers } from './offers.js';
import type { ShopeeOffer } from './page.js';

const offer = (name: string, over: Partial<ShopeeOffer> = {}): ShopeeOffer => ({
  name,
  priceThb: 100,
  commissionPercent: 10,
  sales: null,
  link: `https://shopee.co.th/${name}-i.1.1`,
  imageUrl: null,
  ...over,
});

describe('salesNumber', () => {
  it('reads Thai and English short forms', () => {
    expect(salesNumber('1.2พัน')).toBe(1200);
    expect(salesNumber('3.5หมื่น')).toBe(35000);
    expect(salesNumber('2แสน')).toBe(200000);
    expect(salesNumber('1ล้าน')).toBe(1000000);
    expect(salesNumber('10k')).toBe(10000);
    expect(salesNumber('10K+')).toBe(10000);
    expect(salesNumber('1,234')).toBe(1234);
    expect(salesNumber('87')).toBe(87);
  });

  it('returns null for anything else', () => {
    for (const value of [null, '', 'many', '1.2 million', '฿10'])
      expect(salesNumber(value)).toBeNull();
  });
});

describe('earningPerSale', () => {
  it('is price times commission in baht, rounded to satang, or null when either is missing', () => {
    expect(earningPerSale(offer('a', { priceThb: 1290, commissionPercent: 12.5 }))).toBe(161.25);
    expect(earningPerSale(offer('a', { priceThb: 99, commissionPercent: 3 }))).toBe(2.97);
    expect(earningPerSale(offer('a', { priceThb: null }))).toBeNull();
    expect(earningPerSale(offer('a', { commissionPercent: null }))).toBeNull();
  });
});

describe('visibleOffers', () => {
  const list = [
    offer('low', { commissionPercent: 3, priceThb: 1000, sales: '10k' }),
    offer('none', { commissionPercent: null, priceThb: 5000, sales: null }),
    offer('high', { commissionPercent: 15, priceThb: 100, sales: '1.2พัน' }),
    offer('mid', { commissionPercent: 8, priceThb: 500, sales: '87' }),
  ];
  const names = (sort: Parameters<typeof visibleOffers>[1], min = 0) =>
    visibleOffers(list, sort, min).map((o) => o.name);

  it('sorts largest first, with unknown values last', () => {
    expect(names('commission')).toEqual(['high', 'mid', 'low', 'none']);
    expect(names('earning')).toEqual(['mid', 'low', 'high', 'none']); // 40, 30, 15 baht
    expect(names('price')).toEqual(['none', 'low', 'mid', 'high']);
    expect(names('sales')).toEqual(['low', 'high', 'mid', 'none']);
  });

  it('puts an unknown value last even when it comes first on the page', () => {
    const unknownFirst = [
      offer('unknown', { commissionPercent: null, priceThb: null, sales: null }),
      offer('known', { commissionPercent: 5, priceThb: 10, sales: '3' }),
    ];
    for (const sort of ['commission', 'earning', 'price', 'sales'] as const) {
      expect(
        visibleOffers(unknownFirst, sort, 0).map((o) => o.name),
        sort,
      ).toEqual(['known', 'unknown']);
    }
  });

  it('puts an unknown value after a real zero', () => {
    const zero = [offer('unknown', { sales: null }), offer('none sold', { sales: '0' })];
    expect(visibleOffers(zero, 'sales', 0).map((o) => o.name)).toEqual(['none sold', 'unknown']);
  });

  it('keeps page order on ties', () => {
    const tied = [offer('first'), offer('second'), offer('third')];
    expect(visibleOffers(tied, 'commission', 0).map((o) => o.name)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('filters by a minimum commission and then drops offers without one', () => {
    expect(names('commission', 8)).toEqual(['high', 'mid']);
    expect(names('commission', 0)).toHaveLength(4);
    expect(names('commission', 50)).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const before = list.map((o) => o.name);
    visibleOffers(list, 'price', 5);
    expect(list.map((o) => o.name)).toEqual(before);
  });
});
