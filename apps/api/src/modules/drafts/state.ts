import {
  ClaimWarningSchema,
  DraftSectionsSchema,
  SECTION_NAMES,
  SectionStateSchema,
  type ClaimWarning,
  type DraftSections,
  type SectionName,
  type SectionState,
} from '@creatorops/contracts';
import { guardDraft, type ProductFacts } from '@creatorops/provider-core';
import { z } from 'zod';

import type { DraftRow } from './repo.js';

/** What a draft row holds, read back with the shared contract. Null when the row is damaged. */
export interface DraftContent {
  readonly sections: DraftSections;
  readonly sectionState: SectionState;
  readonly claimWarnings: ClaimWarning[];
}

export function readDraftContent(row: DraftRow): DraftContent | null {
  const sections = DraftSectionsSchema.safeParse(row.sections);
  const sectionState = SectionStateSchema.safeParse(row.sectionState);
  const claimWarnings = z.array(ClaimWarningSchema).safeParse(row.claimWarnings);
  if (!sections.success || !sectionState.success || !claimWarnings.success) return null;
  // A state without every section would break the revision guard, so it counts as damaged.
  if (!SECTION_NAMES.every((name) => sectionState.data[name] !== undefined)) return null;
  return {
    sections: sections.data,
    sectionState: sectionState.data,
    claimWarnings: claimWarnings.data,
  };
}

export interface ChangedDraft {
  readonly sections: DraftSections;
  readonly sectionState: SectionState;
  readonly claimWarnings: ClaimWarning[];
  readonly needsReview: boolean;
  /** Sections whose value really changed (a value equal to the stored one is not a change). */
  readonly changed: SectionName[];
}

/**
 * Applies new section values: each section whose value differs gets the next revision and the
 * given origin (D-050), the claim guard runs again over the whole draft (D-051). Pure.
 */
export function applySectionChanges(
  content: DraftContent,
  values: Readonly<Partial<DraftSections>>,
  origin: { readonly origin: 'generated' | 'edited'; readonly jobId: string | null },
  facts: ProductFacts,
): ChangedDraft {
  const sections: Record<string, unknown> = { ...content.sections };
  const sectionState: SectionState = { ...content.sectionState };
  const changed: SectionName[] = [];
  for (const name of SECTION_NAMES) {
    const next = values[name];
    if (next === undefined) continue;
    if (JSON.stringify(next) === JSON.stringify(content.sections[name])) continue;
    sections[name] = next;
    const previous = content.sectionState[name];
    sectionState[name] = { rev: (previous?.rev ?? 0) + 1, ...origin };
    changed.push(name);
  }
  const next = DraftSectionsSchema.parse(sections);
  const guard = guardDraft(next, facts);
  return {
    sections: next,
    sectionState,
    claimWarnings: guard.claimWarnings,
    needsReview: guard.needsReview,
    changed,
  };
}
