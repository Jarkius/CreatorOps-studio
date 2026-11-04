import { CONTENT_LIMITS } from '@creatorops/contracts';
import type { CreateCampaignRequest, Language, Platform, Template } from '@creatorops/contracts';

/** What the form holds. Every field is a string, as the inputs produce. */
export interface CampaignFormValues {
  productId: string;
  templateId: string;
  platform: Platform;
  variants: string;
  language: '' | Language;
  durationSeconds: string;
  tone: string;
  name: string;
}

export const EMPTY_CAMPAIGN_FORM: CampaignFormValues = {
  productId: '',
  templateId: '',
  platform: 'generic',
  variants: '1',
  language: '',
  durationSeconds: '',
  tone: '',
  name: '',
};

export const PLATFORM_OPTIONS = [
  { value: 'generic', label: 'Generic' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'shopee', label: 'Shopee' },
];

export const VARIANT_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
];

export const LANGUAGE_OPTIONS = [
  { value: '', label: 'Workspace default' },
  { value: 'th', label: 'Thai' },
  { value: 'en', label: 'English' },
];

/** The whole-number duration check, or null when the text is valid (blank is valid: optional). */
export function durationError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const { min, max } = CONTENT_LIMITS.durationSeconds;
  const value = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || value < min || value > max) {
    return `Enter a whole number from ${min} to ${max}.`;
  }
  return null;
}

/**
 * The request body with only the fields the user set. Blank optional text is left out, the language
 * is left out for "Workspace default", and the template version comes from the chosen template.
 */
export function buildCreateCampaignBody(
  values: CampaignFormValues,
  template: Template,
): CreateCampaignRequest {
  const body: CreateCampaignRequest = {
    productId: values.productId,
    templateId: template.id,
    templateVersion: template.version,
    platform: values.platform,
    variants: Number(values.variants),
  };
  const name = values.name.trim();
  if (name !== '') body.name = name;
  if (values.language !== '') body.language = values.language;
  const tone = values.tone.trim();
  if (tone !== '') body.tone = tone;
  const duration = values.durationSeconds.trim();
  if (duration !== '') body.durationSeconds = Number(duration);
  return body;
}
