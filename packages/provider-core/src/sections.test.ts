import { describe, expect, it } from 'vitest';

import { isSectionName, SECTION_LIMITS, SECTION_NAMES, type DraftSections } from './sections.js';

describe('SECTION_NAMES', () => {
  it('lists exactly the keys of a draft, in display order', () => {
    const sample: DraftSections = {
      title: 't',
      hook: 'h',
      script: 's',
      storyboard: ['a'],
      caption: 'c',
      hashtags: ['#a'],
      callToAction: 'cta',
    };
    expect([...SECTION_NAMES].sort()).toEqual(Object.keys(sample).sort());
    expect(SECTION_NAMES[0]).toBe('title');
    expect(SECTION_NAMES[6]).toBe('callToAction');
  });

  it('recognises only section names', () => {
    expect(isSectionName('hook')).toBe(true);
    expect(isSectionName('description')).toBe(false);
  });

  it('has the documented limits', () => {
    expect(SECTION_LIMITS).toMatchObject({
      title: 100,
      hook: 200,
      script: 1500,
      caption: 2200,
      callToAction: 200,
      storyboardScene: 300,
      storyboardScenes: { min: 1, max: 12 },
      hashtags: { max: 30, length: 50 },
    });
  });
});
