import { afterEach, describe, expect, it, vi } from 'vitest';

import { guardDraft } from './claim-guard.js';
import { isProviderError, ProviderError } from './errors.js';
import { MOCK_MODEL_ID, MOCK_PROVIDER_ID, MockTextProvider } from './mock.js';
import { SECTION_NAMES, type DraftSections, type SectionName } from './sections.js';
import { graphemeLength } from './text.js';
import type {
  GenerateBriefRequest,
  ProductFacts,
  RegenerateSectionRequest,
  TextProvider,
} from './types.js';
import { validateDraftSections, validateSectionValue } from './validate-output.js';

const THAI = /[฀-๿]/u;

const thaiProduct: ProductFacts = {
  name: 'พัดลมตั้งโต๊ะ Breeze',
  description: 'พัดลมขนาด 8 นิ้ว',
  priceAmount: '590',
  currency: 'THB',
  sellingPoints: ['ปรับลมได้ 3 ระดับ', 'เสียงเบา'],
  targetAudience: 'นักศึกษาและพนักงานออฟฟิศ',
  brandTone: 'สดใส เป็นกันเอง',
  restrictedClaims: [],
};

const englishProduct: ProductFacts = {
  name: 'Desk Fan Breeze',
  description: '8-inch desk fan',
  priceAmount: '590',
  currency: 'THB',
  sellingPoints: ['Three speed levels', 'Quiet motor'],
  targetAudience: 'students and office workers',
  brandTone: 'bright and friendly',
  restrictedClaims: [],
};

const brief = (overrides: Partial<GenerateBriefRequest> = {}): GenerateBriefRequest => ({
  template: { id: 'product-showcase', version: 1 },
  language: 'th',
  tone: null,
  platform: 'tiktok',
  durationSeconds: 30,
  variantIndex: 0,
  product: thaiProduct,
  ...overrides,
});

const withProduct = (product: Partial<ProductFacts>): GenerateBriefRequest =>
  brief({ product: { ...thaiProduct, ...product } });

const provider = new MockTextProvider();

async function draftOf(req: GenerateBriefRequest): Promise<DraftSections> {
  return (await provider.generateBrief(req)).output;
}

async function regenerationOf(
  req: GenerateBriefRequest,
  section: SectionName,
): Promise<RegenerateSectionRequest> {
  const { output } = await provider.generateBrief(req);
  return { ...req, section, current: output };
}

