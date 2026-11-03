import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Product } from '@creatorops/contracts';

import { createFakeApi, makeAsset, makeProduct, THAI_NAME, WORKSPACE } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const LIST_PATH = `/w/${WORKSPACE.id}/products`;
const PRODUCT_ID = 'prod_fan';
const EDIT_PATH = `${LIST_PATH}/${PRODUCT_ID}`;

const fan = (overrides: Partial<Product> = {}) =>
  makeProduct({
    id: PRODUCT_ID,
    name: THAI_NAME,
    ...overrides,
    description: 'Quiet motor',
    priceAmount: '990',
    currency: 'THB',
    sellingPoints: ['Quiet', 'Three speeds'],
  });

describe('ProductEditPage', () => {
  it('loads the product into the form with its status and version', async () => {
    renderWeb(EDIT_PATH, createFakeApi({ products: [fan()] }));

    expect(await screen.findByRole('heading', { name: THAI_NAME })).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue(THAI_NAME);
    expect(screen.getByLabelText('Selling point 2')).toHaveValue('Three speeds');
    expect(screen.getByLabelText('Currency')).toHaveValue('THB');
  });

  it('shows a NotFound state for an unknown product', async () => {
    renderWeb(`${LIST_PATH}/prod_missing`, createFakeApi({ products: [fan()] }));
    expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument();
  });

  it('sends only the changed fields plus the version, then reports Product saved', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ products: [fan()] });
    renderWeb(EDIT_PATH, api);

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'พัดลมตั้งโต๊ะ รุ่นใหม่');
    await user.click(screen.getByRole('button', { name: 'Save product' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Product saved');
    const patch = api.calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ version: 1, name: 'พัดลมตั้งโต๊ะ รุ่นใหม่' });
    expect(screen.getByText('Version 2')).toBeInTheDocument();
  });

  it('sends a cleared price as null and never sends untouched fields', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ products: [fan()] });
    renderWeb(EDIT_PATH, api);

    await user.clear(await screen.findByLabelText('Price amount'));
    await user.selectOptions(screen.getByLabelText('Currency'), '');
    await user.click(screen.getByRole('button', { name: 'Save product' }));

    await screen.findByText('Product saved');
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      version: 1,
      priceAmount: null,
      currency: null,
    });
  });

  it('does not send anything when nothing changed', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ products: [fan()] });
    renderWeb(EDIT_PATH, api);

    await user.click(await screen.findByRole('button', { name: 'Save product' }));

    expect(await screen.findByRole('status')).toHaveTextContent('No changes to save.');
    expect(api.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('on a conflict says so, and Load latest shows the other save instead of overwriting it', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ products: [fan()] });
    renderWeb(EDIT_PATH, api);

    const name = await screen.findByLabelText('Name');
    api.saveElsewhere(PRODUCT_ID, { name: 'Changed by a colleague' });

    await user.clear(name);
    await user.type(name, 'My version');
    await user.click(screen.getByRole('button', { name: 'Save product' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This product was changed by someone else.');
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      version: 1,
      name: 'My version',
    });
    expect(screen.getByLabelText('Name')).toHaveValue('My version');

    await user.click(within(alert).getByRole('button', { name: 'Load latest' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Name')).toHaveValue('Changed by a colleague'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Version 2')).toBeInTheDocument();
  });

  it('archives through the confirmation dialog, which Escape can cancel', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ products: [fan()] });
    const { router } = renderWeb(EDIT_PATH, api);

    const archive = await screen.findByRole('button', { name: 'Archive' });
    await user.click(archive);

    const dialog = screen.getByRole('alertdialog', { name: `Archive ${THAI_NAME}?` });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(archive).toHaveFocus();
    expect(api.calls.some((call) => call.path.endsWith('/archive'))).toBe(false);

    await user.click(archive);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive product' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe(LIST_PATH));
    expect(api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/archive'))).toBe(
      true,
    );
    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument();
    expect(api.products[0]?.status).toBe('archived');
  });

  it('restores an archived product and it returns to Active', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      products: [makeProduct({ id: PRODUCT_ID, name: THAI_NAME, status: 'archived', version: 3 })],
    });
    renderWeb(EDIT_PATH, api);

    await user.click(await screen.findByRole('button', { name: 'Restore' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Product restored');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.endsWith('/unarchive'))).toBe(true);
    expect(screen.getByText('Version 4')).toBeInTheDocument();
  });

  it('keeps an archived product editable', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      products: [makeProduct({ id: PRODUCT_ID, name: THAI_NAME, status: 'archived' })],
    });
    renderWeb(EDIT_PATH, api);

    const name = await screen.findByLabelText('Name');
    await user.type(name, ' 2');
    await user.click(screen.getByRole('button', { name: 'Save product' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Product saved');
    expect(api.products[0]?.name).toBe(`${THAI_NAME} 2`);
  });

  it('shows an Images and videos section with an upload area and only this product files', async () => {
    const api = createFakeApi({
      products: [fan()],
      assets: [
        makeAsset({ id: 'asset_1', originalFilename: 'fan-front.png', productId: PRODUCT_ID }),
        makeAsset({ id: 'asset_2', originalFilename: 'elsewhere.png', productId: 'prod_other' }),
      ],
    });
    renderWeb(EDIT_PATH, api);

    const section = await screen.findByRole('region', { name: 'Images and videos' });
    expect(within(section).getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
    expect(
      await within(section).findByRole('button', { name: /fan-front\.png/ }),
    ).toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /elsewhere\.png/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the cover thumbnail next to the title when the product has a cover', async () => {
    renderWeb(
      EDIT_PATH,
      createFakeApi({
        products: [fan({ primaryAssetId: 'asset_1' })],
        assets: [
          makeAsset({ id: 'asset_1', originalFilename: 'fan-front.png', productId: PRODUCT_ID }),
        ],
      }),
    );

    expect(await screen.findByRole('img', { name: 'Cover: fan-front.png' })).toHaveAttribute(
      'src',
      'http://api.test/api/v1/media/asset_1/thumb?exp=1&sig=test',
    );
    expect(screen.getByRole('heading', { name: THAI_NAME })).toBeInTheDocument();
  });

  it('shows no cover thumbnail when the product has no cover', async () => {
    renderWeb(EDIT_PATH, createFakeApi({ products: [fan()] }));
    await screen.findByRole('heading', { name: THAI_NAME });
    expect(screen.queryByRole('img', { name: /Cover:/ })).not.toBeInTheDocument();
  });
});
