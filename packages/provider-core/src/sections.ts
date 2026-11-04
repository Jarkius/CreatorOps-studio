/** Every section of a generated draft, in display order. */
export const SECTION_NAMES = [
  'title',
  'hook',
  'script',
  'storyboard',
  'caption',
  'hashtags',
  'callToAction',
] as const;

export type SectionName = (typeof SECTION_NAMES)[number];

export function isSectionName(value: string): value is SectionName {
  return (SECTION_NAMES as readonly string[]).includes(value);
}

export interface DraftSections {
  title: string;
  hook: string;
  script: string;
  storyboard: string[];
  caption: string;
  hashtags: string[];
  callToAction: string;
}

export type SectionValue = string | string[];

/** Limits are counted in grapheme clusters, never in UTF-16 code units. */
export const SECTION_LIMITS = {
  title: 100,
  hook: 200,
  script: 1500,
  caption: 2200,
  callToAction: 200,
  storyboardScene: 300,
  storyboardScenes: { min: 1, max: 12 },
  hashtags: { max: 30, length: 50 },
} as const;
