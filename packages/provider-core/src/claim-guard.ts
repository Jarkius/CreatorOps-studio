import { SECTION_NAMES, type DraftSections, type SectionName } from './sections.js';
import { normalizeNfc, truncateGraphemes } from './text.js';
import type { ProductFacts } from './types.js';

export interface ClaimWarning {
  section: SectionName;
  kind: 'restricted_claim' | 'unsupported_claim';
  text: string;
}

export interface ClaimGuardResult {
  claimWarnings: ClaimWarning[];
  needsReview: boolean;
}

const MAX_SEGMENT_GRAPHEMES = 200;

/** A dot is a break unless it sits between two digits (so "99.5%" stays whole). */
const SENTENCE_BREAK = /(?<!\d)\.|\.(?!\d)|[\n!?。]/u;

/** Risky phrases. Thai terms match as substrings; English terms match whole words. */
const RISKY_PATTERN =
  /รับประกัน|การันตี|ดีที่สุด|ที่สุด|หายขาด|ไม่มีผลข้างเคียง|\bguaranteed\b|\bbest\b|\bcure\b|\bno\s+side\s+effects\b|\bclinically\s+proven\b|\d+(?:\.\d+)?\s*%/giu;

/** Whitespace-insensitive and case-insensitive, so "50 %" matches "50%". */
const compact = (text: string): string => text.toLowerCase().replace(/\s+/gu, '');

function sectionTexts(sections: DraftSections, section: SectionName): string[] {
  const value = sections[section];
  return Array.isArray(value) ? value : [value];
}

/**
 * Flags restricted claims and unsupported risky claims in a draft.
 * Pure: reads the sections and never modifies them.
 */
export function guardDraft(sections: DraftSections, product: ProductFacts): ClaimGuardResult {
  const claimWarnings: ClaimWarning[] = [];
  const seen = new Set<string>();
  const add = (warning: ClaimWarning): void => {
    const key = JSON.stringify([warning.section, warning.kind, warning.text]);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    claimWarnings.push(warning);
  };

  const claims = product.restrictedClaims
    .map((claim) => normalizeNfc(claim).trim())
    .filter((claim) => claim.length > 0);
  const supportText = compact(
    normalizeNfc([product.description ?? '', ...product.sellingPoints].join('\n')),
  );

  for (const section of SECTION_NAMES) {
    const texts = sectionTexts(sections, section).map((text) => normalizeNfc(text));

    for (const claim of claims) {
      const needle = claim.toLowerCase();
      if (texts.some((text) => text.toLowerCase().includes(needle))) {
        add({ section, kind: 'restricted_claim', text: claim });
      }
    }

    for (const text of texts) {
      for (const segment of text.split(SENTENCE_BREAK)) {
        const trimmed = segment.trim();
        if (trimmed === '') {
          continue;
        }
        const risky = Array.from(trimmed.matchAll(RISKY_PATTERN), (match) => match[0]);
        if (risky.some((term) => !supportText.includes(compact(term)))) {
          add({
            section,
            kind: 'unsupported_claim',
            text: truncateGraphemes(trimmed, MAX_SEGMENT_GRAPHEMES),
          });
        }
      }
    }
  }

  return { claimWarnings, needsReview: claimWarnings.length > 0 };
}
