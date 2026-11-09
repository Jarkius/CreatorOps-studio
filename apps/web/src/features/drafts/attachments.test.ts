import { describe, expect, it } from 'vitest';

import type { DraftAsset } from '@creatorops/contracts';

import { buildAttachments } from './attachments.js';

const held = (assetId: string, extra: Partial<DraftAsset> = {}) =>
  ({
    assetId,
    role: 'media',
    sortOrder: 0,
    scene: null,
    aiGenerated: false,
    generator: null,
    ...extra,
  }) as DraftAsset;

describe('buildAttachments', () => {
  it('keeps order, scene and AI label of what stays, drops what was unticked, appends new files', () => {
    const current = [
      held('a', { scene: 'detail', aiGenerated: true, generator: 'Meta AI' }),
      held('b'),
      held('c', { scene: 'usage' }),
    ];
    expect(buildAttachments(current, ['c', 'new', 'a'], null)).toEqual([
      { assetId: 'a', role: 'media', aiGenerated: true, scene: 'detail', generator: 'Meta AI' },
      { assetId: 'c', role: 'media', aiGenerated: false, scene: 'usage' },
      { assetId: 'new', role: 'media', aiGenerated: false },
    ]);
  });

  it('marks exactly the chosen file as the cover, and no cover when it was unticked', () => {
    const current = [held('a'), held('b')];
    expect(buildAttachments(current, ['a', 'b'], 'b').map((i) => i.role)).toEqual([
      'media',
      'cover',
    ]);
    expect(buildAttachments(current, ['a'], 'b').map((i) => i.role)).toEqual(['media']);
  });

  it('never sends more than ten files', () => {
    const ids = Array.from({ length: 14 }, (_, index) => `f${String(index)}`);
    expect(buildAttachments([], ids, null)).toHaveLength(10);
  });
});
