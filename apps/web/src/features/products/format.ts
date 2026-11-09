/**
 * "990.00 THB" style text. Falls back to the raw "amount currency" text when the browser rejects
 * the currency code, so a bad code never hides the price.
 */
export function formatPrice(amount: string | null, currency: string | null): string {
  if (amount === null) return 'No price';
  if (currency === null) return amount;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
  } catch (error) {
    if (error instanceof RangeError) return `${amount} ${currency}`;
    throw error;
  }
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}

/** The Shopee page a product was imported from, or null when it came from somewhere else. */
export function shopeeLinkOf(sourceUrl: string | null): string | null {
  if (sourceUrl === null) return null;
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();
    const isShopee = host === 'shopee.co.th' || host.endsWith('.shopee.co.th');
    return isShopee && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
  } catch {
    return null;
  }
}
