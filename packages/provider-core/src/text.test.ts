import { describe, expect, it } from 'vitest';

import { graphemeLength, normalizeNfc, truncateGraphemes } from './text.js';

const THAI_CLUSTER = 'ที่'; // ท + ี (vowel) + ่ (tone mark)
const FAMILY_EMOJI = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // ZWJ sequence, one cluster

describe('graphemeLength', () => {
  it('counts a Thai base with a vowel and tone mark as one cluster', () => {
    expect(THAI_CLUSTER.length).toBe(3);
    expect(graphemeLength(THAI_CLUSTER)).toBe(1);
  });

  it('counts Thai text by cluster rather than code point', () => {
    expect(graphemeLength('สวัสดี')).toBe(4);
  });

  it('counts a ZWJ emoji sequence as one', () => {
    expect(graphemeLength(FAMILY_EMOJI)).toBe(1);
  });

  it('counts NFD and NFC spellings of the same text equally', () => {
    expect(graphemeLength('é')).toBe(1);
    expect(graphemeLength('é')).toBe(1);
  });

  it('returns 0 for an empty string', () => {
    expect(graphemeLength('')).toBe(0);
  });
});

describe('truncateGraphemes', () => {
  it('keeps whole Thai clusters when cutting', () => {
    expect(truncateGraphemes('ที่ดีมาก', 2)).toBe('ที่ดี');
  });

  it('never splits a ZWJ emoji sequence', () => {
    expect(truncateGraphemes(`${FAMILY_EMOJI}a`, 1)).toBe(FAMILY_EMOJI);
  });

  it('returns NFC output', () => {
    expect(truncateGraphemes('éx', 1)).toBe('é');
  });

  it('returns the input unchanged when it is already within the limit', () => {
    expect(truncateGraphemes('สวัสดี', 10)).toBe('สวัสดี');
  });

  it('returns an empty string for a zero limit', () => {
    expect(truncateGraphemes('สวัสดี', 0)).toBe('');
  });

  it('rejects a negative or fractional limit', () => {
    expect(() => truncateGraphemes('abc', -1)).toThrow(RangeError);
    expect(() => truncateGraphemes('abc', 1.5)).toThrow(RangeError);
  });
});

describe('normalizeNfc', () => {
  it('composes decomposed characters', () => {
    expect(normalizeNfc('é')).toBe('é');
  });
});
