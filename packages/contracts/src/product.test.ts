import { describe, expect, it } from 'vitest';

import {
  CreateProductRequestSchema,
  ProductListQuerySchema,
  UpdateProductRequestSchema,
} from './product.js';

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => result.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? [];

describe('CreateProductRequestSchema', () => {
  it('accepts a minimal product and applies list defaults', () => {
    const parsed = CreateProductRequestSchema.parse({ name: '  พัดลมตั้งโต๊ะ  ' });
    expect(parsed.name).toBe('พัดลมตั้งโต๊ะ');
    expect(parsed.sellingPoints).toEqual([]);
    expect(parsed.restrictedClaims).toEqual([]);
  });

  it('rejects unknown fields (no mass assignment)', () => {
    for (const extra of [
      { workspaceId: 'w' },
      { status: 'archived' },
      { version: 3 },
      { primaryAssetId: 'a' },
      { id: 'x' },
    ]) {
      expect(
        CreateProductRequestSchema.safeParse({ name: 'x', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('enforces length limits and non-empty list items', () => {
    expect(CreateProductRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateProductRequestSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', description: 'y'.repeat(5001) }).success,
    ).toBe(false);
    expect(CreateProductRequestSchema.safeParse({ name: 'x', sellingPoints: [''] }).success).toBe(
      false,
    );
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', sellingPoints: ['   '] }).success,
    ).toBe(false);
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', sellingPoints: Array(21).fill('a') })
        .success,
    ).toBe(false);
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', sellingPoints: ['a'.repeat(301)] }).success,
    ).toBe(false);
  });

  it('accepts only http and https URLs without credentials', () => {
    for (const ok of ['https://shop.example.com/p/1?x=1', 'http://localhost:3000/a']) {
      expect(CreateProductRequestSchema.safeParse({ name: 'x', sourceUrl: ok }).success, ok).toBe(
        true,
      );
    }
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://x.test/a',
      'https://user:pw@x.test/',
      'not a url',
      'file:///etc/passwd',
      '//x.test/a',
    ]) {
      expect(CreateProductRequestSchema.safeParse({ name: 'x', sourceUrl: bad }).success, bad).toBe(
        false,
      );
    }
  });

  it('validates price as a fixed-point string and requires a currency with it', () => {
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', priceAmount: '199.50', currency: 'THB' })
        .success,
    ).toBe(true);
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', priceAmount: '199', currency: 'THB' })
        .success,
    ).toBe(true);
    for (const priceAmount of ['-1', '1.234', '1e3', 'abc', '', '12345678901']) {
      expect(
        CreateProductRequestSchema.safeParse({ name: 'x', priceAmount, currency: 'THB' }).success,
        priceAmount,
      ).toBe(false);
    }
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', priceAmount: 199, currency: 'THB' })
        .success,
    ).toBe(false);
    const missingCurrency = CreateProductRequestSchema.safeParse({ name: 'x', priceAmount: '5' });
    expect(issues(missingCurrency)).toContain(
      'currency: priceAmount and currency must be given together',
    );
    expect(CreateProductRequestSchema.safeParse({ name: 'x', currency: 'THB' }).success).toBe(
      false,
    );
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', priceAmount: '5', currency: 'thb' })
        .success,
    ).toBe(false);
    expect(
      CreateProductRequestSchema.safeParse({ name: 'x', priceAmount: null, currency: null })
        .success,
    ).toBe(true);
  });
});

describe('UpdateProductRequestSchema', () => {
  it('requires the version and at least one field to change', () => {
    expect(UpdateProductRequestSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(UpdateProductRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(UpdateProductRequestSchema.safeParse({ version: 0, name: 'x' }).success).toBe(false);
    expect(UpdateProductRequestSchema.safeParse({ version: 1.5, name: 'x' }).success).toBe(false);
    expect(UpdateProductRequestSchema.safeParse({ version: 1, name: 'x' }).success).toBe(true);
  });

  it('lets a field be cleared with null and rejects unknown or protected fields', () => {
    expect(
      UpdateProductRequestSchema.safeParse({ version: 1, description: null, sourceUrl: null })
        .success,
    ).toBe(true);
    expect(UpdateProductRequestSchema.safeParse({ version: 1, name: null }).success).toBe(false);
    for (const extra of [
      { workspaceId: 'w' },
      { status: 'archived' },
      { id: 'x' },
      { archivedAt: 't' },
    ]) {
      expect(
        UpdateProductRequestSchema.safeParse({ version: 1, name: 'x', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe('ProductListQuerySchema', () => {
  it('applies defaults and coerces limit from a string', () => {
    expect(ProductListQuerySchema.parse({})).toEqual({ status: 'active', limit: 25 });
    expect(ProductListQuerySchema.parse({ limit: '50', status: 'archived' })).toEqual({
      status: 'archived',
      limit: 50,
    });
  });

  it('bounds limit and rejects unknown parameters and statuses', () => {
    for (const bad of [
      { limit: '0' },
      { limit: '101' },
      { limit: 'abc' },
      { status: 'deleted' },
      { workspaceId: 'w' },
    ]) {
      expect(ProductListQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