async function errorOf(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (isProviderError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ProviderError');
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Contract every TextProvider adapter must pass. Any future adapter runs this same suite. */
function describeTextProviderContract(name: string, factory: () => TextProvider): void {
  describe(`TextProvider contract: ${name}`, () => {
    it('returns sections that pass validation', async () => {
      const result = await factory().generateBrief(brief());
      expect(() => validateDraftSections(result.output)).not.toThrow();
      expect(result.model.length).toBeGreaterThan(0);
      expect(result.usage.inputUnits).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputUnits).toBeGreaterThanOrEqual(0);
    });

    it('regenerates each section into a validated value', async () => {
      const adapter = factory();
      const base = await adapter.generateBrief(brief());
      for (const section of SECTION_NAMES) {
        const result = await adapter.regenerateSection({
          ...brief(),
          section,
          current: base.output,
        });
        expect(result.section).toBe(section);
        expect(() => validateSectionValue(section, result.value), section).not.toThrow();
      }
    });

    it('throws only ProviderError', async () => {
      const adapter = factory();
      const scenarios: GenerateBriefRequest[] = [
        brief(),
        brief({ template: { id: 'unknown', version: 9 } }),
        withProduct({ name: '[[mock:timeout]]' }),
        withProduct({ name: '[[mock:5xx]]' }),
        withProduct({ name: '[[mock:rate-limited]]' }),
        withProduct({ name: '[[mock:refused]]' }),
      ];
      for (const req of scenarios) {
        try {
          await adapter.generateBrief(req);
        } catch (error) {
          expect(isProviderError(error), String(error)).toBe(true);
        }
      }
    });

    it('honors an aborted signal with TIMEOUT', async () => {
      const controller = new AbortController();
      controller.abort();
      const error = await errorOf(factory().generateBrief(brief(), { signal: controller.signal }));
      expect(error.code).toBe('TIMEOUT');
    });

    it('is deterministic for identical input', async () => {
      const adapter = factory();
      const first = await adapter.generateBrief(brief());
      const second = await adapter.generateBrief(brief());
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  });
}

describeTextProviderContract('MockTextProvider', () => new MockTextProvider());

describe('MockTextProvider identity', () => {
  it('exposes the mock id and model', async () => {
    expect(provider.id).toBe(MOCK_PROVIDER_ID);
    expect(MOCK_PROVIDER_ID).toBe('mock-text');
    const result = await provider.generateBrief(brief());
    expect(result.model).toBe(MOCK_MODEL_ID);
    expect(MOCK_MODEL_ID).toBe('mock-text-1');
  });
});

describe('MockTextProvider output', () => {
  it('is deterministic for the same request', async () => {
    const first = await provider.generateBrief(brief());
    const second = await provider.generateBrief(brief());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('uses no randomness and no clock', async () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    await provider.generateBrief(brief());
    await provider.regenerateSection({
      ...brief(),
      section: 'hook',
      current: await draftOf(brief()),
    });
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('writes Thai into a Thai brief and no Thai into an English brief', async () => {
    const thai = await draftOf(brief());
    expect(THAI.test(JSON.stringify(thai))).toBe(true);

    const english = await draftOf(brief({ language: 'en', product: englishProduct }));
    expect(THAI.test(JSON.stringify(english))).toBe(false);
  });

  it('returns only NFC strings', async () => {
    const output = await draftOf(
      brief({ product: { ...englishProduct, sellingPoints: ['café latte blend'] } }),
    );
    for (const value of Object.values(output).flat()) {
      expect(value).toBe(value.normalize('NFC'));
    }
    expect(JSON.stringify(output)).toContain('café');
  });

  it('uses selling points verbatim and invents none', async () => {
    const output = await draftOf(brief());
    const text = JSON.stringify(output);
    expect(text).toContain('ปรับลมได้ 3 ระดับ');
    expect(text).toContain('เสียงเบา');
    expect(text).toContain('590 THB');
  });

  it('produces 3 to 5 storyboard scenes and 3 to 6 hashtags', async () => {
    for (const durationSeconds of [5, 30, 60, 180]) {
      const output = await draftOf(brief({ durationSeconds }));
      expect(output.storyboard.length, `${durationSeconds}s`).toBeGreaterThanOrEqual(3);
      expect(output.storyboard.length, `${durationSeconds}s`).toBeLessThanOrEqual(5);
      expect(output.hashtags.length).toBeGreaterThanOrEqual(3);
      expect(output.hashtags.length).toBeLessThanOrEqual(6);
      for (const tag of output.hashtags) {
        expect(tag.startsWith('#')).toBe(true);
      }
    }
  });

  it('scales script length with duration and keeps it within the limit', async () => {
    const lengths = await Promise.all(
      [15, 60, 120, 600].map(async (durationSeconds) =>
        graphemeLength((await draftOf(brief({ durationSeconds }))).script),
      ),
    );
    expect(lengths[0]).toBeLessThan(lengths[1] ?? 0);
    expect(lengths[1]).toBeLessThan(lengths[2] ?? 0);
    for (const length of lengths) {
      expect(length).toBeLessThanOrEqual(1500);
    }
  });

  it('produces a sensible brief with zero selling points and null optional fields', async () => {
    const output = await draftOf(
      withProduct({
        sellingPoints: [],
        description: null,
        priceAmount: null,
        currency: null,
        targetAudience: null,
        brandTone: null,
      }),
    );
    expect(() => validateDraftSections(output)).not.toThrow();
    expect(output.title).toContain('พัดลมตั้งโต๊ะ Breeze');
    expect(output.script.length).toBeGreaterThan(0);
  });

  it('stays within limits for a long Thai-heavy name and long selling points', async () => {
    const output = await draftOf(
      withProduct({
        name: 'ที่'.repeat(150),
        sellingPoints: Array.from({ length: 20 }, () => 'ที่'.repeat(100)),
      }),
    );
    expect(() => validateDraftSections(output)).not.toThrow();
    expect(graphemeLength(output.title)).toBeLessThanOrEqual(100);
    expect(graphemeLength(output.script)).toBeLessThanOrEqual(1500);
  });

  it('never splits a grapheme cluster when truncating a long name', async () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const output = await draftOf(withProduct({ name: family.repeat(80) }));
    expect(output.title.startsWith(family)).toBe(true);
    expect(() => validateDraftSections(output)).not.toThrow();
  });

  it('makes each variant index produce different wording', async () => {
    const outputs = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((variantIndex) => draftOf(brief({ variantIndex }))),
    );
    const keys = new Set(outputs.map((output) => JSON.stringify(output)));
    expect(keys.size).toBe(6);
    const titles = new Set(outputs.map((output) => output.title));
    expect(titles.size).toBe(6);
  });

  it('lets the template change the wording', async () => {
    const showcase = await draftOf(brief({ template: { id: 'product-showcase', version: 1 } }));
    const problem = await draftOf(brief({ template: { id: 'problem-solution', version: 1 } }));
    expect(showcase.hook).not.toBe(problem.hook);
  });

  it('keeps the same concrete facts for both languages', async () => {
    const english = await draftOf(brief({ language: 'en', product: englishProduct }));
    expect(JSON.stringify(english)).toContain('Three speed levels');
    expect(JSON.stringify(english)).toContain('590 THB');
  });

  it('produces no risky claims for a neutral product', async () => {
    const output = await draftOf(brief({ language: 'en', product: englishProduct }));
    expect(guardDraft(output, englishProduct).needsReview).toBe(false);
    const thai = await draftOf(brief());
    expect(guardDraft(thai, thaiProduct).needsReview).toBe(false);
  });

  it('strips fault markers from user text in successful output', async () => {
    const output = await draftOf(
      withProduct({
        description: 'มี [[mock:refused]] ในคำอธิบาย',
        sellingPoints: ['จุดเด่น [[mock:5xx]] หนึ่ง'],
      }),
    );
    expect(JSON.stringify(output)).not.toContain('[[mock:');
  });

  it('reports usage in graphemes', async () => {
    const req = brief();
    const { usage } = await provider.generateBrief(req);
    expect(usage.inputUnits).toBe(graphemeLength(JSON.stringify(req)));
    expect(usage.outputUnits).toBeGreaterThan(0);
  });

  it('rejects an unknown template id or version with INVALID_REQUEST', async () => {
    for (const template of [
      { id: 'unknown', version: 1 },
      { id: 'product-showcase', version: 2 },
    ]) {
      const error = await errorOf(provider.generateBrief(brief({ template })));
      expect(error.code).toBe('INVALID_REQUEST');
      expect(error.retryable).toBe(false);
    }
  });

  it('rejects an empty product name with INVALID_REQUEST', async () => {
    const error = await errorOf(provider.generateBrief(withProduct({ name: '   ' })));
    expect(error.code).toBe('INVALID_REQUEST');
  });

  it('rejects an out-of-range duration or variant index with INVALID_REQUEST', async () => {
    for (const req of [
      brief({ durationSeconds: 0 }),
      brief({ durationSeconds: 1.5 }),
      brief({ variantIndex: -1 }),
    ]) {
      const error = await errorOf(provider.generateBrief(req));
      expect(error.code).toBe('INVALID_REQUEST');
    }
  });

  it('honors an aborted signal with TIMEOUT', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await errorOf(provider.generateBrief(brief(), { signal: controller.signal }));
    expect(error.code).toBe('TIMEOUT');
    expect(error.retryable).toBe(true);
  });
});

describe('MockTextProvider fault injection', () => {
  it('raises TIMEOUT for [[mock:timeout]]', async () => {
    const error = await errorOf(provider.generateBrief(withProduct({ name: '[[mock:timeout]]' })));
    expect(error.code).toBe('TIMEOUT');
    expect(error.retryable).toBe(true);
  });

  it('raises UPSTREAM_5XX for [[mock:5xx]]', async () => {
    const error = await errorOf(provider.generateBrief(withProduct({ name: '[[mock:5xx]]' })));
    expect(error.code).toBe('UPSTREAM_5XX');
    expect(error.retryable).toBe(true);
  });

  it('raises RATE_LIMITED with retryAfterMs 2000 for [[mock:rate-limited]]', async () => {
    const error = await errorOf(
      provider.generateBrief(withProduct({ name: '[[mock:rate-limited]]' })),
    );
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2000);
  });

  it('raises CONTENT_REFUSED for [[mock:refused]]', async () => {
    const error = await errorOf(provider.generateBrief(withProduct({ name: '[[mock:refused]]' })));
    expect(error.code).toBe('CONTENT_REFUSED');
    expect(error.retryable).toBe(false);
  });

  it('returns output that validation rejects for [[mock:invalid-output]]', async () => {
    const result = await provider.generateBrief(withProduct({ name: '[[mock:invalid-output]]' }));
    expect(result.output.title).toBe('');
    let rejected: unknown;
    try {
      validateDraftSections(result.output);
    } catch (error) {
      rejected = error;
    }
    expect(isProviderError(rejected)).toBe(true);
    expect((rejected as ProviderError).code).toBe('INVALID_OUTPUT');
  });

  it('applies the same faults to regenerateSection', async () => {
    const base = await draftOf(brief());
    const timeout = await errorOf(
      provider.regenerateSection({
        ...brief({ product: { ...thaiProduct, name: '[[mock:timeout]]' } }),
        section: 'hook',
        current: base,
      }),
    );
    expect(timeout.code).toBe('TIMEOUT');

    const invalid = await provider.regenerateSection({
      ...brief({ product: { ...thaiProduct, name: '[[mock:invalid-output]]' } }),
      section: 'storyboard',
      current: base,
    });
    expect(() => validateSectionValue('storyboard', invalid.value)).toThrow(ProviderError);
  });
});

describe('MockTextProvider regenerateSection', () => {
  it('returns only the requested section, as a new value', async () => {
    for (const section of SECTION_NAMES) {
      const req = await regenerationOf(brief(), section);
      const result = await provider.regenerateSection(req);
      expect(result.section).toBe(section);
      expect(Object.keys(result).sort()).toEqual(['model', 'section', 'usage', 'value']);
      expect(JSON.stringify(result.value), section).not.toBe(JSON.stringify(req.current[section]));
      expect(() => validateSectionValue(section, result.value), section).not.toThrow();
    }
  });

  it('is deterministic for identical input', async () => {
    const req = await regenerationOf(brief(), 'caption');
    const first = await provider.regenerateSection(req);
    const second = await provider.regenerateSection(req);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('rejects a current draft that fails validation with INVALID_REQUEST', async () => {
    const error = await errorOf(
      provider.regenerateSection({
        ...brief(),
        section: 'hook',
        current: { ...(await draftOf(brief())), title: '' },
      }),
    );
    expect(error.code).toBe('INVALID_REQUEST');
  });

  it('reports usage in graphemes', async () => {
    const req = await regenerationOf(brief(), 'hook');
    const result = await provider.regenerateSection(req);
    expect(result.usage.inputUnits).toBe(graphemeLength(JSON.stringify(req)));
    expect(result.usage.outputUnits).toBeGreaterThan(0);
  });
});
