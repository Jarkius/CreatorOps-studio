import { z } from 'zod';

import { LanguageSchema } from './workspace.js';

// ---------------------------------------------------------------------------
// Enums. Each tuple is exported so the exact values are visible and tested.
// Stable wire values: add new values, never rename them.
// ---------------------------------------------------------------------------

export const SECTION_NAMES = [
  'title',
  'hook',
  'script',
  'storyboard',
  'caption',
  'hashtags',
  'callToAction',
] as const;
export const SectionNameSchema = z.enum(SECTION_NAMES);
export type SectionName = z.infer<typeof SectionNameSchema>;

export const PLATFORM_VALUES = ['tiktok', 'facebook', 'shopee', 'generic'] as const;
export const PlatformSchema = z.enum(PLATFORM_VALUES);
export type Platform = z.infer<typeof PlatformSchema>;

export const CAMPAIGN_STATUS_VALUES = ['draft', 'active', 'archived'] as const;
export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUS_VALUES);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const DRAFT_STATUS_VALUES = ['draft', 'in_review', 'approved'] as const;
export const DraftStatusSchema = z.enum(DRAFT_STATUS_VALUES);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

export const JOB_TYPE_VALUES = ['generate_brief', 'regenerate_section', 'export_package'] as const;
export const JobTypeSchema = z.enum(JOB_TYPE_VALUES);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JOB_STATUS_VALUES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const JobStatusSchema = z.enum(JOB_STATUS_VALUES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Stable job error codes. Add codes; never rename them. */
export const JOB_ERROR_CODES = [
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RATE_LIMITED',
  'INVALID_PROVIDER_OUTPUT',
  'PROVIDER_AUTH',
  'PROVIDER_BUDGET',
  'CONTENT_REFUSED',
  'SECTION_CHANGED',
  'ASSET_UNAVAILABLE',
  'EXPORT_TOO_LARGE',
  'CANCELLED',
  'INTERNAL',
] as const;
export const JobErrorCodeSchema = z.enum(JOB_ERROR_CODES);
export type JobErrorCode = z.infer<typeof JobErrorCodeSchema>;

export const SECTION_ORIGIN_VALUES = ['generated', 'edited'] as const;
export const SectionOriginSchema = z.enum(SECTION_ORIGIN_VALUES);
export type SectionOrigin = z.infer<typeof SectionOriginSchema>;

export const CLAIM_WARNING_KIND_VALUES = ['restricted_claim', 'unsupported_claim'] as const;
export const ClaimWarningKindSchema = z.enum(CLAIM_WARNING_KIND_VALUES);
export type ClaimWarningKind = z.infer<typeof ClaimWarningKindSchema>;

// ---------------------------------------------------------------------------
// Limits. Section limits match provider-core so the API and the provider reject the same input.
// Thai text: these are code-point counts for the schema; the provider enforces grapheme limits.
// ---------------------------------------------------------------------------

export const CONTENT_LIMITS = {
  campaignName: 120,
  tone: 100,
  durationSeconds: { min: 5, max: 180 },
  variants: { min: 1, max: 3 },
  sections: {
    title: 100,
    hook: 200,
    script: 1500,
    caption: 2200,
    callToAction: 200,
    scene: 300,
  },
  storyboard: { min: 1, max: 12 },
  hashtags: { count: 30, length: 50 },
} as const;

const idString = z.string().min(1).max(64);
const cursorString = z.string().max(300);
const limitParam = z.coerce.number().int().min(1).max(100).default(25);

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const campaignName = z.string().trim().min(1).max(CONTENT_LIMITS.campaignName);
const campaignTone = z.string().trim().max(CONTENT_LIMITS.tone);
const durationSeconds = z
  .number()
  .int()
  .min(CONTENT_LIMITS.durationSeconds.min)
  .max(CONTENT_LIMITS.durationSeconds.max);
const variantCount = z
  .number()
  .int()
  .min(CONTENT_LIMITS.variants.min)
  .max(CONTENT_LIMITS.variants.max);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const LocalizedTextSchema = z.object({ th: z.string(), en: z.string() });

export const TemplateSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  name: LocalizedTextSchema,
  description: LocalizedTextSchema,
  defaultDurationSeconds: z.number().int(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateListResponseSchema = z.object({ items: z.array(TemplateSchema) });
export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>;

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const CampaignSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  productId: z.string(),
  name: z.string(),
  templateId: z.string(),
  templateVersion: z.number().int(),
  language: LanguageSchema,
  tone: z.string().nullable(),
  platform: PlatformSchema,
  durationSeconds: z.number().int(),
  variants: z.number().int(),
  status: CampaignStatusSchema,
  /** Increases on every change; send it back with PATCH to detect conflicting edits. */
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

/** POST /api/v1/workspaces/:workspaceId/campaigns. Unknown fields are rejected. */
export const CreateCampaignRequestSchema = z
  .object({
    productId: idString,
    templateId: idString,
    templateVersion: z.number().int().min(1),
    name: campaignName.optional(),
    language: LanguageSchema.optional(),
    tone: campaignTone.nullish(),
    platform: PlatformSchema.default('generic'),
    durationSeconds: durationSeconds.optional(),
    variants: variantCount.default(1),
  })
  .strict();
export type CreateCampaignRequest = z.input<typeof CreateCampaignRequestSchema>;

/**
 * PATCH body: the `version` the client last saw plus any subset of the editable fields. A field
 * set to null is cleared. A stale version is answered with 409 and the current version.
 */
export const UpdateCampaignRequestSchema = z
  .object({
    version: z.number().int().min(1),
    name: campaignName.optional(),
    tone: campaignTone.nullable().optional(),
    status: CampaignStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
    message: 'give at least one field to change',
    path: ['version'],
  });
export type UpdateCampaignRequest = z.input<typeof UpdateCampaignRequestSchema>;

/** GET /api/v1/workspaces/:workspaceId/campaigns query string. */
export const CampaignListQuerySchema = z
  .object({
    status: CampaignStatusSchema.optional(),
    limit: limitParam,
    cursor: cursorString.optional(),
  })
  .strict();
/** What clients may send (limit may be a string in a URL). */
export type CampaignListQuery = z.input<typeof CampaignListQuerySchema>;
/** What the API sees after parsing and defaults. */
export type CampaignListQueryParsed = z.infer<typeof CampaignListQuerySchema>;

export const CampaignParamsSchema = z.object({ workspaceId: z.string(), campaignId: z.string() });
export type CampaignParams = z.infer<typeof CampaignParamsSchema>;

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

const sceneText = boundedText(CONTENT_LIMITS.sections.scene);
const hashtag = z
  .string()
  .trim()
  .min(2)
  .max(CONTENT_LIMITS.hashtags.length)
  .regex(/^#/, 'must start with #');

export const DraftSectionsSchema = z.object({
  title: boundedText(CONTENT_LIMITS.sections.title),
  hook: boundedText(CONTENT_LIMITS.sections.hook),
  script: boundedText(CONTENT_LIMITS.sections.script),
  storyboard: z
    .array(sceneText)
    .min(CONTENT_LIMITS.storyboard.min)
    .max(CONTENT_LIMITS.storyboard.max),
  caption: boundedText(CONTENT_LIMITS.sections.caption),
  hashtags: z.array(hashtag).max(CONTENT_LIMITS.hashtags.count),
  callToAction: boundedText(CONTENT_LIMITS.sections.callToAction),
});
export type DraftSections = z.infer<typeof DraftSectionsSchema>;

/** Per-section revision state. A full record: every section name must be present. */
export const SectionStateSchema = z.record(
  SectionNameSchema,
  z.object({
    rev: z.number().int().min(1),
    origin: SectionOriginSchema,
    jobId: z.string().nullable(),
  }),
);
export type SectionState = z.infer<typeof SectionStateSchema>;

export const ClaimWarningSchema = z.object({
  section: SectionNameSchema,
  kind: ClaimWarningKindSchema,
  text: z.string(),
});
export type ClaimWarning = z.infer<typeof ClaimWarningSchema>;

export const DraftSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  campaignId: z.string(),
  productId: z.string(),
  variantIndex: z.number().int(),
  sections: DraftSectionsSchema,
  sectionState: SectionStateSchema,
  claimWarnings: z.array(ClaimWarningSchema),
  needsReview: z.boolean(),
  status: DraftStatusSchema,
  /** Increases on every change; send it back with PATCH to detect conflicting edits. */
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

/**
 * PATCH body. `sections` is required and must carry at least one section; unknown section names
 * are rejected. `status` is optional.
 */
export const UpdateDraftRequestSchema = z
  .object({
    version: z.number().int().min(1),
    sections: DraftSectionsSchema.partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'give at least one section to change',
      }),
    status: DraftStatusSchema.optional(),
  })
  .strict();
export type UpdateDraftRequest = z.input<typeof UpdateDraftRequestSchema>;

/** GET /api/v1/workspaces/:workspaceId/drafts query string. */
export const DraftListQuerySchema = z
  .object({
    campaignId: idString.optional(),
    limit: limitParam,
    cursor: cursorString.optional(),
  })
  .strict();
export type DraftListQuery = z.input<typeof DraftListQuerySchema>;
export type DraftListQueryParsed = z.infer<typeof DraftListQuerySchema>;

export const DraftListResponseSchema = z.object({
  items: z.array(DraftSchema),
  nextCursor: z.string().nullable(),
});
export type DraftListResponse = z.infer<typeof DraftListResponseSchema>;

export const DraftParamsSchema = z.object({ workspaceId: z.string(), draftId: z.string() });
export type DraftParams = z.infer<typeof DraftParamsSchema>;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Request header carrying the client-chosen idempotency key for job creation. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

const jsonRecord = z.record(z.string(), z.unknown());

export const JobSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: JobTypeSchema,
  status: JobStatusSchema,
  input: jsonRecord,
  output: jsonRecord.nullable(),
  errorCode: JobErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  provider: z.string().nullable(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  campaignId: z.string().nullable(),
  draftId: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

/** POST /api/v1/workspaces/:workspaceId/jobs/generate-brief */
export const GenerateBriefJobRequestSchema = z.object({ campaignId: idString }).strict();
export type GenerateBriefJobRequest = z.infer<typeof GenerateBriefJobRequestSchema>;

/** POST /api/v1/workspaces/:workspaceId/jobs/regenerate-section */
export const RegenerateSectionJobRequestSchema = z
  .object({
    draftId: idString,
    section: SectionNameSchema,
    expectedRev: z.number().int().min(1),
  })
  .strict();
export type RegenerateSectionJobRequest = z.infer<typeof RegenerateSectionJobRequestSchema>;

/** GET /api/v1/workspaces/:workspaceId/jobs query string. */
export const JobListQuerySchema = z
  .object({
    status: JobStatusSchema.optional(),
    type: JobTypeSchema.optional(),
    /** Only jobs for this campaign (generate jobs). */
    campaignId: idString.optional(),
    /** Only jobs for this draft (regenerate-section jobs). */
    draftId: idString.optional(),
    limit: limitParam,
    cursor: cursorString.optional(),
  })
  .strict();
export type JobListQuery = z.input<typeof JobListQuerySchema>;
export type JobListQueryParsed = z.infer<typeof JobListQuerySchema>;

export const JobListResponseSchema = z.object({
  items: z.array(JobSchema),
  nextCursor: z.string().nullable(),
});
export type JobListResponse = z.infer<typeof JobListResponseSchema>;

/**
 * A campaign in a list, with its newest generate job, so a screen needs one request to show every
 * campaign's state however many jobs the workspace has (D-064). `null` when it was never generated.
 */
export const CampaignListItemSchema = CampaignSchema.extend({
  latestGenerateJob: JobSchema.nullable(),
});
export type CampaignListItem = z.infer<typeof CampaignListItemSchema>;

export const CampaignListResponseSchema = z.object({
  items: z.array(CampaignListItemSchema),
  /** Pass back as `cursor` for the next page; null when there are no more. */
  nextCursor: z.string().nullable(),
});
export type CampaignListResponse = z.infer<typeof CampaignListResponseSchema>;

export const JobParamsSchema = z.object({ workspaceId: z.string(), jobId: z.string() });
export type JobParams = z.infer<typeof JobParamsSchema>;

/**
 * Body of a job-creation response. The API answers 202 for a new job and 200 for an idempotent
 * replay of an earlier request with the same key; both carry this shape.
 */
export const CreateJobResponseSchema = JobSchema;
export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;
