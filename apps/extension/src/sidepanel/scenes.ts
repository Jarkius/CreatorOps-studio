import {
  DRAFT_SCENE_VALUES,
  type DraftAsset,
  type DraftScene,
  type DraftSections,
} from '@creatorops/contracts';

export const SCENE_LABELS: Readonly<Record<DraftScene, string>> = {
  product_hero: 'Product Hero',
  detail: 'Detail',
  usage: 'Usage',
  final_shot: 'Final Shot',
};

/** One scene of the list: a fixed name and the prompt text the owner can edit. */
export interface SceneItem {
  readonly scene: DraftScene;
  readonly label: string;
  readonly prompt: string;
}

/**
 * The four scenes with their prompt text (template source, D-071 item 5a). The storyboard of the
 * draft has 3 to 5 lines (up to 12 in the contract): Product Hero is the first, Detail the second,
 * Usage the third and Final Shot the last line when there are at least four. A draft with fewer
 * lines fills the rest from its call to action (Final Shot) and its hook (anything else), so a
 * scene never has an empty prompt.
 */
export function scenesFromSections(
  sections: Pick<DraftSections, 'storyboard' | 'hook' | 'callToAction'>,
): readonly SceneItem[] {
  const lines = sections.storyboard;
  const last = lines.length - 1;
  const indexes: Record<DraftScene, number> = {
    product_hero: 0,
    detail: 1,
    usage: 2,
    final_shot: lines.length >= 4 ? last : -1,
  };
  return DRAFT_SCENE_VALUES.map((scene) => {
    const line = lines[indexes[scene]];
    const fallback = scene === 'final_shot' ? sections.callToAction : sections.hook;
    return { scene, label: SCENE_LABELS[scene], prompt: line ?? fallback };
  });
}

/** The attached file of each scene (the first one in package order), or none. */
export function attachedByScene(items: readonly DraftAsset[]): ReadonlyMap<DraftScene, DraftAsset> {
  const map = new Map<DraftScene, DraftAsset>();
  for (const item of items) {
    if (item.scene !== null && !map.has(item.scene)) map.set(item.scene, item);
  }
  return map;
}
