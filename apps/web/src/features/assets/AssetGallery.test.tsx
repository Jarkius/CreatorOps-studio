import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Product } from '@creatorops/contracts';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  createFakeApi,
  json,
  makeAsset,
  makeProduct,
  THAI_NAME,
  WORKSPACE,
} from '../../test/fakeApi.js';
import type { FakeApi } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const LIBRARY = `/w/${WORKSPACE.id}/assets`;
const PRODUCT_ID = 'prod_fan';
const PRODUCT_PATH = `/w/${WORKSPACE.id}/products/${PRODUCT_ID}`;
const MB = 1024 * 1024;

const photo = () => makeAsset({ id: 'asset_1', originalFilename: 'photo.png' });
const clip = () =>
  makeAsset({
    id: 'asset_2',
    originalFilename: 'clip.mp4',
    mimeType: 'video/mp4',
    type: 'video',
    sizeBytes: 2 * MB,
  });

const galleryList = () => screen.getByRole('list', { name: 'Files' });
const listGets = (api: FakeApi) =>
  api.calls.filter((call) => call.method === 'GET' && /\/assets(\?|$)/.test(call.path)).length;

function product(overrides: Partial<Product> = {}) {
  return makeProduct({ id: PRODUCT_ID, name: THAI_NAME, version: 3, ...overrides });
}

