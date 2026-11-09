import { CONTENT_LIMITS, type Product, type Template } from '@creatorops/contracts';
import { describe, expect, it } from 'vitest';

import { campaignNameFor, createSteps, newCreateKey, pickedInputs } from './create.js';

const template = (id: string, en = 'Product showcase'): Template => ({
  id,
  version: 1,
  name: { th: 'โชว์สินค้า', en },
  description: { th: 'x', en: 'x' },
  defaultDurationSeconds: 30,
});
const product = (id: string, name: string) => ({ id, name }) as Product;

describe('createSteps', () => {
  it('runs only the script step today and shows images and video honestly as coming next', () => {
    expect(createSteps().map((step) => [step.id, step.state])).toEqual([
      ['script', 'ready'],
      ['images', 'optional'],
      ['video', 'soon'],
    ]);
  });
});

describe('campaignNameFor', () => {
  it('joins the product and the mode', () => {
    expect(campaignNameFor(product('p', 'พัดลมตั้งโต๊ะ'), template('t'))).toBe(
      'พัดลมตั้งโต๊ะ · Product showcase',
    );
  });

  it('cuts a long name to the limit by whole characters, never in the middle of one', () => {
    const long = 'ก็'.repeat(CONTENT_LIMITS.campaignName) + '😀'.repeat(50);
    const name = campaignNameFor(product('p', long), template('t'));
    expect(Array.from(name).length).toBeLessThanOrEqual(CONTENT_LIMITS.campaignName);
    expect(name).not.toMatch(/[\ud800-\udbff]$/u);
    expect(name.length).toBeGreaterThan(0);
  });

  it('never returns an empty or padded name', () => {
    expect(campaignNameFor(product('p', 'A'), template('t', 'B'))).toBe('A · B');
  });
});

describe('newCreateKey', () => {
  it('is a valid Idempotency-Key and differs every time', () => {
    const a = newCreateKey();
    expect(a).toMatch(/^ext-[0-9a-f-]{36}$/);
    expect(newCreateKey()).not.toBe(a);
  });
});

describe('pickedInputs', () => {
  const products = [product('p1', 'One'), product('p2', 'Two')];
  const templates = [template('t1'), template('t2')];

  it('returns the chosen product and mode', () => {
    const picked = pickedInputs(products, templates, 'p2', 't1');
    expect(picked?.product.id).toBe('p2');
    expect(picked?.template.id).toBe('t1');
  });

  it('returns null until both exist in the lists', () => {
    expect(pickedInputs(products, templates, '', 't1')).toBeNull();
    expect(pickedInputs(products, templates, 'p1', '')).toBeNull();
    expect(pickedInputs(products, templates, 'gone', 't1')).toBeNull();
    expect(pickedInputs(products, templates, 'p1', 'gone')).toBeNull();
  });
});
