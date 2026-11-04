import type { DraftSections, SectionName } from '@creatorops/contracts';

import { SECTION_LABELS } from './sectionLabels.js';

/** The order of sections in a copied draft. */
export const COPY_ORDER: readonly SectionName[] = [
  'title',
  'hook',
  'script',
  'storyboard',
  'caption',
  'hashtags',
  'callToAction',
];

/**
 * The text of one section for the clipboard. Thai text is returned as stored: no trimming,
 * normalising or re-encoding. Storyboard scenes are numbered; hashtags are joined by one space.
 */
export function formatSectionForCopy(name: SectionName, sections: DraftSections): string {
  switch (name) {
    case 'storyboard':
      return sections.storyboard.map((scene, index) => `${index + 1}. ${scene}`).join('\n');
    case 'hashtags':
      return sections.hashtags.join(' ');
    default:
      return sections[name];
  }
}

/** The whole draft: each section's heading line, then its text, sections separated by a blank line. */
export function formatDraftForCopy(sections: DraftSections): string {
  return COPY_ORDER.map(
    (name) => `${SECTION_LABELS[name]}\n${formatSectionForCopy(name, sections)}`,
  ).join('\n\n');
}
