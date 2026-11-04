import { describe, expect, it } from 'vitest';

import { getTemplate, listTemplates, TEMPLATES } from './templates.js';

const THAI = /[฀-๿]/u;

describe('templates', () => {
  it('defines the three version-1 templates', () => {
    expect(listTemplates().map((t) => [t.id, t.version])).toEqual([
      ['product-showcase', 1],
      ['problem-solution', 1],
      ['review-style', 1],
    ]);
  });

  it('uses real Thai names for the Thai copy', () => {
    expect(getTemplate('product-showcase', 1)?.name.th).toBe('โชว์สินค้า');
    expect(getTemplate('problem-solution', 1)?.name.th).toBe('ปัญหาและทางออก');
    expect(getTemplate('review-style', 1)?.name.th).toBe('รีวิวสไตล์ผู้ใช้จริง');
  });

  it('keeps Thai text out of the English copy and puts Thai in the Thai copy', () => {
    for (const template of TEMPLATES) {
      expect(THAI.test(template.name.th), template.id).toBe(true);
      expect(THAI.test(template.name.en), template.id).toBe(false);
      expect(THAI.test(template.description.en), template.id).toBe(false);
      expect(template.defaultDurationSeconds).toBeGreaterThan(0);
    }
  });

  it('looks templates up by id and version', () => {
    expect(getTemplate('review-style', 1)?.id).toBe('review-style');
  });

  it('returns undefined for an unknown id or version', () => {
    expect(getTemplate('unknown', 1)).toBeUndefined();
    expect(getTemplate('product-showcase', 2)).toBeUndefined();
  });
});
