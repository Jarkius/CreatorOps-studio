import { describe, expect, it } from 'vitest';

import { dashboardHref, formatPrice } from './format.js';

describe('formatPrice', () => {
  it('formats a decimal string with its currency using Intl', () => {
    const expected = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'THB',
    }).format(1290.5);
    expect(formatPrice('1290.50', 'THB')).toBe(expected);
  });

  it('falls back to the raw amount and code when Intl rejects the currency', () => {
    expect(formatPrice('12.00', 'US1')).toBe('12.00 US1');
  });

  it('shows the raw amount when no currency is stored', () => {
    expect(formatPrice('12.00', null)).toBe('12.00');
  });
});

describe('dashboardHref', () => {
  it('resolves a path against the dashboard origin', () => {
    expect(dashboardHref('http://localhost:5173', '/w/w1/products/new')).toBe(
      'http://localhost:5173/w/w1/products/new',
    );
  });
});
