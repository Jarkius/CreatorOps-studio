import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from './errors.js';
import {
  CAMPAIGN_STATUS_VALUES,
  CONTENT_LIMITS,
  CampaignListQuerySchema,
  CreateCampaignRequestSchema,
  DRAFT_STATUS_VALUES,
  DraftListQuerySchema,
  DraftSchema,
  GenerateBriefJobRequestSchema,
  IdempotencyKeySchema,
  JOB_ERROR_CODES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  JobListQuerySchema,
  JobSchema,
  PLATFORM_VALUES,
  RegenerateSectionJobRequestSchema,
  SECTION_NAMES,
  SECTION_ORIGIN_VALUES,
  SectionStateSchema,
  TemplateListResponseSchema,
  TemplateSchema,
  UpdateCampaignRequestSchema,
  UpdateDraftRequestSchema,
} from './content.js';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

const validCampaign = {
  productId: 'p1',
  templateId: 't1',
  templateVersion: 1,
};

const validSections = {
  title: 'พัดลมตั้งโต๊ะ ลมแรง เงียบ',
  hook: 'เบื่อความร้อนที่บ้านไหม',
  script: 'ฉากแรกโชว์พัดลม',
  storyboard: ['ภาพระยะใกล้', 'ภาพคนใช้งาน'],
  caption: 'พัดลมตั้งโต๊ะรุ่นใหม่',
  hashtags: ['#พัดลม', '#รีวิว'],
  callToAction: 'กดดูรายละเอียด',
};

const validDraft = {
  id: 'd1',
  workspaceId: 'w1',
  campaignId: 'c1',
  productId: 'p1',
  variantIndex: 0,
  sections: validSections,
  sectionState: Object.fromEntries(
    SECTION_NAMES.map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
  ),
  claimWarnings: [{ section: 'caption', kind: 'restricted_claim', text: 'รักษาได้' }],
  needsReview: true,
  status: 'draft',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const validJob = {
  id: 'j1',
  workspaceId: 'w1',
  type: 'generate_brief',
  status: 'queued',
  input: { campaignId: 'c1' },
  output: null,
  errorCode: null,
  errorMessage: null,
  provider: null,
  attempts: 0,
  maxAttempts: 3,
  campaignId: 'c1',
  draftId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

describe('enum tuples', () => {
  it('match the exact wire values (guards against silent renames)', () => {
    expect(SECTION_NAMES).toEqual([
      'title',
      'hook',
      'script',
      'storyboard',
      'caption',
      'hashtags',
      'callToAction',
    ]);
    expect(PLATFORM_VALUES).toEqual(['tiktok', 'facebook', 'shopee', 'generic']);
    expect(CAMPAIGN_STATUS_VALUES).toEqual(['draft', 'active', 'archived']);
    expect(DRAFT_STATUS_VALUES).toEqual(['draft', 'in_review', 'approved']);
    expect(JOB_TYPE_VALUES).toEqual(['generate_brief', 'regenerate_section', 'export_package']);
    expect(JOB_STATUS_VALUES).toEqual(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
    expect(JOB_ERROR_CODES).toEqual([
      'PROVIDER_TIMEOUT',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_RATE_LIMITED',
      'INVALID_PROVIDER_OUTPUT',
      'CONTENT_REFUSED',
      'SECTION_CHANGED',
      'ASSET_UNAVAILABLE',
      'EXPORT_TOO_LARGE',
      'CANCELLED',
      'INTERNAL',
    ]);
    expect(SECTION_ORIGIN_VALUES).toEqual(['generated', 'edited']);
  });

  it('adds IDEMPOTENCY_CONFLICT to the API error codes without removing any', () => {
    expect(ERROR_CODES).toContain('IDEMPOTENCY_CONFLICT');
    expect(ERROR_CODES).toContain('INTERNAL_ERROR');
    expect(ERROR_CODES).toContain('CONFLICT');
  });

  it('pins the section limits to the provider-core values', () => {
    expect(CONTENT_LIMITS.sections).toEqual({
      title: 100,
      hook: 200,
      script: 1500,
      caption: 2200,
      callToAction: 200,
      scene: 300,
    });
    expect(CONTENT_LIMITS.storyboard).toEqual({ min: 1, max: 12 });
    expect(CONTENT_LIMITS.hashtags).toEqual({ count: 30, length: 50 });
    expect(CONTENT_LIMITS.durationSeconds).toEqual({ min: 5, max: 180 });
    expect(CONTENT_LIMITS.variants).toEqual({ min: 1, max: 3 });
  });
});

describe('CreateCampaignRequestSchema', () => {
  it('accepts a minimal campaign and applies defaults', () => {
    const parsed = CreateCampaignRequestSchema.parse(validCampaign);
    expect(parsed.platform).toBe('generic');
    expect(parsed.variants).toBe(1);
    expect(parsed.name).toBeUndefined();
  });

  it('accepts Thai names and tones', () => {
    expect(
      ok(CreateCampaignRequestSchema, {
        ...validCampaign,
        name: '  แคมเปญพัดลมหน้าร้อน  ',
        tone: 'สนุกสนาน เป็นกันเอง',
        language: 'th',
        platform: 'shopee',
        durationSeconds: 30,
        variants: 3,
      }),
    ).toBe(true);
  });

  it('rejects unknown fields (no mass assignment)', () => {
    for (const extra of [{ workspaceId: 'w' }, { status: 'active' }, { version: 2 }, { id: 'x' }]) {
      expect(
        ok(CreateCampaignRequestSchema, { ...validCampaign, ...extra }),
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('enforces name, tone and template bounds at the limit and limit+1', () => {
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, name: 'n'.repeat(120) })).toBe(true);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, name: 'n'.repeat(121) })).toBe(
      false,
    );
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, name: '   ' })).toBe(false);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, tone: 't'.repeat(100) })).toBe(true);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, tone: 't'.repeat(101) })).toBe(
      false,
    );
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, tone: null })).toBe(true);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, productId: '' })).toBe(false);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, productId: 'p'.repeat(65) })).toBe(
      false,
    );
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, templateId: 't'.repeat(65) })).toBe(
      false,
    );
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, templateVersion: 0 })).toBe(false);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, templateVersion: 1.5 })).toBe(false);
  });

  it('bounds duration at 5 and 180 seconds', () => {
    for (const durationSeconds of [5, 180]) {
      expect(ok(CreateCampaignRequestSchema, { ...validCampaign, durationSeconds })).toBe(true);
    }
    for (const durationSeconds of [4, 181, 30.5]) {
      expect(ok(CreateCampaignRequestSchema, { ...validCampaign, durationSeconds })).toBe(false);
    }
  });

  it('bounds variants at 1 and 3 and rejects 4', () => {
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, variants: 1 })).toBe(true);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, variants: 3 })).toBe(true);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, variants: 4 })).toBe(false);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, variants: 0 })).toBe(false);
  });

  it('rejects an unknown platform or language', () => {
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, platform: 'youtube' })).toBe(false);
    expect(ok(CreateCampaignRequestSchema, { ...validCampaign, language: 'fr' })).toBe(false);
  });
});

