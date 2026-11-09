import { describe, expect, it, vi } from 'vitest';

import type { MetaAiBrowser } from '../metaai/runner.js';
import { importShopeeOffers, ShopeeImportError } from './import.js';
import type { ShopeeRead } from './page.js';

const READY: ShopeeRead = {
  title: 'Shopee Affiliate',
  path: '/offer/product_offer',
  state: 'ready',
  linksSeen: 1,
  offers: [
    {
      name: 'Fan',
      priceThb: 199,
      commissionPercent: 8,
      sales: '10k',
      link: 'https://shopee.co.th/fan-i.1.2',
      imageUrl: null,
    },
  ],
};

function browser(over: Partial<MetaAiBrowser> = {}) {
  const calls = { opened: [] as string[], focused: 0, run: 0 };
  const fake: MetaAiBrowser = {
    hasPermission: () => Promise.resolve(true),
    requestPermission: () => Promise.resolve(true),
    findTab: () => Promise.resolve(3),
    openTab: (url) => {
      calls.opened.push(url);
      return Promise.resolve(9);
    },
    focusTab: () => {
      calls.focused += 1;
      return Promise.resolve();
    },
    run: (_tab, func, args) => {
      calls.run += 1;
      return Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never;
    },
    ...over,
  };
  return { fake, calls };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ShopeeImportError) return error.code;
    throw error;
  }
  return 'none';
}

describe('importShopeeOffers', () => {
  it('returns the offers read from the open tab, passing the hints and the cap', async () => {
    const read = vi.fn(() => READY);
    const { fake } = browser();
    expect(await importShopeeOffers({ browser: fake, read })).toEqual(READY.offers);
    const args = read.mock.calls[0] as unknown as [unknown, number];
    expect(args[1]).toBe(200);
  });

  it('refuses without the permission and touches no tab', async () => {
    const { fake, calls } = browser({ hasPermission: () => Promise.resolve(false) });
    expect(await codeOf(importShopeeOffers({ browser: fake, read: () => READY }))).toBe(
      'PERMISSION_DENIED',
    );
    expect(calls.run).toBe(0);
    expect(calls.opened).toEqual([]);
  });

  it('opens the product list visibly when no tab is open, and reads nothing yet', async () => {
    const { fake, calls } = browser({ findTab: () => Promise.resolve(null) });
    expect(await codeOf(importShopeeOffers({ browser: fake, read: () => READY }))).toBe('OPENED');
    expect(calls.opened).toEqual(['https://affiliate.shopee.co.th/offer/product_offer']);
    expect(calls.run).toBe(0);
  });

  it('stops on the traffic check and on a sign-in page, bringing the tab forward', async () => {
    for (const [state, code] of [
      ['challenge', 'CHALLENGE'],
      ['login', 'LOGIN_REQUIRED'],
    ] as const) {
      const { fake, calls } = browser();
      expect(
        await codeOf(
          importShopeeOffers({ browser: fake, read: () => ({ ...READY, state, offers: [] }) }),
        ),
      ).toBe(code);
      expect(calls.focused).toBe(1);
    }
  });

  it('says when Shopee asks to slow down, and when the page has no products', async () => {
    const { fake } = browser();
    expect(
      await codeOf(
        importShopeeOffers({
          browser: fake,
          read: () => ({ ...READY, state: 'limit', offers: [] }),
        }),
      ),
    ).toBe('RATE_LIMITED');
    expect(
      await codeOf(
        importShopeeOffers({
          browser: fake,
          read: () => ({ ...READY, state: 'unknown', offers: [] }),
        }),
      ),
    ).toBe('NOTHING_FOUND');
  });

  it('turns an unreadable tab into a plain message', async () => {
    const { fake } = browser({ run: () => Promise.reject(new Error('cannot access')) });
    expect(await codeOf(importShopeeOffers({ browser: fake, read: () => READY }))).toBe(
      'PAGE_NOT_RECOGNISED',
    );
  });

  it('keeps product names and links out of the diagnostics', async () => {
    const { fake } = browser();
    try {
      await importShopeeOffers({
        browser: fake,
        read: () => ({ ...READY, state: 'limit' }),
      });
      expect.unreachable();
    } catch (error) {
      const text = (error as ShopeeImportError).diagnostics;
      expect(text).toContain('product links seen: 1');
      expect(text).not.toContain('Fan');
      expect(text).not.toContain('shopee.co.th/fan');
    }
  });

  describe('load more', () => {
    const offer = (n: number) => ({
      ...READY.offers[0]!,
      name: `Fan ${n}`,
      link: `https://shopee.co.th/f${n}-i.1.${n}`,
    });
    function loader(over: Partial<import('./import.js').LoadMoreOptions> = {}) {
      const stops: string[] = [];
      return {
        stops,
        more: {
          advance: () => 'scrolled' as const,
          maxSteps: 10,
          delayMs: 2000,
          sleep: () => Promise.resolve(),
          onStop: (reason: string) => stops.push(reason),
          ...over,
        },
      };
    }

    it('merges new products from each step, without duplicates', async () => {
      const { fake } = browser();
      let call = 0;
      const read = () => {
        call += 1;
        return { ...READY, offers: [offer(1), ...(call > 1 ? [offer(call)] : [])] };
      };
      const { more, stops } = loader({ maxSteps: 3 });
      const result = await importShopeeOffers({ browser: fake, read, loadMore: more });
      expect(result.map((o) => o.name)).toEqual(['Fan 1', 'Fan 2', 'Fan 3', 'Fan 4']);
      expect(stops).toEqual(['Stopped after 3 steps.']);
    });

    it('waits the fixed delay after each step', async () => {
      const { fake } = browser();
      const waits: number[] = [];
      const { more } = loader({ maxSteps: 2, sleep: (ms) => (waits.push(ms), Promise.resolve()) });
      await importShopeeOffers({ browser: fake, read: () => READY, loadMore: more });
      expect(waits).toEqual([2000, 2000]);
    });

    it('stops at the end of the list', async () => {
      const { fake } = browser();
      const { more, stops } = loader({ advance: () => 'none' });
      const result = await importShopeeOffers({ browser: fake, read: () => READY, loadMore: more });
      expect(result).toHaveLength(1);
      expect(stops).toEqual(['Reached the end of the list.']);
    });

    it('stops after three steps with nothing new', async () => {
      const { fake } = browser();
      let steps = 0;
      const { more, stops } = loader({ advance: () => ((steps += 1), 'scrolled') });
      await importShopeeOffers({ browser: fake, read: () => READY, loadMore: more });
      expect(steps).toBe(3);
      expect(stops).toEqual(['No new products after three steps.']);
    });

    it('stops at once when cancelled, keeping what was read', async () => {
      const { fake } = browser();
      const { more, stops } = loader({ cancelled: () => true });
      const result = await importShopeeOffers({ browser: fake, read: () => READY, loadMore: more });
      expect(result).toHaveLength(1);
      expect(stops).toEqual(['Stopped by you.']);
    });

    it('stops at a check, a slow-down or a sign-in page, keeps the products, and focuses only for a check or sign-in', async () => {
      for (const [state, focused] of [
        ['challenge', 1],
        ['login', 1],
        ['limit', 0],
      ] as const) {
        const { fake, calls } = browser();
        let call = 0;
        const read = () => ((call += 1) === 1 ? READY : { ...READY, state, offers: [] });
        const { more, stops } = loader();
        const result = await importShopeeOffers({ browser: fake, read, loadMore: more });
        expect(result).toHaveLength(1);
        expect(stops).toHaveLength(1);
        expect(calls.focused).toBe(focused);
      }
    });
  });
});
