import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createFakeApi, WORKSPACE } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';

describe('a user with no workspaces', () => {
  it('sees the create prompt on the Overview', async () => {
    renderWeb('/', createFakeApi({ workspaces: [] }));

    expect(
      await screen.findByRole('heading', { name: 'You have no workspaces yet' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create workspace' })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );
  });

  it.each([
    ['the product list', '/w/ws_1/products'],
    ['the new product form', '/w/ws_1/products/new'],
    ['a product page', '/w/ws_1/products/prod_1'],
  ])('sees the create prompt on %s instead of a workspace error', async (_label, path) => {
    renderWeb(path, createFakeApi({ workspaces: [] }));

    expect(
      await screen.findByRole('heading', { name: 'You have no workspaces yet' }),
    ).toBeVisible();
    expect(screen.queryByText('Workspace not found')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create workspace' })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );
  });

  it('still opens the products of an existing workspace', async () => {
    renderWeb(`/w/${WORKSPACE.id}/products`, createFakeApi());

    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeVisible();
    expect(screen.queryByText('You have no workspaces yet')).not.toBeInTheDocument();
  });

  it('shows the Workspace not found notice for an unknown id when the user has workspaces', async () => {
    renderWeb('/w/ws_missing/products', createFakeApi());

    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeVisible();
    const main = screen.getByRole('main');
    expect(within(main).queryByText('You have no workspaces yet')).not.toBeInTheDocument();
  });
});
