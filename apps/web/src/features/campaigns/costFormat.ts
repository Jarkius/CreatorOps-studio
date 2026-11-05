import type { ManualCost } from '@creatorops/contracts';

const baht = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `฿12.50`. Amounts below one satang show as ฿0.00 (AI calls can cost a fraction of a satang). */
export function formatBaht(amount: number): string {
  return baht.format(amount);
}

const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd4 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/** Baht as US dollars at the market rate: `$0.36`; below ten cents four decimals keep tiny costs visible. */
export function formatUsdFromBaht(amountThb: number, marketThbPerUsd: number): string {
  const value = amountThb / marketThbPerUsd;
  return value === 0 || value >= 0.1 ? usd2.format(value) : usd4.format(value);
}

export const SCENE_LABELS: Record<NonNullable<ManualCost['scene']>, string> = {
  product_hero: 'Product hero',
  detail: 'Detail',
  usage: 'Usage',
  final_shot: 'Final shot',
};

export type AmountResult = { ok: true; amountThb: number } | { ok: false; error: string };

/** Parses what was typed into the baht box: a positive amount with at most two decimals. */
export function parseBahtInput(value: string): AmountResult {
  const trimmed = value.trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: 'Enter an amount in baht such as 25 or 12.50.' };
  }
  const amount = Number(trimmed);
  if (amount < 0.01) return { ok: false, error: 'The amount must be at least ฿0.01.' };
  if (amount > 1_000_000) return { ok: false, error: 'The amount is too large.' };
  return { ok: true, amountThb: amount };
}
