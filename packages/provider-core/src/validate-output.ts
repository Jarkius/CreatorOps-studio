import { ProviderError } from './errors.js';
import {
  SECTION_LIMITS,
  type DraftSections,
  type SectionName,
  type SectionValue,
} from './sections.js';
import { graphemeLength, normalizeNfc } from './text.js';

function invalid(): never {
  throw new ProviderError('INVALID_OUTPUT');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

/** NFC, trimmed, non-empty, and within `max` grapheme clusters. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const text = normalizeNfc(value).trim();
  if (text.length === 0 || graphemeLength(text) > max) {
    return invalid();
  }
  return text;
}

function cleanStoryboard(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return invalid();
  }
  const items: unknown[] = value;
  const { min, max } = SECTION_LIMITS.storyboardScenes;
  if (items.length < min || items.length > max) {
    return invalid();
  }
  return items.map((scene) => cleanText(scene, SECTION_LIMITS.storyboardScene));
}

function cleanHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return invalid();
  }
  const items: unknown[] = value;
  if (items.length > SECTION_LIMITS.hashtags.max) {
    return invalid();
  }
  const tags = items.map((item) => {
    const tag = cleanText(item, SECTION_LIMITS.hashtags.length);
    if (!tag.startsWith('#') || tag.length < 2) {
      return invalid();
    }
    return tag;
  });
  const seen = new Set<string>();
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      return invalid();
    }
    seen.add(key);
  }
  return tags;
}

/** Validates a complete draft. Throws ProviderError('INVALID_OUTPUT') on any violation. */
export function validateDraftSections(value: unknown): DraftSections {
  const record = asRecord(value);
  return {
    title: cleanText(record.title, SECTION_LIMITS.title),
    hook: cleanText(record.hook, SECTION_LIMITS.hook),
    script: cleanText(record.script, SECTION_LIMITS.script),
    storyboard: cleanStoryboard(record.storyboard),
    caption: cleanText(record.caption, SECTION_LIMITS.caption),
    hashtags: cleanHashtags(record.hashtags),
    callToAction: cleanText(record.callToAction, SECTION_LIMITS.callToAction),
  };
}

/** Validates one section with the same rules as validateDraftSections. */
export function validateSectionValue(section: SectionName, value: unknown): SectionValue {
  switch (section) {
    case 'storyboard':
      return cleanStoryboard(value);
    case 'hashtags':
      return cleanHashtags(value);
    case 'title':
      return cleanText(value, SECTION_LIMITS.title);
    case 'hook':
      return cleanText(value, SECTION_LIMITS.hook);
    case 'script':
      return cleanText(value, SECTION_LIMITS.script);
    case 'caption':
      return cleanText(value, SECTION_LIMITS.caption);
    case 'callToAction':
      return cleanText(value, SECTION_LIMITS.callToAction);
  }
}
