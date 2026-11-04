import { describe, expect, it } from 'vitest';

import { guardDraft } from './claim-guard.js';
import { MockTextProvider } from './mock.js';
import type { DraftSections } from './sections.js';
import type { ProductFacts } from './types.js';

const draft = (overrides: Partial<DraftSections> = {}): DraftSections => ({
  title: 'พัดลมตั้งโต๊ะ',
  hook: 'มาดูกัน',
  script: 'ลมแรงและเงียบ',
  storyboard: ['ฉาก 1: โชว์สินค้า'],
  caption: 'คำบรรยายธรรมดา',
  hashtags: ['#พัดลม'],
  callToAction: 'กดดูรายละเอียด',
  ...overrides,
});

const product = (overrides: Partial<ProductFacts> = {}): ProductFacts => ({
  name: 'พัดลมตั้งโต๊ะ',
  description: null,
  priceAmount: null,
  currency: null,
  sellingPoints: [],
  targetAudience: null,
  brandTone: null,
  restrictedClaims: [],
  ...overrides,
});

describe('guardDraft restricted claims', () => {
  it('matches a restricted claim case-insensitively and reports the claim', () => {
    const result = guardDraft(
      draft({ hook: 'ลดน้ำหนักได้ไวมาก' }),
      product({ restrictedClaims: ['ลดน้ำหนัก'] }),
    );
    expect(result.claimWarnings).toEqual([
      { section: 'hook', kind: 'restricted_claim', text: 'ลดน้ำหนัก' },
    ]);
    expect(result.needsReview).toBe(true);

    const english = guardDraft(
      draft({ caption: 'This will LOSE WEIGHT fast' }),
      product({ restrictedClaims: ['lose weight'] }),
    );
    expect(english.claimWarnings.map((w) => w.kind)).toEqual(['restricted_claim']);
  });

  it('checks hashtags and storyboard scenes too', () => {
    const result = guardDraft(
      draft({ hashtags: ['#ผอมไว'], storyboard: ['ฉาก 1: ผอม'] }),
      product({ restrictedClaims: ['ผอม'] }),
    );
    expect(result.claimWarnings.map((w) => w.section)).toEqual(['storyboard', 'hashtags']);
  });

  it('reports one warning per section per claim, even when several scenes match', () => {
    const result = guardDraft(
      draft({ storyboard: ['ฉาก 1: ผอม', 'ฉาก 2: ผอม อีกครั้ง'] }),
      product({ restrictedClaims: ['ผอม'] }),
    );
    expect(result.claimWarnings.filter((w) => w.section === 'storyboard')).toHaveLength(1);
  });

  it('ignores empty and whitespace-only restricted entries', () => {
    const result = guardDraft(draft(), product({ restrictedClaims: ['', '   '] }));
    expect(result.claimWarnings).toEqual([]);
    expect(result.needsReview).toBe(false);
  });
});

