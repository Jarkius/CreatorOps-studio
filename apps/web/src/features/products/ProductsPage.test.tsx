import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createFakeApi, json, makeProduct, THAI_NAME, WORKSPACE } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const LIST_PATH = `/w/${WORKSPACE.id}/products`;

// Intl separates the code and the amount with a no-break space; the DOM text normalises it to a space.
const price = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency })
    .format(amount)
    .replace(/\u00a0/g, ' ');

describe('ProductsPage', () => {
  it('shows a loading state, then rows with name, price, status and updated date', async () => {
    const api = createFakeApi({
      products: [
        makeProduct({ id: 'p1', name: THAI_NAME, priceAmount: '990', currency: 'THB' }),
        makeProduct({ id: 'p2', name: 'Desk lamp' }),
      ],
    });
    renderWeb(LIST_PATH, api);

    expect(screen.getByRole('status')).toHaveTextContent('Loading products…');
    const list = await screen.findByRole('list', { name: 'Active products' });
    const thai = within(list).getByRole('link', { name: THAI_NAME });
    expect(thai).toHaveAttribute('href', `${LIST_PATH}/p1`);
    expect(within(list).getByText(price(990, 'THB'))).toBeInTheDocument();
    expect(within(list).getByText('No price')).toBeInTheDocument();
    expect(within(list).getAllByText('Active')).toHaveLength(2);
    expect(within(list).getAllByText(/^Updated /)).toHaveLength(2);
  });

  it('falls back to the raw amount and code when the currency code is rejected', async () => {
    const api = createFakeApi({
      products: [makeProduct({ id: 'p1', name: 'Mug', priceAmount: '12.50', currency: 'ZZZZ' })],
    });
    renderWeb(LIST_PATH, api);
    expect(await screen.findByText('12.50 ZZZZ')).toBeInTheDocument();
  });

  it('shows the create link and an empty state with a call to action on Active', async () => {
    renderWeb(LIST_PATH, createFakeApi());

    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Create product' });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute('href', `${LIST_PATH}/new`);
  });

  it('switches to Archived through the query string and marks the current tab', async () => {
    const api = createFakeApi({
      products: [makeProduct({ id: 'p1', name: 'Old fan', status: 'archived' })],
    });
    const { router } = renderWeb(LIST_PATH, api);

    const activeTab = await screen.findByRole('link', { name: 'Active' });
    expect(activeTab).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('link', { name: 'Archived' }));

    expect(await screen.findByRole('link', { name: 'Old fan' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?status=archived');
    expect(screen.getByRole('link', { name: 'Archived' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Active' })).not.toHaveAttribute('aria-current');
  });

  it('shows the empty Archived message when nothing is archived', async () => {
    renderWeb(`${LIST_PATH}?status=archived`, createFakeApi());
    expect(
      await screen.findByRole('heading', { name: 'No archived products' }),
    ).toBeInTheDocument();
  });

  it('shows an error with the request reference, and Try again refetches', async () => {
    let failures = 1;
    const api = createFakeApi({
      products: [makeProduct({ id: 'p1', name: 'Recovered' })],
      intercept: (call) => {
        if (
          call.method === 'GET' &&
          call.path.startsWith(`/api/v1/workspaces/${WORKSPACE.id}/products`) &&
          failures > 0
        ) {
          failures -= 1;
          return json(
            { error: { code: 'INTERNAL_ERROR', message: 'Boom.', requestId: 'req-list' } },
            500,
          );
        }
        return undefined;
      },
    });
    renderWeb(LIST_PATH, api);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Boom.')).toBeInTheDocument();
    expect(within(alert).getByText('Reference: req-list')).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Recovered' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads the next page with Load more until nextCursor is null', async () => {
    const products = ['A', 'B', 'C'].map((name, index) => makeProduct({ id: `p${index}`, name }));
    renderWeb(LIST_PATH, createFakeApi({ products, pageSize: 2 }));

    expect(await screen.findByRole('link', { name: 'B' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'C' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('link', { name: 'C' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows Workspace not found for an unknown workspace id', async () => {
    renderWeb('/w/ws_missing/products', createFakeApi());
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
