import type { ShopeeHints } from './page.js';

/**
 * Everything the Shopee importer knows about the Shopee Affiliate site, in one place (D-082).
 * Nothing here is verified against the signed-in page (it cannot be reached from the build
 * environment): the reader finds products by their content, and "Copy diagnostics" says what it
 * saw, so a change on the site is a small edit here or in `page.ts`.
 */
export const SHOPEE_AFFILIATE_ORIGIN = 'https://affiliate.shopee.co.th';
export const SHOPEE_AFFILIATE_PATTERN = `${SHOPEE_AFFILIATE_ORIGIN}/*`;
/** Opened (visibly) when no Shopee Affiliate tab is open. */
export const SHOPEE_OFFER_URL = `${SHOPEE_AFFILIATE_ORIGIN}/offer/product_offer`;
/** At most this many products are read from one page. */
export const SHOPEE_MAX_OFFERS = 200;

export const SHOPEE_HINTS: ShopeeHints = {
  loginHints: ['เข้าสู่ระบบ', 'log in', 'login', 'sign in'],
  // Checked on 2026-11-05: a signed-out headless browser was sent to shopee.co.th/verify/traffic.
  challengePaths: ['/verify/traffic', '/verify/captcha'],
  challengeHints: [
    'captcha',
    'ยืนยันตัวตน',
    'เข้าสู่หน้าที่ต้องการไม่สำเร็จ',
    'verify you are human',
    'unusual traffic',
  ],
  limitHints: ['too many requests', 'ทำรายการบ่อยเกินไป', 'try again later'],
};
