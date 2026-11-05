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
});
