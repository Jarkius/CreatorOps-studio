import { ApiError, type ApiClient } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MetaAiBrowser } from '../metaai/runner.js';
import type { ShopeeOffer, ShopeeRead } from './page.js';
import { ShopeePanel } from './ShopeePanel.js';

const OFFERS: ShopeeOffer[] = [
  {
    name: 'Low fan',
    priceThb: 1000,
    commissionPercent: 3,
    sales: '10k',
    link: 'https://shopee.co.th/low-i.1.1',
  },
  {
    name: 'High mug',
    priceThb: 100,
    commissionPercent: 15,
    sales: '1.2พัน',
    link: 'https://shopee.co.th/high-i.1.2',
  },
  {
    name: 'Mid lamp',
    priceThb: 500,
    commissionPercent: 8,
    sales: '87',
    link: 'https://shopee.co.th/mid-i.1.3',
  },
  {
    name: 'No commission',
    priceThb: 50,
    commissionPercent: null,
    sales: null,
    link: 'https://shopee.co.th/none-i.1.4',
  },
];

const read =
  (over: Partial<ShopeeRead> = {}) =>
  (): ShopeeRead => ({
    title: 'Shopee Affiliate',
    path: '/offer/product_offer',
    state: 'ready',
    linksSeen: OFFERS.length,
    offers: OFFERS,
    ...over,
  });

function setup(
  options: {
    canCreate?: boolean;
    grant?: boolean;
    read?: () => ShopeeRead;
    createProduct?: (ws: string, body: unknown) => Promise<unknown>;
    order?: string[];
  } = {},
) {
  const order = options.order ?? [];
  const browser: MetaAiBrowser = {
    hasPermission: () => {
      order.push('has');
      return Promise.resolve(options.grant ?? true);
    },
    requestPermission: () => {
      order.push('request');
      return Promise.resolve(options.grant ?? true);
    },
    findTab: () => Promise.resolve(5),
    openTab: () => Promise.resolve(5),
    focusTab: () => Promise.resolve(),
    run: (_tab, func, args) =>
      Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never,
  };
  const create = vi.fn(
    options.createProduct ??
      ((_ws: string, body: unknown) => Promise.resolve({ id: 'prod-9', ...(body as object) })),
  );
  const api = { products: { create } } as unknown as ApiClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ShopeePanel
        api={api}
        workspaceId="w1"
        dashboardUrl="http://dash.test"
        canCreate={options.canCreate ?? true}
        browser={browser}
        read={(options.read ?? read()) as never}
      />
    </QueryClientProvider>,
  );
  return { create, order };
}

const section = () => within(screen.getByRole('region', { name: 'Shopee Affiliate' }));
const offerNames = () =>
  within(screen.getByRole('list', { name: 'Shopee offers' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent);

async function importNow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(section().getByRole('button', { name: 'Import from Shopee affiliate page' }));
}

describe('Shopee products in the side panel', () => {
  it('imports the page, sorted by commission, with price, earning per sale and sales', async () => {
    const user = userEvent.setup();
    setup();
    await importNow(user);
    await screen.findByRole('list', { name: 'Shopee offers' });
    expect(offerNames()).toEqual(['High mug', 'Mid lamp', 'Low fan', 'No commission']);
    const mug = within(screen.getAllByRole('listitem')[0]!);
    expect(mug.getByText('Commission 15%')).toBeInTheDocument();
    expect(mug.getByText(/≈ ฿15(\.00)? per sale/)).toBeInTheDocument();
    expect(mug.getByText(/Sold 1\.2พัน/)).toBeInTheDocument();
    expect(section().getByText(/4 of 4 products/)).toBeInTheDocument();
    expect(section().getByRole('button', { name: 'Import again' })).toBeEnabled();
  });

  it('re-sorts and filters by a minimum commission', async () => {
    const user = userEvent.setup();
    setup();
    await importNow(user);
    await screen.findByRole('list', { name: 'Shopee offers' });
    await user.selectOptions(section().getByLabelText('Sort by'), 'earning');
    expect(offerNames()).toEqual(['Mid lamp', 'Low fan', 'High mug', 'No commission']);
    await user.type(section().getByLabelText('Minimum commission %'), '8');
    expect(offerNames()).toEqual(['Mid lamp', 'High mug']);
    expect(section().getByText(/2 of 4 products/)).toBeInTheDocument();
  });

  it('creates a product with the name, the price in baht and the Shopee link, then links to it', async () => {
    const user = userEvent.setup();
    const t = setup();
    await importNow(user);
    await user.click(await screen.findByRole('button', { name: 'Create product from High mug' }));
    expect(t.create).toHaveBeenCalledWith('w1', {
      name: 'High mug',
      priceAmount: '100.00',
      currency: 'THB',
      sourceUrl: 'https://shopee.co.th/high-i.1.2',
    });
    const link = await screen.findByRole('link', { name: 'Product created: open it' });
    expect(link).toHaveAttribute('href', 'http://dash.test/w/w1/products/prod-9');
  });

  it('shows a refusal from the server when the product cannot be created', async () => {
    const user = userEvent.setup();
    const t = setup({
      createProduct: () =>
        Promise.reject(
          new ApiError({
            code: 'VALIDATION_ERROR',
            message: 'The request is not valid.',
            status: 400,
          }),
        ),
    });
    await importNow(user);
    await user.click(
      await screen.findByRole('button', { name: 'Create product from No commission' }),
    );
    expect(t.create).toHaveBeenCalledWith('w1', {
      name: 'No commission',
      priceAmount: '50.00',
      currency: 'THB',
      sourceUrl: 'https://shopee.co.th/none-i.1.4',
    });
    expect(await screen.findByText('The request is not valid.')).toBeInTheDocument();
  });

  it('lets a read-only member import and look, but not create products', async () => {
    const user = userEvent.setup();
    setup({ canCreate: false });
    await importNow(user);
    await screen.findByRole('list', { name: 'Shopee offers' });
    expect(screen.queryByRole('button', { name: /Create product/ })).not.toBeInTheDocument();
  });

  it('asks Chrome for the permission first, before anything is awaited', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    setup({ order });
    await importNow(user);
    await screen.findByRole('list', { name: 'Shopee offers' });
    expect(order[0]).toBe('request');
  });

  it('stops with a plain message when the permission is refused, and reads nothing', async () => {
    const user = userEvent.setup();
    const readSpy = vi.fn(read());
    setup({ grant: false, read: readSpy });
    await importNow(user);
    expect(await section().findByRole('alert')).toHaveTextContent(
      /Shopee Affiliate was not allowed/,
    );
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("shows the importer's message for a check page, with diagnostics to copy", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    setup({ read: read({ state: 'challenge', offers: [] }) });
    await importNow(user);
    expect(await section().findByRole('alert')).toHaveTextContent(/Shopee is showing a check/);
    await user.click(section().getByRole('button', { name: 'Copy diagnostics' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).toContain('state: challenge');
  });
});