describe('UpdateCampaignRequestSchema', () => {
  it('requires the version and at least one field to change', () => {
    expect(ok(UpdateCampaignRequestSchema, { name: 'x' })).toBe(false);
    expect(ok(UpdateCampaignRequestSchema, { version: 1 })).toBe(false);
    expect(ok(UpdateCampaignRequestSchema, { version: 0, name: 'x' })).toBe(false);
    expect(ok(UpdateCampaignRequestSchema, { version: 1, name: 'x' })).toBe(true);
    expect(ok(UpdateCampaignRequestSchema, { version: 1, status: 'archived' })).toBe(true);
  });

  it('lets tone be cleared with null and rejects unknown or protected fields', () => {
    expect(ok(UpdateCampaignRequestSchema, { version: 1, tone: null })).toBe(true);
    expect(ok(UpdateCampaignRequestSchema, { version: 1, name: null })).toBe(false);
    expect(ok(UpdateCampaignRequestSchema, { version: 1, status: 'deleted' })).toBe(false);
    for (const extra of [{ productId: 'p' }, { platform: 'tiktok' }, { workspaceId: 'w' }]) {
      expect(
        ok(UpdateCampaignRequestSchema, { version: 1, name: 'x', ...extra }),
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe('CampaignListQuerySchema', () => {
  it('applies defaults and coerces limit from a string', () => {
    expect(CampaignListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(CampaignListQuerySchema.parse({ limit: '100', status: 'active' })).toEqual({
      limit: 100,
      status: 'active',
    });
  });

  it('bounds limit and rejects unknown parameters', () => {
    for (const bad of [{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { status: 'deleted' }]) {
      expect(ok(CampaignListQuerySchema, bad), JSON.stringify(bad)).toBe(false);
    }
    expect(ok(CampaignListQuerySchema, { workspaceId: 'w' })).toBe(false);
    expect(ok(CampaignListQuerySchema, { cursor: 'c'.repeat(301) })).toBe(false);
  });
});

describe('UpdateDraftRequestSchema', () => {
  it('accepts a partial section update with an optional status', () => {
    expect(ok(UpdateDraftRequestSchema, { version: 1, sections: { hook: 'ใหม่' } })).toBe(true);
    expect(
      ok(UpdateDraftRequestSchema, { version: 2, sections: { caption: 'x' }, status: 'in_review' }),
    ).toBe(true);
  });

  it('rejects an empty sections object', () => {
    expect(ok(UpdateDraftRequestSchema, { version: 1, sections: {} })).toBe(false);
  });

  it('rejects unknown section names', () => {
    expect(ok(UpdateDraftRequestSchema, { version: 1, sections: { subtitle: 'x' } })).toBe(false);
    expect(
      ok(UpdateDraftRequestSchema, { version: 1, sections: { hook: 'x', subtitle: 'y' } }),
    ).toBe(false);
  });

  it('rejects unknown top-level fields and a missing version', () => {
    expect(
      ok(UpdateDraftRequestSchema, { version: 1, sections: { hook: 'x' }, draftId: 'd' }),
    ).toBe(false);
    expect(ok(UpdateDraftRequestSchema, { sections: { hook: 'x' } })).toBe(false);
  });

  it('enforces section bounds and hashtag rules', () => {
    const hook = (text: string) =>
      ok(UpdateDraftRequestSchema, { version: 1, sections: { hook: text } });
    expect(hook('h'.repeat(200))).toBe(true);
    expect(hook('h'.repeat(201))).toBe(false);
    expect(hook('   ')).toBe(false);
    const tags = (hashtags: string[]) =>
      ok(UpdateDraftRequestSchema, { version: 1, sections: { hashtags } });
    expect(tags(['#ok'])).toBe(true);
    expect(tags(['ไม่มีแฮช'])).toBe(false);
    expect(tags(['#'])).toBe(false);
    expect(tags(['#' + 'a'.repeat(49)])).toBe(true);
    expect(tags(['#' + 'a'.repeat(50)])).toBe(false);
    expect(tags(Array(30).fill('#a'))).toBe(true);
    expect(tags(Array(31).fill('#a'))).toBe(false);
  });

  it('enforces storyboard bounds (1..12 scenes of up to 300 characters)', () => {
    const board = (storyboard: string[]) =>
      ok(UpdateDraftRequestSchema, { version: 1, sections: { storyboard } });
    expect(board(['a'])).toBe(true);
    expect(board(Array(12).fill('a'))).toBe(true);
    expect(board([])).toBe(false);
    expect(board(Array(13).fill('a'))).toBe(false);
    expect(board(['s'.repeat(300)])).toBe(true);
    expect(board(['s'.repeat(301)])).toBe(false);
  });
});

describe('DraftSchema', () => {
  it('parses a full draft with a complete section state', () => {
    expect(ok(DraftSchema, validDraft)).toBe(true);
  });

  it('rejects a section state missing any section', () => {
    const partial: Record<string, unknown> = { ...validDraft.sectionState };
    delete partial.callToAction;
    expect(ok(SectionStateSchema, partial)).toBe(false);
  });

  it('rejects an unknown section origin or non-positive rev', () => {
    expect(
      ok(SectionStateSchema, {
        ...validDraft.sectionState,
        hook: { rev: 1, origin: 'imported', jobId: null },
      }),
    ).toBe(false);
    expect(
      ok(SectionStateSchema, {
        ...validDraft.sectionState,
        hook: { rev: 0, origin: 'edited', jobId: null },
      }),
    ).toBe(false);
  });

  it('rejects an unknown claim warning kind or section', () => {
    expect(
      ok(DraftSchema, {
        ...validDraft,
        claimWarnings: [{ section: 'hook', kind: 'bogus', text: 'x' }],
      }),
    ).toBe(false);
    expect(
      ok(DraftSchema, {
        ...validDraft,
        claimWarnings: [{ section: 'subtitle', kind: 'restricted_claim', text: 'x' }],
      }),
    ).toBe(false);
  });
});

describe('list and params schemas for drafts', () => {
  it('coerces the limit and accepts an optional campaign filter', () => {
    expect(DraftListQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
    expect(DraftListQuerySchema.parse({ campaignId: 'c1' })).toEqual({
      limit: 25,
      campaignId: 'c1',
    });
    expect(ok(DraftListQuerySchema, { limit: '0' })).toBe(false);
    expect(ok(DraftListQuerySchema, { draftId: 'd' })).toBe(false);
  });
});

describe('job request schemas', () => {
  it('accepts a generate-brief request and rejects unknown fields or an empty campaign id', () => {
    expect(ok(GenerateBriefJobRequestSchema, { campaignId: 'c1' })).toBe(true);
    expect(ok(GenerateBriefJobRequestSchema, { campaignId: '' })).toBe(false);
    expect(ok(GenerateBriefJobRequestSchema, { campaignId: 'c'.repeat(65) })).toBe(false);
    expect(ok(GenerateBriefJobRequestSchema, { campaignId: 'c1', provider: 'x' })).toBe(false);
  });

  it('accepts a regenerate-section request and validates section, rev and strictness', () => {
    const base = { draftId: 'd1', section: 'hook', expectedRev: 1 };
    expect(ok(RegenerateSectionJobRequestSchema, base)).toBe(true);
    expect(ok(RegenerateSectionJobRequestSchema, { ...base, section: 'subtitle' })).toBe(false);
    expect(ok(RegenerateSectionJobRequestSchema, { ...base, expectedRev: 0 })).toBe(false);
    expect(ok(RegenerateSectionJobRequestSchema, { ...base, expectedRev: 1.5 })).toBe(false);
    expect(ok(RegenerateSectionJobRequestSchema, { ...base, campaignId: 'c' })).toBe(false);
    expect(ok(RegenerateSectionJobRequestSchema, { ...base, draftId: '' })).toBe(false);
  });
});

describe('IdempotencyKeySchema', () => {
  it('accepts 8 to 128 characters of letters, digits, underscore and hyphen', () => {
    expect(ok(IdempotencyKeySchema, 'abc12345')).toBe(true);
    expect(ok(IdempotencyKeySchema, 'A_b-9'.repeat(8).slice(0, 128))).toBe(true);
    expect(ok(IdempotencyKeySchema, 'a'.repeat(128))).toBe(true);
  });

  it('rejects short keys, path-like keys, over-long keys and keys with spaces', () => {
    expect(ok(IdempotencyKeySchema, 'short')).toBe(false);
    expect(ok(IdempotencyKeySchema, '../etc')).toBe(false);
    expect(ok(IdempotencyKeySchema, 'a'.repeat(129))).toBe(false);
    expect(ok(IdempotencyKeySchema, 'abc 12345')).toBe(false);
    expect(ok(IdempotencyKeySchema, '')).toBe(false);
  });
});

describe('job list and job schemas', () => {
  it('coerces limit and accepts status and type filters', () => {
    expect(JobListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      JobListQuerySchema.parse({ limit: '5', status: 'failed', type: 'regenerate_section' }),
    ).toEqual({ limit: 5, status: 'failed', type: 'regenerate_section' });
    expect(ok(JobListQuerySchema, { limit: '101' })).toBe(false);
    expect(ok(JobListQuerySchema, { status: 'done' })).toBe(false);
    expect(ok(JobListQuerySchema, { type: 'publish' })).toBe(false);
  });

  it('parses a queued job and a failed job with a stable error code', () => {
    expect(ok(JobSchema, validJob)).toBe(true);
    expect(
      ok(JobSchema, {
        ...validJob,
        status: 'failed',
        errorCode: 'PROVIDER_RATE_LIMITED',
        errorMessage: 'slow down',
        attempts: 3,
      }),
    ).toBe(true);
    expect(ok(JobSchema, { ...validJob, status: 'failed', errorCode: 'NOPE' })).toBe(false);
  });
});

describe('template schemas', () => {
  const template = {
    id: 't1',
    version: 1,
    name: { th: 'รีวิวสินค้า', en: 'Product review' },
    description: { th: 'คำอธิบาย', en: 'Description' },
    defaultDurationSeconds: 30,
  };

  it('requires Thai and English names and descriptions', () => {
    expect(ok(TemplateSchema, template)).toBe(true);
    expect(ok(TemplateSchema, { ...template, name: { th: 'รีวิว' } })).toBe(false);
    expect(ok(TemplateSchema, { ...template, description: { en: 'Only English' } })).toBe(false);
    expect(ok(TemplateSchema, { ...template, version: 1.5 })).toBe(false);
  });

  it('wraps templates in a list response', () => {
    expect(ok(TemplateListResponseSchema, { items: [template] })).toBe(true);
    expect(ok(TemplateListResponseSchema, { items: 'none' })).toBe(false);
  });
});
