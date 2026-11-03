import { ApiError, type ApiClient, type Product } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { DASHBOARD_URL } from './config.js';
import { formatPrice } from './format.js';
import type { SessionClient } from './session.js';

type MeResult = Awaited<ReturnType<SessionClient['loadMe']>>;
type ListFn = ApiClient['products']['list'];

const workspace = (id: string, name: string) => ({
  id,
  name,
  role: 'owner' as const,
});

const me = (workspaces: ReturnType<typeof workspace>[]): MeResult => ({
  user: { id: 'u1', email: 'dev@creatorops.local', displayName: 'Dev User' },
  workspaces,
});

function product(id: string, name: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    workspaceId: 'w1',
    name,
    description: null,
    sourceUrl: null,
    priceAmount: null,
    currency: null,
    sellingPoints: [],
    targetAudience: null,
    brandTone: null,
    restrictedClaims: [],
    primaryAssetId: null,
    status: 'active',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

const page = (items: Product[]) => ({ items, nextCursor: null });

/** Renders the app and waits until the signed-in section (and so the products region) is mounted. */
async function renderApp(options: {
  workspaces?: ReturnType<typeof workspace>[];
  list?: ListFn;
  loadMe?: SessionClient['loadMe'];
}) {
  const workspaces = options.workspaces ?? [workspace('w1', 'Studio One')];
  const loadMe =
    options.loadMe ?? vi.fn<SessionClient['loadMe']>(() => Promise.resolve(me(workspaces)));
  const list = options.list ?? (() => Promise.resolve(page([])));
  const api = { products: { list } } as unknown as ApiClient;
  const session = { api, loadMe } satisfies SessionClient;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App session={session} />
    </QueryClientProvider>,
  );
  await screen.findByText('Dev User');
  return { list, loadMe };
}

const products = () => screen.getByRole('region', { name: 'Products' });

describe('side panel products', () => {
  it('lists the newest active products, with a Thai name and a formatted price', async () => {
    const list = vi
      .fn<ListFn>()
      .mockResolvedValue(
        page([
          product('p1', 'กระเป๋าผ้าใบเล็ก', { priceAmount: '1290.50', currency: 'THB' }),
          product('p2', 'Plain item'),
        ]),
      );
    await renderApp({ list });

    expect(await within(products()).findByText('กระเป๋าผ้าใบเล็ก')).toBeInTheDocument();
    expect(within(products()).getByText('Plain item')).toBeInTheDocument();
    expect(
      within(products()).getByText(formatPrice('1290.50', 'THB').replace(/\s/g, ' ')),
    ).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('w1', { status: 'active', limit: 10 });
    expect(within(products()).getAllByText('Active')).toHaveLength(2);
  });

  it('shows the empty state with a Create product link when there are no products', async () => {
    await renderApp({ list: () => Promise.resolve(page([])) });
    expect(await within(products()).findByText('No products yet')).toBeInTheDocument();
    const create = within(products()).getByRole('link', { name: 'Create product' });
    expect(create).toHaveAttribute('href', `${DASHBOARD_URL}/w/w1/products/new`);
  });

  it('shows the error with its reference, and Try again refetches only the product list', async () => {
    const list = vi
      .fn<ListFn>()
      .mockRejectedValueOnce(
        new ApiError({
          code: 'NETWORK_ERROR',
          message: 'Could not reach the server. Check your connection and try again.',
          requestId: 'req-77',
        }),
      )
      .mockResolvedValueOnce(page([product('p1', 'Back again')]));
    const { loadMe } = await renderApp({ list });

    const alert = await within(products()).findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server');
    expect(alert).toHaveTextContent('Reference: req-77');

    await userEvent.click(within(products()).getByRole('button', { name: 'Try again' }));
    expect(await within(products()).findByText('Back again')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(loadMe).toHaveBeenCalledTimes(1);
  });

  it('switches the list when another workspace is chosen, and keeps the choice in component state', async () => {
    const list = vi.fn<ListFn>((workspaceId) =>
      Promise.resolve(
        page(
          workspaceId === 'w1'
            ? [product('p1', 'First workspace item', { workspaceId: 'w1' })]
            : [product('p2', 'Second workspace item', { workspaceId: 'w2' })],
        ),
      ),
    );
    await renderApp({
      workspaces: [workspace('w1', 'Studio One'), workspace('w2', 'Studio Two')],
      list,
    });

    expect(await within(products()).findByText('First workspace item')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Workspace' });
    expect(select).toHaveValue('w1');

    await userEvent.selectOptions(select, 'w2');
    expect(await within(products()).findByText('Second workspace item')).toBeInTheDocument();
    expect(within(products()).queryByText('First workspace item')).not.toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith('w2', { status: 'active', limit: 10 });
  });

  it('shows no workspace selector for a single workspace', async () => {
    await renderApp({ list: () => Promise.resolve(page([])) });
    await within(products()).findByText('No products yet');
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).not.toBeInTheDocument();
  });

  it('links to the dashboard with the right hrefs, opened in a new tab', async () => {
    await renderApp({
      list: () => Promise.resolve(page([product('p 1/x', 'Linked item')])),
    });
    const open = await within(products()).findByRole('link', { name: /Open Linked item/ });
    expect(open).toHaveAttribute(
      'href',
      `${DASHBOARD_URL}/w/w1/products/${encodeURIComponent('p 1/x')}`,
    );
    expect(open).toHaveAttribute('target', '_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');

    const create = within(products()).getByRole('link', { name: 'Create product' });
    expect(create).toHaveAttribute('href', `${DASHBOARD_URL}/w/w1/products/new`);
    expect(create).toHaveAttribute('target', '_blank');
    expect(create.getAttribute('rel')).toBe('noopener noreferrer');

    const viewAll = within(products()).getByRole('link', { name: 'View all products' });
    expect(viewAll).toHaveAttribute('href', `${DASHBOARD_URL}/w/w1/products`);
    expect(viewAll).toHaveAttribute('target', '_blank');
    expect(viewAll.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('makes no product request when the user has no workspace', async () => {
    const list = vi.fn<ListFn>(() => Promise.resolve(page([])));
    await renderApp({ workspaces: [], list });
    expect(await screen.findByText('No workspaces yet')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Products' })).not.toBeInTheDocument();
    await waitFor(() => expect(list).not.toHaveBeenCalled());
  });

  it('gives long names a class that wraps them anywhere, without a fixed width', async () => {
    const longName = `${'A'.repeat(120)} ${'ทดสอบสินค้าชื่อยาวมาก'.repeat(8)}`;
    await renderApp({ list: () => Promise.resolve(page([product('p1', longName)])) });
    const name = await within(products()).findByText(longName);
    expect(name).toHaveClass('[overflow-wrap:anywhere]');
  });
});
