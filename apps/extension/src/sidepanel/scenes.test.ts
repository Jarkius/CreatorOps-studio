import type { DraftAsset } from '@creatorops/contracts';
import { describe, expect, it } from 'vitest';

import { attachedByScene, scenesFromSections } from './scenes.js';

const base = { hook: 'HOOK', callToAction: 'CTA' };

describe('scenesFromSections', () => {
  it('maps four lines one to one', () => {
    const scenes = scenesFromSections({ ...base, storyboard: ['a', 'b', 'c', 'd'] });
    expect(scenes.map((s) => [s.scene, s.label, s.prompt])).toEqual([
      ['product_hero', 'Product Hero', 'a'],
      ['detail', 'Detail', 'b'],
      ['usage', 'Usage', 'c'],
      ['final_shot', 'Final Shot', 'd'],
    ]);
  });

  it('uses the last line for the final shot when there are more than four', () => {
    const scenes = scenesFromSections({ ...base, storyboard: ['a', 'b', 'c', 'd', 'e'] });
    expect(scenes[3]?.prompt).toBe('e');
    expect(scenes[2]?.prompt).toBe('c');
  });

  it('fills the final shot from the call to action when there are three lines', () => {
    const scenes = scenesFromSections({ ...base, storyboard: ['a', 'b', 'c'] });
    expect(scenes.map((s) => s.prompt)).toEqual(['a', 'b', 'c', 'CTA']);
  });

  it('fills missing scenes from the hook when there is one line, and never leaves a prompt empty', () => {
    const scenes = scenesFromSections({ ...base, storyboard: ['a'] });
    expect(scenes.map((s) => s.prompt)).toEqual(['a', 'HOOK', 'HOOK', 'CTA']);
  });
});

describe('attachedByScene', () => {
  const item = (assetId: string, scene: DraftAsset['scene'], type: 'image' | 'video' = 'image') =>
    ({ assetId, scene, asset: { type } }) as DraftAsset;
  it('keeps the first file per scene and ignores files without a scene', () => {
    const map = attachedByScene([item('x', null), item('a', 'usage'), item('b', 'usage')]);
    expect(map.size).toBe(1);
    expect(map.get('usage')?.assetId).toBe('a');
  });

  it('keeps images and videos apart, so a scene can hold one of each', () => {
    const items = [
      item('v', 'usage', 'video'),
      item('i', 'usage', 'image'),
      item('w', 'detail', 'video'),
    ];
    expect(attachedByScene(items).get('usage')?.assetId).toBe('i');
    expect(attachedByScene(items, 'video').get('usage')?.assetId).toBe('v');
    expect(attachedByScene(items).has('detail')).toBe(false);
    expect([...attachedByScene(items, 'video').keys()].sort()).toEqual(['detail', 'usage']);
  });
});
