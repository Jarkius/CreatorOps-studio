import { describe, expect, it } from 'vitest';

import { formatBaht, parseBahtInput } from './costFormat.js';

describe('formatBaht', () => {
  it('shows the baht sign and two decimals', () => {
    expect(formatBaht(12.5)).toBe('฿12.50');
    expect(formatBaht(1234.5)).toBe('฿1,234.50');
    expect(formatBaht(0)).toBe('฿0.00');
  });
});

describe('parseBahtInput', () => {
  it('accepts whole baht and up to two decimals, with thousands separators', () => {
    expect(parseBahtInput('25')).toEqual({ ok: true, amountThb: 25 });
    expect(parseBahtInput(' 12.50 ')).toEqual({ ok: true, amountThb: 12.5 });
    expect(parseBahtInput('1,250.5')).toEqual({ ok: true, amountThb: 1250.5 });
  });

  it('refuses empty, negative, zero, too many decimals, letters and huge amounts', () => {
    for (const bad of [
      '',
      '  ',
      '-5',
      '0',
      '0.00',
      '1.234',
      'abc',
      '12฿',
      '1e3',
      '1000000.01',
      '12345678',
    ]) {
      expect(parseBahtInput(bad).ok, bad).toBe(false);
    }
  });
});
