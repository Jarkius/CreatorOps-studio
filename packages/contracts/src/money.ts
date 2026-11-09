const baht = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd4 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/** `฿12.50`. Amounts below one satang show as ฿0.00 (AI calls can cost a fraction of a satang). */
export function formatBaht(amount: number): string {
  return baht.format(amount);
}

/** Baht as US dollars at the market rate: `$0.36`; below ten cents four decimals keep tiny costs visible. */
export function formatUsdFromBaht(amountThb: number, marketThbPerUsd: number): string {
  const value = amountThb / marketThbPerUsd;
  return value === 0 || value >= 0.1 ? usd2.format(value) : usd4.format(value);
}