describe('guardDraft unsupported claims', () => {
  it('flags 100% when the facts do not contain it', () => {
    const result = guardDraft(draft({ caption: 'ได้ผลถึง 100% ทุกคน.' }), product());
    expect(result.claimWarnings).toEqual([
      { section: 'caption', kind: 'unsupported_claim', text: 'ได้ผลถึง 100% ทุกคน' },
    ]);
    expect(result.needsReview).toBe(true);
  });

  it('does not flag 100% when the description contains it', () => {
    const result = guardDraft(
      draft({ caption: 'ได้ผลถึง 100% ทุกคน' }),
      product({ description: 'ผลทดสอบ 100% ในห้องทดลอง' }),
    );
    expect(result.claimWarnings).toEqual([]);
  });

  it('treats 50 % and 50% as the same percentage', () => {
    const flagged = guardDraft(draft({ hook: 'ลดได้ 50 %' }), product());
    expect(flagged.claimWarnings).toHaveLength(1);

    const supported = guardDraft(
      draft({ hook: 'ลดได้ 50 %' }),
      product({ sellingPoints: ['ลดได้ 50%'] }),
    );
    expect(supported.claimWarnings).toEqual([]);
  });

  it('flags Thai risky phrases such as ดีที่สุด unless the facts contain them', () => {
    const flagged = guardDraft(draft({ script: 'นี่คือพัดลมที่ดีที่สุด' }), product());
    expect(flagged.claimWarnings.map((w) => w.text)).toEqual(['นี่คือพัดลมที่ดีที่สุด']);

    const supported = guardDraft(
      draft({ script: 'นี่คือพัดลมที่ดีที่สุด' }),
      product({ sellingPoints: ['พัดลมที่ดีที่สุดในงบนี้'] }),
    );
    expect(supported.claimWarnings).toEqual([]);
  });

  it('flags English risky phrases as whole words', () => {
    const result = guardDraft(draft({ caption: 'The best fan. Guaranteed cool air.' }), product());
    expect(result.claimWarnings.map((w) => w.text)).toEqual([
      'The best fan',
      'Guaranteed cool air',
    ]);

    const benign = guardDraft(draft({ caption: 'A secure, quiet fan.' }), product());
    expect(benign.claimWarnings).toEqual([]);
  });

  it('does not split a decimal number into separate segments', () => {
    const result = guardDraft(draft({ caption: 'Lowers noise by 99.5% in tests' }), product());
    expect(result.claimWarnings.map((w) => w.text)).toEqual(['Lowers noise by 99.5% in tests']);
  });

  it('caps the reported segment at 200 graphemes', () => {
    const long = `${'a'.repeat(250)} guaranteed`;
    const result = guardDraft(draft({ caption: long }), product());
    expect(result.claimWarnings).toHaveLength(1);
    expect([...(result.claimWarnings[0]?.text ?? '')].length).toBeLessThanOrEqual(200);
  });

  it('deduplicates identical warnings', () => {
    const result = guardDraft(
      draft({ storyboard: ['ฉาก 1: ที่สุดในตลาด', 'ฉาก 1: ที่สุดในตลาด'] }),
      product(),
    );
    expect(result.claimWarnings).toHaveLength(1);
  });

  it('reports no warnings for a neutral draft', () => {
    const result = guardDraft(draft(), product({ description: 'พัดลมตั้งโต๊ะ' }));
    expect(result).toEqual({ claimWarnings: [], needsReview: false });
  });
});

describe('guardDraft purity', () => {
  it('never modifies the sections', () => {
    const sections = draft({
      caption: 'ได้ผลถึง 100% ทุกคน',
      storyboard: ['ฉาก 1: ผอม'],
    });
    const before = structuredClone(sections);
    guardDraft(sections, product({ restrictedClaims: ['ผอม'] }));
    expect(sections).toEqual(before);
  });
});

describe('guardDraft case handling and mock output', () => {
  it('matches an upper-case restricted claim against lower-case draft text', () => {
    const result = guardDraft(
      draft({ caption: 'this will cure everything' }),
      product({ restrictedClaims: ['CURE'] }),
    );
    expect(result.claimWarnings).toContainEqual({
      section: 'caption',
      kind: 'restricted_claim',
      text: 'CURE',
    });
  });

  it('never flags the mock provider output for ordinary products, in both languages', async () => {
    const provider = new MockTextProvider();
    const products = [
      product({ sellingPoints: ['ชาร์จผ่าน USB-C', 'น้ำหนักเบา'], description: 'พัดลมพกพา' }),
      product({ name: 'Canvas tote bag', sellingPoints: [] }),
      product({ name: 'โคมไฟ LED', priceAmount: '590', currency: 'THB' }),
    ];
    for (const language of ['th', 'en'] as const) {
      for (const facts of products) {
        for (const variantIndex of [0, 1, 2]) {
          const { output } = await provider.generateBrief({
            template: { id: 'product-showcase', version: 1 },
            language,
            tone: null,
            platform: 'generic',
            durationSeconds: 30,
            variantIndex,
            product: facts,
          });
          expect(guardDraft(output, facts).claimWarnings).toEqual([]);
        }
      }
    }
  });
});
