import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createFakeApi, makeProduct, WORKSPACE } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';
import { shopeeLinkOf } from './format.js';

describe('shopeeLinkOf', () => {
  it('accepts Shopee Thailand hosts only', () => {
    expect(shopeeLinkOf('https://shopee.co.th/product/1/2')).toBe(
      'https://shopee.co.th/product/1/2',
    );
    expect(shopeeLinkOf('https://affiliate.shopee.co.th/offer/x')).not.toBeNull();
    expect(shopeeLinkOf('https://evilshopee.co.th/x')).toBeNull();
    expect(shopeeLinkOf('https://shopee.co.th.evil.com/x')).toBeNull();
    expect(shopeeLinkOf('javascript:alert(1)')).toBeNull();
    expect(shopeeLinkOf('not a url')).toBeNull();
    expect(shopeeLinkOf(null)).toBeNull();
  });
});

describe('ProductsPage Shopee marker', () => {
  it('links imported Shopee products and leaves others alone', async () => {
    const api = createFakeApi({
      products: [
        makeProduct({ id: 'p1', name: 'Kettle', sourceUrl: 'https://shopee.co.th/product/1/2' }),
        makeProduct({ id: 'p2', name: 'Lamp', sourceUrl: 'https://example.com/lamp' }),
      ],
    });
    renderWeb(`/w/${WORKSPACE.id}/products`, api);
    const list = await screen.findByRole('list', { name: 'Active products' });
    const links = within(list).getAllByRole('link', { name: /Open on Shopee/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://shopee.co.th/product/1/2');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