describe('AssetGallery on the asset library', () => {
  it('shows a loading state, then tiles with thumbnails and a Thai file name kept whole', async () => {
    const api = createFakeApi({
      assets: [makeAsset({ id: 'asset_9', originalFilename: `${THAI_NAME}.png` }), clip()],
    });
    renderWeb(LIBRARY, api);

    expect(screen.getByText('Loading files…')).toBeInTheDocument();
    const thumb = await screen.findByRole('img', { name: `${THAI_NAME}.png` });
    expect(thumb).toHaveAttribute(
      'src',
      'http://api.test/api/v1/media/asset_9/thumb?exp=1&sig=test',
    );
    expect(thumb).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('button', { name: /clip\.mp4/ })).toHaveTextContent('Video · 2.0 MB');
  });

  it('shows the empty state when there are no files', async () => {
    renderWeb(LIBRARY, createFakeApi());
    expect(await screen.findByRole('heading', { name: 'No files yet' })).toBeInTheDocument();
  });

  it('shows an error with the reference and retries the list', async () => {
    const user = userEvent.setup();
    let failing = true;
    const api = createFakeApi({
      assets: [photo()],
      intercept: (call) =>
        failing && call.method === 'GET' && /\/assets(\?|$)/.test(call.path)
          ? json(
              {
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Files are unavailable.',
                  requestId: 'req-9',
                },
              },
              500,
            )
          : undefined,
    });
    renderWeb(LIBRARY, api);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load files');
    expect(alert).toHaveTextContent('Files are unavailable.');
    expect(alert).toHaveTextContent('Reference: req-9');

    failing = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /photo\.png/ })).toBeInTheDocument();
  });

  it('filters by type through the URL, and says so when the filter has no matches', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ assets: [photo(), clip()] });
    const { router } = renderWeb(LIBRARY, api);

    await user.selectOptions(await screen.findByLabelText('Type'), 'video');

    expect(router.state.location.search).toBe('?type=video');
    expect(await screen.findByRole('button', { name: /clip\.mp4/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /photo\.png/ })).not.toBeInTheDocument();
    expect(api.calls.at(-1)?.path).toContain('type=video');

    await user.selectOptions(screen.getByLabelText('Type'), 'all');
    expect(router.state.location.search).toBe('');
    expect(await screen.findByRole('button', { name: /photo\.png/ })).toBeInTheDocument();
  });

  it('searches by name after a pause in typing, through the URL, and says when nothing matches', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ assets: [photo(), clip()] });
    const { router } = renderWeb(LIBRARY, api);

    const box = await screen.findByLabelText('Search by name');
    await screen.findByRole('button', { name: /photo\.png/ });
    const before = listGets(api);
    await user.type(box, 'CLI');
    // One request after the pause, not one per key.
    await waitFor(() => expect(router.state.location.search).toBe('?q=CLI'));
    expect(await screen.findByRole('button', { name: /clip\.mp4/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /photo\.png/ })).not.toBeInTheDocument();
    expect(listGets(api) - before).toBe(1);
    expect(api.calls.at(-1)?.path).toContain('q=CLI');

    await user.clear(box);
    await user.type(box, 'zzz');
    expect(await screen.findByRole('heading', { name: 'No files match' })).toBeInTheDocument();

    await user.clear(box);
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByRole('button', { name: /photo\.png/ })).toBeInTheDocument();
  });

  it('starts with the search from the URL', async () => {
    renderWeb(`${LIBRARY}?q=photo`, createFakeApi({ assets: [photo(), clip()] }));
    expect(await screen.findByRole('button', { name: /photo\.png/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clip\.mp4/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search by name')).toHaveValue('photo');
  });

  it('starts filtered when the URL says so, and reports an empty filter', async () => {
    renderWeb(`${LIBRARY}?type=video`, createFakeApi({ assets: [photo()] }));
    expect(await screen.findByRole('heading', { name: 'No videos yet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toHaveValue('video');
  });

  it('loads 24 files at a time and adds the next page on Load more', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 30 }, (_, index) =>
      makeAsset({
        id: `asset_${index + 1}`,
        originalFilename: `shot-${String(index + 1).padStart(2, '0')}.png`,
      }),
    );
    renderWeb(LIBRARY, createFakeApi({ assets: many }));

    await screen.findByRole('button', { name: /shot-01\.png/ });
    expect(within(galleryList()).getAllByRole('listitem')).toHaveLength(24);

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(within(galleryList()).getAllByRole('listitem')).toHaveLength(30));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('opens a labelled dialog with focus inside, closes on Escape and returns focus to the tile', async () => {
    const user = userEvent.setup();
    renderWeb(LIBRARY, createFakeApi({ assets: [photo()] }));

    const tile = await screen.findByRole('button', { name: /photo\.png/ });
    await user.click(tile);

    const dialog = screen.getByRole('dialog', { name: 'photo.png' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(within(dialog).getByRole('img', { name: 'photo.png' })).toBeInTheDocument();
    expect(within(dialog).getByText('1 × 1')).toBeInTheDocument();
    expect(within(dialog).getByText('1.0 KB')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tile).toHaveFocus();
  });

  it('plays a video with native controls in the preview', async () => {
    const user = userEvent.setup();
    renderWeb(LIBRARY, createFakeApi({ assets: [clip()] }));

    await user.click(await screen.findByRole('button', { name: /clip\.mp4/ }));

    const dialog = screen.getByRole('dialog', { name: 'clip.mp4' });
    const video = dialog.querySelector('video');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute(
      'src',
      'http://api.test/api/v1/media/asset_2/original?exp=1&sig=test',
    );
    expect(within(dialog).getByText('Not available')).toBeInTheDocument();
  });

  it('does not offer a cover on the library, where there is no product', async () => {
    const user = userEvent.setup();
    renderWeb(LIBRARY, createFakeApi({ assets: [photo()] }));

    await user.click(await screen.findByRole('button', { name: /photo\.png/ }));

    expect(screen.queryByRole('button', { name: 'Use as cover' })).not.toBeInTheDocument();
  });

  it('deletes a file after confirmation, and it disappears from the gallery', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ assets: [photo(), clip()] });
    renderWeb(LIBRARY, api);

    await user.click(await screen.findByRole('button', { name: /photo\.png/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete photo.png?' });
    expect(within(confirm).getByText(/removed from this workspace/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Delete file' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /photo\.png/ })).not.toBeInTheDocument();
    expect(api.assets.map((asset) => asset.id)).toEqual(['asset_2']);
    expect(
      api.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/asset_1')),
    ).toBe(true);
  });

  it('keeps the file when the delete is cancelled', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ assets: [photo()] });
    renderWeb(LIBRARY, api);

    await user.click(await screen.findByRole('button', { name: /photo\.png/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'photo.png' })).toBeInTheDocument();
    expect(api.assets).toHaveLength(1);
  });

  it('refreshes the lists once when a media URL fails, and not again on repeated failures', async () => {
    const api = createFakeApi({ assets: [photo()] });
    renderWeb(LIBRARY, api);
    const image = await screen.findByRole('img', { name: 'photo.png' });
    const before = listGets(api);

    fireEvent.error(image);
    await waitFor(() => expect(listGets(api)).toBe(before + 1));

    fireEvent.error(image);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(listGets(api)).toBe(before + 1);
  });
});

describe('AssetGallery on a product page', () => {
  it('lists only the files of that product', async () => {
    const api = createFakeApi({
      products: [product()],
      assets: [
        makeAsset({ id: 'asset_1', originalFilename: 'mine.png', productId: PRODUCT_ID }),
        makeAsset({ id: 'asset_2', originalFilename: 'other.png', productId: 'prod_other' }),
      ],
    });
    renderWeb(PRODUCT_PATH, api);

    expect(await screen.findByRole('button', { name: /mine\.png/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /other\.png/ })).not.toBeInTheDocument();
  });

  it('sets a picture as the cover with the current version, shows the badge, and can remove it', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      products: [product()],
      assets: [makeAsset({ id: 'asset_1', originalFilename: 'photo.png', productId: PRODUCT_ID })],
    });
    renderWeb(PRODUCT_PATH, api);

    await user.click(await screen.findByRole('button', { name: /photo\.png/ }));
    const dialog = screen.getByRole('dialog', { name: 'photo.png' });
    await user.click(within(dialog).getByRole('button', { name: 'Use as cover' }));

    expect(await within(dialog).findByText('Cover')).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      version: 3,
      primaryAssetId: 'asset_1',
    });
    expect(api.products[0]?.primaryAssetId).toBe('asset_1');
    expect(await screen.findByRole('img', { name: 'Cover: photo.png' })).toBeInTheDocument();

    // The version moved to 4 with the first change, so the next change must send 4.
    await user.click(within(dialog).getByRole('button', { name: 'Remove cover' }));
    await waitFor(() => expect(api.products[0]?.primaryAssetId).toBeNull());
    expect(api.calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
      version: 4,
      primaryAssetId: null,
    });
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Cover: photo.png' })).not.toBeInTheDocument(),
    );
  });

  it('does not offer a cover for a video', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      products: [product()],
      assets: [
        makeAsset({
          id: 'asset_2',
          originalFilename: 'clip.mp4',
          mimeType: 'video/mp4',
          type: 'video',
          productId: PRODUCT_ID,
        }),
      ],
    });
    renderWeb(PRODUCT_PATH, api);

    await user.click(await screen.findByRole('button', { name: /clip\.mp4/ }));

    const dialog = screen.getByRole('dialog', { name: 'clip.mp4' });
    expect(within(dialog).queryByRole('button', { name: 'Use as cover' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('says the product changed when the cover save is stale, and Load latest then allows the save', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      products: [product({ name: THAI_NAME, version: 1 })],
      assets: [makeAsset({ id: 'asset_1', originalFilename: 'photo.png', productId: PRODUCT_ID })],
    });
    renderWeb(PRODUCT_PATH, api);
    await user.click(await screen.findByRole('button', { name: /photo\.png/ }));
    const dialog = screen.getByRole('dialog', { name: 'photo.png' });

    api.saveElsewhere(PRODUCT_ID, { name: 'Changed by a colleague' });
    await user.click(within(dialog).getByRole('button', { name: 'Use as cover' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This product was changed by someone else.');
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      version: 1,
      primaryAssetId: 'asset_1',
    });
    expect(api.products[0]?.primaryAssetId).toBeNull();

    await user.click(within(alert).getByRole('button', { name: 'Load latest' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());

    await user.click(within(dialog).getByRole('button', { name: 'Use as cover' }));
    expect(await within(dialog).findByText('Cover')).toBeInTheDocument();
    expect(api.calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
      version: 2,
      primaryAssetId: 'asset_1',
    });
  });

  it('clears the cover when its file is deleted', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      products: [product({ primaryAssetId: 'asset_1' })],
      assets: [makeAsset({ id: 'asset_1', originalFilename: 'photo.png', productId: PRODUCT_ID })],
    });
    renderWeb(PRODUCT_PATH, api);
    expect(await screen.findByRole('img', { name: 'Cover: photo.png' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /photo\.png/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete file' }),
    );

    await waitFor(() => expect(api.products[0]?.primaryAssetId).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Cover: photo.png' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /photo\.png/ })).not.toBeInTheDocument();
  });
});
