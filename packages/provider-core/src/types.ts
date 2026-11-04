import type { DraftSections, SectionName, SectionValue } from './sections.js';

export interface ProductFacts {
  name: string;
  description: string | null;
  priceAmount: string | null;
  currency: string | null;
  sellingPoints: string[];
  targetAudience: string | null;
  brandTone: string | null;
  restrictedClaims: string[];
}

export type Language = 'th' | 'en';

export type Platform = 'tiktok' | 'facebook' | 'shopee' | 'generic';

export interface GenerateBriefRequest {
  template: { id: string; version: number };
  language: Language;
  tone: string | null;
  platform: Platform;
  durationSeconds: number;
  variantIndex: number;
  product: ProductFacts;
}

export interface RegenerateSectionRequest extends GenerateBriefRequest {
  section: SectionName;
  current: DraftSections;
}

export interface ProviderUsage {
  inputUnits: number;
  outputUnits: number;
}

export interface ProviderCallOptions {
  signal?: AbortSignal;
}

export interface TextProvider {
  readonly id: string;
  generateBrief(
    req: GenerateBriefRequest,
    opts?: ProviderCallOptions,
  ): Promise<{ output: DraftSections; usage: ProviderUsage; model: string }>;
  regenerateSection(
    req: RegenerateSectionRequest,
    opts?: ProviderCallOptions,
  ): Promise<{ section: SectionName; value: SectionValue; usage: ProviderUsage; model: string }>;
}
