import { describe, expect, it } from 'vitest';

import type { ProviderSettings } from '@creatorops/contracts';

import {
  buildProviderRequest,
  EMPTY_FORM,
  formFromSettings,
  type ProviderFormValues,
} from './providerForm.js';

const saved: ProviderSettings = {
  configured: true,
  source: 'workspace',
  provider: 'custom',
  baseUrl: 'https://gateway.example.com/v1',
  model: 'vendor/model',
  keyLast4: 'ABCD',
  pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15, multiplier: 1.3, minPerRequestUsd: 0 },
  monthlyCapUsd: 20,
  canStoreKey: true,
  version: 4,
  updatedAt: '2026-11-05T00:00:00.000Z',
};

const filled = (extra: Partial<ProviderFormValues> = {}): ProviderFormValues => ({
  ...EMPTY_FORM,
  model: 'vendor/model-x',
  apiKey: 'sk-or-v1-abcdef123456',
  ...extra,
});

describe('formFromSettings', () => {
  it('is empty for no settings, and never holds the key', () => {
    expect(formFromSettings(undefined)).toEqual(EMPTY_FORM);
    const form = formFromSettings(saved);
    expect(form).toMatchObject({
      provider: 'custom',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'vendor/model',
      inputPrice: '3',
      outputPrice: '15',
      multiplier: '1.3',
      monthlyCap: '20',
    });
    expect(form.apiKey).toBe('');
  });
});

describe('buildProviderRequest', () => {
  it('builds an OpenRouter request with its own address and no prices', () => {
    const result = buildProviderRequest(filled(), undefined);
    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openrouter',
        model: 'vendor/model-x',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-v1-abcdef123456',
        pricing: null,
        monthlyCapUsd: null,
      },
    });
  });

  it('needs the key the first time, but not when one is saved (and then sends the version)', () => {
    const first = buildProviderRequest(filled({ apiKey: '' }), undefined);
    expect(first.ok).toBe(false);
    const again = buildProviderRequest(
      filled({ apiKey: '', provider: 'custom', baseUrl: 'https://gateway.example.com/v1' }),
      saved,
    );
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.request.apiKey).toBeUndefined();
      expect(again.request.version).toBe(4);
    }
  });

  it('checks the model, key shape and custom address', () => {
    const bad = buildProviderRequest(
      {
        ...EMPTY_FORM,
        provider: 'custom',
        baseUrl: 'http://10.0.0.1/v1',
        model: '  ',
        apiKey: 'a b',
      },
      undefined,
    );
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['apiKey', 'baseUrl', 'model']);
  });

  it('builds prices with defaults for the multiplier and minimum, and parses the limit', () => {
    const result = buildProviderRequest(
      filled({ inputPrice: '3', outputPrice: '15', monthlyCap: '25.5' }),
      undefined,
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.request.pricing).toEqual({
        inputPerMillionUsd: 3,
        outputPerMillionUsd: 15,
        multiplier: 1,
        minPerRequestUsd: 0,
      });
      expect(result.request.monthlyCapUsd).toBe(25.5);
    }
  });

  it('refuses a limit without both prices, and numbers that are not numbers', () => {
    const noPrices = buildProviderRequest(filled({ monthlyCap: '10' }), undefined);
    expect(noPrices).toMatchObject({ ok: false });
    if (!noPrices.ok) expect(noPrices.errors.monthlyCap).toMatch(/both prices/);
    const half = buildProviderRequest(filled({ inputPrice: '3' }), undefined);
    expect(half).toMatchObject({ ok: false });
    for (const [field, value] of [
      ['inputPrice', 'abc'],
      ['outputPrice', '-1'],
      ['multiplier', '0'],
      ['multiplier', '101'],
      ['minPerRequest', '11'],
      ['monthlyCap', '1e3'],
    ] as const) {
      const extra = { inputPrice: '3', outputPrice: '15', [field]: value };
      const result = buildProviderRequest(filled(extra), undefined);
      expect(result.ok, `${field}=${value}`).toBe(false);
    }
  });

  it('trims the key and the model', () => {
    const result = buildProviderRequest(
      filled({ model: '  vendor/m  ', apiKey: '  sk-or-v1-abcdef123456  ' }),
      undefined,
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.request).toMatchObject({ model: 'vendor/m', apiKey: 'sk-or-v1-abcdef123456' });
  });
});
