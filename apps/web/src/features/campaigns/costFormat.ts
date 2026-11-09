import type { ManualCost } from '@creatorops/contracts';

export { formatBaht, formatUsdFromBaht } from '@creatorops/contracts';

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
