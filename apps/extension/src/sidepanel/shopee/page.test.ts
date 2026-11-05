import { afterEach, describe, expect, it } from 'vitest';

import { readShopeeOffers } from './page.js';
import { SHOPEE_HINTS } from './selectors.js';

const read = (max = 200) => readShopeeOffers(SHOPEE_HINTS, max);

function page(html: string, path = '/offer/product_offer') {
  window.history.pushState({}, '', path);
  document.title = 'Shopee Affiliate';
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

const thaiCard = (id: number, name: string, extra = '') => `
  <div class="card">
    <a href="https://shopee.co.th/${encodeURIComponent(name)}-i.123.${id}?sp_atk=abc#x"><img alt="${name}" src="https://cf.shopee.co.th/${id}.jpg"></a>
    <div><span>${name}</span></div>
    <div><span>฿1,290</span> - <span>฿1,590</span></div>
    <div><span>-20%</span></div>
    <div><span>ค่าคอมมิชชั่น</span><span>12.5%</span></div>
    <div><span>ขายแล้ว 1.2พัน</span></div>
    ${extra}
  </div>`;

describe('readShopeeOffers', () => {
  it('reads name, lowest price, commission (not the discount), sales and a clean link from Thai cards', () => {
    page(`<main>${thaiCard(1, 'เครื่องชงกาแฟพกพา')}${thaiCard(2, 'พัดลมตั้งโต๊ะ')}</main>`);
    const result = read();
    expect(result.state).toBe('ready');
    expect(result.offers).toEqual([
      {
        name: 'เครื่องชงกาแฟพกพา',
        priceThb: 1290,
        commissionPercent: 12.5,
        sales: '1.2พัน',
        link: `https://shopee.co.th/${encodeURIComponent('เครื่องชงกาแฟพกพา')}-i.123.1`,
      },
      expect.objectContaining({ name: 'พัดลมตั้งโต๊ะ', commissionPercent: 12.5 }),
    ]);
  });

  it('reads an English card with the commission on the same line, and /product/ links', () => {
    page(`<div>
      <a href="https://shopee.co.th/product/55/66" title="Portable fan">Portable fan</a>
      <p>฿199</p><p>Commission 8%</p><p>10k sold</p>
    </div>`);
    expect(read().offers).toEqual([
      {
        name: 'Portable fan',
        priceThb: 199,
        commissionPercent: 8,
        sales: '10k',
        link: 'https://shopee.co.th/product/55/66',
      },
    ]);
  });

  it('keeps a card without a commission label, with the commission left empty', () => {
    page(
      `<div><a href="https://shopee.co.th/x-i.1.9" title="Mug">Mug</a><span>฿99</span><span>-50%</span></div>`,
    );
    expect(read().offers[0]).toMatchObject({ name: 'Mug', priceThb: 99, commissionPercent: null });
  });

  it('lists each product once, and stops at the cap', () => {
    const cards = Array.from({ length: 5 }, (_v, i) => thaiCard(i, `สินค้า ${i}`)).join('');
    page(`${cards}${thaiCard(0, 'สินค้า 0')}`);
    expect(read().offers).toHaveLength(5);
    expect(read(3).offers.map((o) => o.name)).toEqual(['สินค้า 0', 'สินค้า 1', 'สินค้า 2']);
    expect(read().linksSeen).toBe(6);
  });

  it('ignores links that are not Shopee products, http links and look-alike hosts', () => {
    page(`
      <div><a href="https://evil.example/x-i.1.2" title="Bad">Bad</a><span>฿10</span></div>
      <div><a href="http://shopee.co.th/x-i.1.3" title="Plain">Plain</a><span>฿10</span></div>
      <div><a href="https://shopee.co.th.evil.example/x-i.1.4" title="Fake">Fake</a><span>฿10</span></div>
      <div><a href="https://shopee.co.th/help" title="Help">Help</a><span>฿10</span></div>
      <div><a href="javascript:alert(1)" title="Js">Js</a><span>฿10</span></div>`);
    const result = read();
    expect(result.offers).toEqual([]);
    expect(result.linksSeen).toBe(0);
  });

  it('accepts shope.ee short links', () => {
    page(`<div><a href="https://shope.ee/AbC123" title="Short">Short</a><span>฿10</span></div>`);
    expect(read().offers[0]?.link).toBe('https://shope.ee/AbC123');
  });

  it("says when Shopee's traffic check or a sign-in page is showing", () => {
    page('<p>เข้าสู่หน้าที่ต้องการไม่สำเร็จ</p>', '/verify/traffic/error');
    expect(read().state).toBe('challenge');
    page('<p>something went wrong</p>', '/verify/traffic/error');
    expect(read().state).toBe('challenge');
    page('<button>เข้าสู่ระบบ</button>');
    expect(read().state).toBe('login');
    // A product list with a sign-in button in the header is still a product list.
    page(`<header><button>เข้าสู่ระบบ</button></header>${thaiCard(1, 'สินค้า')}`);
    expect(read().state).toBe('ready');
    page('<p>nothing here</p>');
    expect(read().state).toBe('unknown');
  });

  it('never puts the query string (tracking tokens) into a link or the path', () => {
    page(thaiCard(7, 'สินค้า'), '/offer/product_offer');
    const result = read();
    expect(result.offers[0]?.link).not.toContain('?');
    expect(result.offers[0]?.link).not.toContain('sp_atk');
    expect(result.path).toBe('/offer/product_offer');
  });
});
