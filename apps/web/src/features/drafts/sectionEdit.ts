import { CONTENT_LIMITS } from '@creatorops/contracts';
import type { DraftSections, SectionName } from '@creatorops/contracts';

export type SectionValue = DraftSections[SectionName];

export type ParsedSection = { ok: true; value: SectionValue } | { ok: false; message: string };

type TextSection = 'title' | 'hook' | 'script' | 'caption' | 'callToAction';

function fail(message: string): ParsedSection {
  return { ok: false, message };
}

function parseText(name: TextSection, text: string): ParsedSection {
  const value = text.trim();
  if (value.length === 0) return fail('Cannot be empty');
  const max = CONTENT_LIMITS.sections[name];
  if (value.length > max) return fail(`Too long (max ${max})`);
  return { ok: true, value };
}

function parseStoryboard(text: string): ParsedSection {
  const scenes = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (scenes.length === 0) return fail('Cannot be empty');
  const maxScenes = CONTENT_LIMITS.storyboard.max;
  if (scenes.length > maxScenes) return fail(`Too many scenes (max ${maxScenes})`);
  const maxScene = CONTENT_LIMITS.sections.scene;
  const long = scenes.findIndex((scene) => scene.length > maxScene);
  if (long !== -1) return fail(`Scene ${long + 1} is too long (max ${maxScene})`);
  return { ok: true, value: scenes };
}

/**
 * Hashtags are split on whitespace or commas. A token without `#` gets one. Empty tokens, and a
 * lone `#`, are dropped. An empty list is allowed.
 */
function parseHashtags(text: string): ParsedSection {
  const tags = text
    .split(/[\s,]+/)
    .filter((token) => token.length > 0)
    .map((token) => (token.startsWith('#') ? token : `#${token}`))
    .filter((tag) => tag !== '#');
  const maxCount = CONTENT_LIMITS.hashtags.count;
  if (tags.length > maxCount) return fail(`Too many hashtags (max ${maxCount})`);
  const maxLength = CONTENT_LIMITS.hashtags.length;
  const long = tags.findIndex((tag) => tag.length > maxLength);
  if (long !== -1) return fail(`Hashtag ${long + 1} is too long (max ${maxLength})`);
  return { ok: true, value: tags };
}

/** Turns the editor's text into a section value, or a message to show under the field. */
export function parseSectionText(name: SectionName, text: string): ParsedSection {
  switch (name) {
    case 'storyboard':
      return parseStoryboard(text);
    case 'hashtags':
      return parseHashtags(text);
    default:
      return parseText(name, text);
  }
}

/** The inverse of parseSectionText for the editor: one scene per line, hashtags space separated. */
export function toEditorText(name: SectionName, sections: DraftSections): string {
  switch (name) {
    case 'storyboard':
      return sections.storyboard.join('\n');
    case 'hashtags':
      return sections.hashtags.join(' ');
    default:
      return sections[name];
  }
}

/** True when two section values hold the same content (arrays compared in order). */
export function isSameSectionValue(a: SectionValue, b: SectionValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
