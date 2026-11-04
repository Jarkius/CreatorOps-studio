import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createFakeApi, SECOND_WORKSPACE, WORKSPACE } from '../test/fakeApi.js';
import { renderWeb } from '../test/renderWeb.js';

describe('Layout', () => {
  it('starts with a skip link that targets the main landmark', () => {
    renderWeb('/w/ws_1/products', createFakeApi());

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByText('CreatorOps Studio')).toBeInTheDocument();
  });

  it('links Products to the current workspace once workspaces load', async () => {
    renderWeb(`/w/${WORKSPACE.id}/products`, createFakeApi());

    const nav = screen.getByRole('navigation', { name: 'Main' });
    const products = await within(nav).findByRole('link', { name: 'Products' });
    expect(products).toHaveAttribute('href', `/w/${WORKSPACE.id}/products`);
    expect(products).toHaveAttribute('aria-current', 'page');
  });

  it('links Asset library to the workspace library', async () => {
    renderWeb(`/w/${WORKSPACE.id}/products`, createFakeApi());

    const nav = screen.getByRole('navigation', { name: 'Main' });
    const library = await within(nav).findByRole('link', { name: 'Asset library' });
    expect(library).toHaveAttribute('href', `/w/${WORKSPACE.id}/assets`);
    expect(library).not.toHaveAttribute('aria-disabled');
  });

  it('keeps the library open when switching workspace from the library', async () => {
    const api = createFakeApi({ workspaces: [WORKSPACE, SECOND_WORKSPACE] });
    const { router } = renderWeb(`/w/${WORKSPACE.id}/assets`, api);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Workspace' }), {
      target: { value: SECOND_WORKSPACE.id },
    });

    expect(router.state.location.pathname).toBe(`/w/${SECOND_WORKSPACE.id}/assets`);
  });

  it('shows no workspace switcher for a single workspace', async () => {
    renderWeb(`/w/${WORKSPACE.id}/products`, createFakeApi());
    await screen.findByRole('link', { name: 'Products' });
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).not.toBeInTheDocument();
  });

  it('switches workspace and keeps the status tab on the product list', async () => {
    const api = createFakeApi({ workspaces: [WORKSPACE, SECOND_WORKSPACE] });
    const { router } = renderWeb(`/w/${WORKSPACE.id}/products?status=archived`, api);

    const select = await screen.findByRole('combobox', { name: 'Workspace' });
    expect(select).toHaveValue(WORKSPACE.id);
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Studio One', 'Studio Two']);

    fireEvent.change(select, { target: { value: SECOND_WORKSPACE.id } });

    expect(router.state.location.pathname).toBe(`/w/${SECOND_WORKSPACE.id}/products`);
    expect(router.state.location.search).toBe('?status=archived');
    expect(await screen.findByRole('combobox', { name: 'Workspace' })).toHaveValue(
      SECOND_WORKSPACE.id,
    );
  });

  it('opens the product list of the chosen workspace from a non-product page', async () => {
    const api = createFakeApi({ workspaces: [WORKSPACE, SECOND_WORKSPACE] });
    const { router } = renderWeb(`/w/${WORKSPACE.id}/products/new`, api);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Workspace' }), {
      target: { value: SECOND_WORKSPACE.id },
    });

    expect(router.state.location.pathname).toBe(`/w/${SECOND_WORKSPACE.id}/products`);
    expect(router.state.location.search).toBe('');
  });

  it('always offers a New workspace link, with one workspace too', async () => {
    renderWeb(`/w/${WORKSPACE.id}/products`, createFakeApi());

    const link = await screen.findByRole('link', { name: 'New workspace' });
    expect(link).toHaveAttribute('href', '/workspaces/new');
  });

  it('keeps the New workspace link next to the switcher with several workspaces', async () => {
    renderWeb(
      `/w/${WORKSPACE.id}/products`,
      createFakeApi({ workspaces: [WORKSPACE, SECOND_WORKSPACE] }),
    );

    expect(await screen.findByRole('combobox', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New workspace' })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );
  });

  it('offers the New workspace link when the user has no workspaces', async () => {
    renderWeb('/', createFakeApi({ workspaces: [] }));

    expect(await screen.findByRole('link', { name: 'New workspace' })).toBeInTheDocument();
  });
});
