import { describe, expect, it } from 'vitest';

import { approvalNote, captionForPost, formatSize, isDownloadable } from './exportText.js';
import { makeScreenDraft } from './draftScreenTestSetup.js';

describe('exportText', () => {
  it('joins caption and hashtags, or gives the caption alone when there are no tags', () => {
    const sections = makeScreenDraft().sections;
    expect(captionForPost(sections)).toBe(`${sections.caption}\n\n#พัดลม #DeskFan`);
    expect(captionForPost({ ...sections, hashtags: [] })).toBe(sections.caption);
  });

  it('formats sizes', () => {
    expect(formatSize(10)).toBe('10 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('notes an unapproved draft only', () => {
    expect(approvalNote('approved')).toBeNull();
    expect(approvalNote('in_review')).not.toBeNull();
    expect(approvalNote('draft')).not.toBeNull();
  });

  it('allows a download only for a ready package that has not run out', () => {
    const base = { status: 'ready', expiresAt: '2030-01-01T00:00:00.000Z' } as never;
    const now = Date.parse('2029-12-31T00:00:00.000Z');
    expect(isDownloadable(base, now)).toBe(true);
    expect(isDownloadable({ ...(base as object), status: 'expired' } as never, now)).toBe(false);
    expect(isDownloadable(base, Date.parse('2030-01-01T00:00:00.000Z'))).toBe(false);
  });
});
