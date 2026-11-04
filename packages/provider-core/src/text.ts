const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function normalizeNfc(value: string): string {
  return value.normalize('NFC');
}

function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(normalizeNfc(value)), (part) => part.segment);
}

/** Number of user-perceived characters (grapheme clusters), after NFC normalisation. */
export function graphemeLength(value: string): number {
  return graphemes(value).length;
}

/** The first `max` grapheme clusters of `value`, returned in NFC. Never splits a cluster. */
export function truncateGraphemes(value: string, max: number): string {
  if (!Number.isInteger(max) || max < 0) {
    throw new RangeError('max must be a non-negative integer');
  }
  return normalizeNfc(graphemes(value).slice(0, max).join(''));
}
