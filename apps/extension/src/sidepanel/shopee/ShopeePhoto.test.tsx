import type { ApiClient } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MetaAiBrowser } from '../metaai/runner.js';
import type { ShopeeRead } from './page.js';
import { ShopeePanel } from './ShopeePanel.js';

const PHOTO = 'https://down-th.img.susercontent.com/file/abc';
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const read = (): ShopeeRead => ({
  title: 'Shopee Affiliate',
  path: '/offer/product_offer',
  state: 'ready',
  linksSeen: 1,
  offers: [
    {
      name: 'Mug',
      priceThb: 99,
      commissionPercent: 10,
      sales: null,
      link: 'https://shopee.co.th/mug-i.1.1',
      imageUrl: PHOTO,
    },
  ],
});

/** A fake tab: the download functions answer as the page would; everything else runs as is. */
function setup(download: 'ok' | 'blocked') {
  const fetched: string[] = [];
  const browser: MetaAiBrowser = {
    hasPermission: () => Promise.resolve(true),
    requestPermission: () => Promise.resolve(true),
    findTab: () => Promise.resolve(5),
    openTab: () => Promise.resolve(5),
    focusTab: () => Promise.resolve(),
    run: (_tab, func, args) => {
      const name = (func as { name: string }).name;
      if (name === 'stashMedia') {
        fetched.push(String(args[0]));
        return (
          download === 'ok'
            ? Promise.resolve({ size: BYTES.length, type: 'image/jpeg' })
            : Promise.reject(new Error('Failed to fetch'))
        ) as never;
      }
      if (name === 'readStash')
        return Promise.resolve(btoa(String.fromCharCode(...BYTES))) as never;
      if (name === 'clearStash') return Promise.resolve(true) as never;
      return Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never;
    },
  };
  const product = { id: 'prod-1', version: 1, name: 'Mug' };
  const api = {
    products: {
      create: vi.fn(() => Promise.resolve(product)),
      update: vi.fn((_ws: string, _id: string, body: unknown) =>
        Promise.resolve({ ...product, version: 2, ...(body as object) }),
      ),
    },
    assets: {
      createUploadIntent: vi.fn(() =>
        Promise.resolve({ intentId: 'i1', uploadUrl: '/up/i1', contentType: 'image/jpeg' }),
      ),
      completeUpload: vi.fn(() => Promise.resolve({ id: 'asset-9' })),
    },
    resolveUrl: (path: string) => `http://api.test${path}`,
  } as unknown as ApiClient;
  const put = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ShopeePanel
        api={api}
        workspaceId="w1"
        dashboardUrl="http://dash.test"
        canCreate
        browser={browser}
        read={read as never}
        fetchImpl={put as never}
      />
    </QueryClientProvider>,
  );
  return { api, put, fetched };
}

async function createFromFirst() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Import from Shopee affiliate page' }));
  await user.click(await screen.findByRole('button', { name: 'Create product from Mug' }));
}

describe('Shopee product photo (D-085)', () => {
  it('saves the photo through the upload path and makes it the cover', async () => {
    const { api, put, fetched } = setup('ok');
    await createFromFirst();
    expect(await screen.findByText('Photo saved as the cover')).toBeInTheDocument();
    expect(fetched).toEqual([PHOTO]);
    expect(api.assets.createUploadIntent).toHaveBeenCalledWith('w1', {
      filename: 'shopee-prod-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BYTES.length,
      productId: 'prod-1',
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(api.products.update).toHaveBeenCalledWith('w1', 'prod-1', {
      version: 1,
      primaryAssetId: 'asset-9',
    });
  });

  it('still creates the product when the photo cannot be downloaded, and says so', async () => {
    const { api, put } = setup('blocked');
    await createFromFirst();
    const list = screen.getByRole('list', { name: 'Shopee offers' });
    expect(
      await within(list).findByRole('link', { name: 'Product created: open it' }),
    ).toBeVisible();
    await waitFor(() =>
      expect(within(list).getByRole('alert')).toHaveTextContent(
        'Product created; photo not saved: Shopee did not let the photo be downloaded. Add it in the Asset library.',
      ),
    );
    expect(within(list).getByRole('button', { name: /Copy photo diagnostics/ })).toBeVisible();
    expect(api.assets.createUploadIntent).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(api.products.update).not.toHaveBeenCalled();
  });
});
