import { CONTENT_LIMITS, type Product, type Template } from '@creatorops/contracts';

/** One line of the checklist under the Create button. */
export interface CreateStep {
  readonly id: 'script' | 'images' | 'video';
  readonly label: string;
  /** `ready` runs when you press the button; `soon` is not built yet and is shown honestly. */
  readonly state: 'ready' | 'soon';
}

/** The checklist of the Full Auto flow (A1): only the script step runs today. */
export function createSteps(): readonly CreateStep[] {
  return [
    { id: 'script', label: 'Script, scenes and caption', state: 'ready' },
    { id: 'images', label: 'Scene images in Meta AI', state: 'soon' },
    { id: 'video', label: 'Scene video in Meta AI', state: 'soon' },
  ];
}

/**
 * A readable campaign name made from the product and the mode, cut to the limit by whole
 * characters (never in the middle of a Thai character or an emoji).
 */
export function campaignNameFor(
  product: Pick<Product, 'name'>,
  template: Pick<Template, 'name'>,
): string {
  const full = `${product.name} · ${template.name.en}`;
  const characters = Array.from(full.normalize('NFC'));
  return characters.slice(0, CONTENT_LIMITS.campaignName).join('').trim();
}

/** One Idempotency-Key per click (8 to 128 letters, digits, `_` or `-`). */
export function newCreateKey(): string {
  return `ext-${crypto.randomUUID()}`;
}

/** The product and mode the user picked, or null until both are chosen. */
export function pickedInputs(
  products: readonly Product[],
  templates: readonly Template[],
  productId: string,
  templateId: string,
): { product: Product; template: Template } | null {
  const product = products.find((item) => item.id === productId);
  const template = templates.find((item) => item.id === templateId);
  return product === undefined || template === undefined ? null : { product, template };
}
