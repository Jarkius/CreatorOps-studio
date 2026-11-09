import { describe, expect, it } from 'vitest';

import { formatBaht, formatUsdFromBaht } from './money.js';

describe('formatBaht', () => {
  it('shows the baht sign and two decimals', () => {
    expect(formatBaht(12.5)).toBe('฿12.50');
    expect(formatBaht(1234.5)).toBe('฿1,234.50');
    expect(formatBaht(0)).toBe('฿0.00');
  });
});

describe('formatUsdFromBaht', () => {
  it('divides by the market rate; four decimals below ten cents, two from ten cents up', () => {
    expect(formatUsdFromBaht(35, 35)).toBe('$1.00');
    expect(formatUsdFromBaht(12.5, 35)).toBe('$0.36');
    expect(formatUsdFromBaht(3.5, 40)).toBe('$0.0875');
    expect(formatUsdFromBaht(0.03, 35)).toBe('$0.0009');
    expect(formatUsdFromBaht(0, 35)).toBe('$0.00');
  });
});
