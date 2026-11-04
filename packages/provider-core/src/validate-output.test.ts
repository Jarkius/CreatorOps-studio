import { describe, expect, it } from 'vitest';

import { isProviderError } from './errors.js';
import { SECTION_NAMES, type DraftSections, type SectionName } from './sections.js';
import { validateDraftSections, validateSectionValue } from './validate-output.js';

const validDraft = (): DraftSections => ({
  title: 'พัดลมตั้งโต๊ะ | โชว์สินค้า',
  hook: 'มาดูให้เห็นกับตา',
  script: 'บรรทัดแรก\nบรรทัดที่สอง',
  storyboard: ['ฉาก 1: เปิดภาพรวม', 'ฉาก 2: สาธิต'],
  caption: 'คำบรรยายสั้น ๆ',
  hashtags: ['#พัดลม', '#review'],
  callToAction: 'กดดูรายละเอียด',
});

function expectInvalid(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch (error) {
    expect(isProviderError(error), label).toBe(true);
    expect((error as { code: string }).code, label).toBe('INVALID_OUTPUT');
    return;
  }
  throw new Error(`expected INVALID_OUTPUT for: ${label}`);
}

describe('validateDraftSections', () => {
  it('accepts a valid draft and returns it unchanged', () => {
    expect(validateDraftSections(validDraft())).toEqual(validDraft());
  });

  it('returns trimmed NFC copies', () => {
    const result = validateDraftSections({
      ...validDraft(),
      title: '  é โชว์  ',
    });
    expect(result.title).toBe('é โชว์');
  });

  it('drops unknown extra fields', () => {
    const result = validateDraftSections({ ...validDraft(), extra: 'x' });
    expect(Object.keys(result).sort()).toEqual([...SECTION_NAMES].sort());
  });

  it('rejects non-object input', () => {
    for (const value of [null, undefined, 'text', 42, [], ['title']]) {
      expectInvalid(() => validateDraftSections(value), String(value));
    }
  });

  it('rejects a missing or non-string text field', () => {
    const withoutTitle: Partial<DraftSections> = validDraft();
    delete withoutTitle.title;
    expectInvalid(() => validateDraftSections(withoutTitle), 'missing title');
    expectInvalid(() => validateDraftSections({ ...validDraft(), hook: 5 }), 'numeric hook');
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), caption: ['x'] }),
      'array caption',
    );
  });

  it('rejects empty and whitespace-only text', () => {
    expectInvalid(() => validateDraftSections({ ...validDraft(), title: '' }), 'empty title');
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), script: '   \n  ' }),
      'blank script',
    );
  });

  it('counts limits in grapheme clusters, not code units', () => {
    const thaiCluster = 'ที่';
    expect(() =>
      validateDraftSections({ ...validDraft(), title: thaiCluster.repeat(100) }),
    ).not.toThrow();
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), title: thaiCluster.repeat(101) }),
      'title of 101 clusters',
    );
  });

  it('enforces the per-section text limits', () => {
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), hook: 'a'.repeat(201) }),
      'hook over 200',
    );
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), script: 'a'.repeat(1501) }),
      'script over 1500',
    );
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), caption: 'a'.repeat(2201) }),
      'caption over 2200',
    );
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), callToAction: 'a'.repeat(201) }),
      'cta over 200',
    );
  });

  it('requires 1 to 12 storyboard scenes of at most 300 graphemes', () => {
    expectInvalid(() => validateDraftSections({ ...validDraft(), storyboard: [] }), '0 scenes');
    expect(
      validateDraftSections({ ...validDraft(), storyboard: Array(12).fill('ฉาก') }).storyboard,
    ).toHaveLength(12);
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), storyboard: Array(13).fill('ฉาก') }),
      '13 scenes',
    );
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), storyboard: ['a'.repeat(301)] }),
      'scene of 301',
    );
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), storyboard: ['ok', '  '] }),
      'blank scene',
    );
  });

  it('allows 0 to 30 hashtags that start with #', () => {
    expect(validateDraftSections({ ...validDraft(), hashtags: [] }).hashtags).toEqual([]);
    const thirty = Array.from({ length: 30 }, (_unused, i) => `#tag${i}`);
    expect(validateDraftSections({ ...validDraft(), hashtags: thirty }).hashtags).toHaveLength(30);
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), hashtags: [...thirty, '#more'] }),
      '31 hashtags',
    );
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), hashtags: ['review'] }),
      'hashtag without #',
    );
    expectInvalid(() => validateDraftSections({ ...validDraft(), hashtags: ['#'] }), 'bare #');
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), hashtags: [`#${'a'.repeat(50)}`] }),
      'hashtag of 51 graphemes',
    );
  });

  it('rejects duplicate hashtags case-insensitively', () => {
    expectInvalid(
      () => validateDraftSections({ ...validDraft(), hashtags: ['#Fan', '#fan'] }),
      'case-insensitive duplicate',
    );
  });
});

describe('validateSectionValue', () => {
  it('validates each section with the same rules', () => {
    const draft = validDraft();
    for (const section of SECTION_NAMES) {
      expect(validateSectionValue(section, draft[section]), section).toEqual(draft[section]);
    }
  });

  it('rejects an invalid value for each section', () => {
    const invalidFor: Record<SectionName, unknown> = {
      title: '',
      hook: 'a'.repeat(201),
      script: 'a'.repeat(1501),
      storyboard: [],
      caption: 'a'.repeat(2201),
      hashtags: ['no-hash'],
      callToAction: '',
    };
    for (const section of SECTION_NAMES) {
      expectInvalid(() => validateSectionValue(section, invalidFor[section]), section);
    }
  });

  it('rejects a string where a list is required and a list where text is required', () => {
    expectInvalid(() => validateSectionValue('storyboard', 'ฉาก 1'), 'string storyboard');
    expectInvalid(() => validateSectionValue('title', ['ชื่อ']), 'list title');
  });
});
