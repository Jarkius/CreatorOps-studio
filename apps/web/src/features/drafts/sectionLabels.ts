import type { ClaimWarningKind, SectionName } from '@creatorops/contracts';

/** Names shown to the user. The same text is the copy heading of each section. */
export const SECTION_LABELS: Record<SectionName, string> = {
  title: 'Title',
  hook: 'Hook',
  script: 'Script',
  storyboard: 'Storyboard',
  caption: 'Caption',
  hashtags: 'Hashtags',
  callToAction: 'Call to action',
};

export const CLAIM_KIND_LABELS: Record<ClaimWarningKind, string> = {
  restricted_claim: 'Restricted claim',
  unsupported_claim: 'Unsupported claim',
};
