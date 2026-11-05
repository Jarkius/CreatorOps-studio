import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Roles from docs/04. Only `owner` is exercised until Phase 8. */
export const WORKSPACE_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  defaultLanguage: text('default_language').notNull().default('th'),
  brandVoice: text('brand_voice'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    check(
      'workspace_members_role_check',
      sql`${table.role} in ('owner', 'admin', 'editor', 'reviewer', 'viewer')`,
    ),
    index('workspace_members_user_idx').on(table.userId),
  ],
);

/** Append-only record of sensitive actions (docs/04, docs/05). Never updated or deleted by the app. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_events_workspace_created_idx').on(table.workspaceId, table.createdAt)],
);

export const PRODUCT_STATUSES = ['active', 'archived'] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];

// Millisecond precision keeps a JavaScript Date round trip exact, which the pagination cursor
// relies on (a cursor built from a Date must compare equal to the stored value).
const nowMs = sql`date_trunc('milliseconds', now())`;

/**
 * Products (docs/04, D-037). The unique (workspace_id, id) pair lets later tables reference a
 * product with a composite foreign key, so the database itself refuses a cross-workspace link.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    sourceUrl: text('source_url'),
    priceAmount: numeric('price_amount', { precision: 12, scale: 2 }),
    currency: char('currency', { length: 3 }),
    sellingPoints: jsonb('selling_points')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    targetAudience: text('target_audience'),
    brandTone: text('brand_tone'),
    restrictedClaims: jsonb('restricted_claims')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // The cover image. A composite foreign key (workspace_id, primary_asset_id) -> assets keeps it
    // inside the same workspace; it is created in migration 0003 because Drizzle cannot type the
    // circular products <-> assets reference.
    primaryAssetId: uuid('primary_asset_id'),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(nowMs),
  },
  (t) => [
    unique('products_workspace_id_id_unique').on(t.workspaceId, t.id),
    check('products_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check('products_description_length', sql`char_length(${t.description}) <= 5000`),
    check('products_source_url_length', sql`char_length(${t.sourceUrl}) <= 2048`),
    check('products_target_audience_length', sql`char_length(${t.targetAudience}) <= 500`),
    check('products_brand_tone_length', sql`char_length(${t.brandTone}) <= 500`),
    check('products_status_check', sql`${t.status} in ('active', 'archived')`),
    check(
      'products_archived_consistent',
      sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`,
    ),
    check(
      'products_price_currency_check',
      sql`(${t.priceAmount} is null) = (${t.currency} is null)`,
    ),
    check('products_price_nonnegative', sql`${t.priceAmount} >= 0`),
    check('products_selling_points_array', sql`jsonb_typeof(${t.sellingPoints}) = 'array'`),
    check('products_restricted_claims_array', sql`jsonb_typeof(${t.restrictedClaims}) = 'array'`),
    check('products_version_positive', sql`${t.version} >= 1`),

    index('products_workspace_status_created_idx').on(
      t.workspaceId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

export const ASSET_TYPES = ['image', 'video'] as const;
export const ASSET_STATUSES = ['ready', 'deleted'] as const;
export const ASSET_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
] as const;

/**
 * Uploaded media (docs/04, D-037, D-038). An asset only exists once its bytes have been received
 * and checked, so there is no "pending" asset: pending uploads live in `upload_intents`. Assets
 * are soft-deleted; files are removed later by retention, never while a product still shows them.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    productId: uuid('product_id'),
    type: text('type').notNull(),
    status: text('status').notNull().default('ready'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    /** What the user called the file. Display only: never part of a storage key or a header. */
    originalFilename: text('original_filename').notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: text('storage_key').notNull(),
    thumbnailKey: text('thumbnail_key'),
    source: text('source').notNull().default('upload'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(nowMs),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('assets_workspace_id_id_unique').on(t.workspaceId, t.id),
    unique('assets_storage_key_unique').on(t.storageKey),
    foreignKey({
      name: 'assets_product_fk',
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }),
    check('assets_type_check', sql`${t.type} in ('image', 'video')`),
    check('assets_status_check', sql`${t.status} in ('ready', 'deleted')`),
    check(
      'assets_mime_check',
      sql`${t.mimeType} in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4')`,
    ),
    check(
      'assets_type_matches_mime',
      sql`(${t.type} = 'image' and ${t.mimeType} like 'image/%') or (${t.type} = 'video' and ${t.mimeType} like 'video/%')`,
    ),
    check('assets_size_positive', sql`${t.sizeBytes} > 0`),
    check('assets_filename_length', sql`char_length(${t.originalFilename}) between 1 and 255`),
    check('assets_sha256_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('assets_source_check', sql`${t.source} in ('upload', 'generated', 'imported')`),
    check(
      'assets_deleted_consistent',
      sql`(${t.status} = 'deleted') = (${t.deletedAt} is not null)`,
    ),
    check(
      'assets_dimensions_positive',
      sql`(${t.width} is null or ${t.width} > 0) and (${t.height} is null or ${t.height} > 0)`,
    ),
    index('assets_workspace_status_created_idx').on(
      t.workspaceId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('assets_workspace_product_idx').on(t.workspaceId, t.productId),
  ],
);

export const UPLOAD_STATUSES = ['pending', 'receiving', 'received', 'completed', 'failed'] as const;

/**
 * A permission to upload one file (D-038). The signed upload URL points at one intent; the
 * transfer moves it pending -> receiving -> received, and complete-upload turns it into an asset.
 * `asset_id` is chosen up front so the storage key is known before the bytes arrive.
 */
export const uploadIntents = pgTable(
  'upload_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    productId: uuid('product_id'),
    assetId: uuid('asset_id').notNull().unique(),
    declaredMime: text('declared_mime').notNull(),
    declaredSize: bigint('declared_size', { mode: 'number' }).notNull(),
    originalFilename: text('original_filename').notNull(),
    status: text('status').notNull().default('pending'),
    detectedMime: text('detected_mime'),
    receivedSize: bigint('received_size', { mode: 'number' }),
    sha256: char('sha256', { length: 64 }),
    storageKey: text('storage_key'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(nowMs),
  },
  (t) => [
    foreignKey({
      name: 'upload_intents_product_fk',
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }),
    check(
      'upload_intents_status_check',
      sql`${t.status} in ('pending', 'receiving', 'received', 'completed', 'failed')`,
    ),
    check(
      'upload_intents_mime_check',
      sql`${t.declaredMime} in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4')`,
    ),
    check('upload_intents_size_check', sql`${t.declaredSize} between 1 and 209715200`),
    check(
      'upload_intents_received_size_positive',
      sql`${t.receivedSize} is null or ${t.receivedSize} > 0`,
    ),
    check(
      'upload_intents_filename_length',
      sql`char_length(${t.originalFilename}) between 1 and 255`,
    ),
    index('upload_intents_workspace_status_idx').on(t.workspaceId, t.status),
    index('upload_intents_expires_idx').on(t.expiresAt),
  ],
);

export const CAMPAIGN_STATUSES = ['draft', 'active', 'archived'] as const;
export const PLATFORMS = ['tiktok', 'facebook', 'shopee', 'generic'] as const;

/**
 * A campaign: one product plus a template and generation settings (docs/04, D-046). The product
 * link is a composite foreign key, so the database refuses a product from another workspace.
 * `unique (workspace_id, id, product_id)` lets drafts prove they belong to the campaign's product.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    productId: uuid('product_id').notNull(),
    name: text('name').notNull(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    language: text('language').notNull(),
    tone: text('tone'),
    platform: text('platform').notNull().default('generic'),
    durationSeconds: integer('duration_seconds').notNull(),
    variants: integer('variants').notNull().default(1),
    status: text('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(nowMs),
  },
  (t) => [
    unique('campaigns_workspace_id_id_unique').on(t.workspaceId, t.id),
    unique('campaigns_workspace_id_id_product_unique').on(t.workspaceId, t.id, t.productId),
    foreignKey({
      name: 'campaigns_product_fk',
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }),
    check('campaigns_name_length', sql`char_length(${t.name}) between 1 and 120`),
    check('campaigns_template_id_length', sql`char_length(${t.templateId}) between 1 and 64`),
    check('campaigns_template_version_positive', sql`${t.templateVersion} >= 1`),
    check('campaigns_language_check', sql`${t.language} in ('th', 'en')`),
    check('campaigns_tone_length', sql`char_length(${t.tone}) <= 100`),
    check(
      'campaigns_platform_check',
      sql`${t.platform} in ('tiktok', 'facebook', 'shopee', 'generic')`,
    ),
    check('campaigns_duration_check', sql`${t.durationSeconds} between 5 and 180`),
    check('campaigns_variants_check', sql`${t.variants} between 1 and 3`),
    check('campaigns_status_check', sql`${t.status} in ('draft', 'active', 'archived')`),
    check('campaigns_version_positive', sql`${t.version} >= 1`),
    index('campaigns_workspace_status_created_idx').on(
      t.workspaceId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('campaigns_workspace_product_idx').on(t.workspaceId, t.productId),
  ],
);

export const DRAFT_STATUSES = ['draft', 'in_review', 'approved'] as const;

/**
 * One generated (and later edited) content draft of a campaign (docs/04, D-050). The composite
 * foreign key (workspace_id, campaign_id, product_id) keeps the draft inside the campaign's own
 * workspace AND product. `sections` and `section_state` are validated by the application against
 * the shared contract; the database only guarantees their JSON shape.
 */
export const contentDrafts = pgTable(
  'content_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    campaignId: uuid('campaign_id').notNull(),
    productId: uuid('product_id').notNull(),
    variantIndex: integer('variant_index').notNull().default(0),
    sections: jsonb('sections').notNull(),
    sectionState: jsonb('section_state').notNull(),
    claimWarnings: jsonb('claim_warnings')
      .notNull()
      .default(sql`'[]'::jsonb`),
    needsReview: boolean('needs_review').notNull().default(false),
    status: text('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(nowMs),
  },
  (t) => [
    unique('content_drafts_workspace_id_id_unique').on(t.workspaceId, t.id),
    foreignKey({
      name: 'content_drafts_campaign_fk',
      columns: [t.workspaceId, t.campaignId, t.productId],
      foreignColumns: [campaigns.workspaceId, campaigns.id, campaigns.productId],
    }),
    check('content_drafts_variant_check', sql`${t.variantIndex} between 0 and 2`),
    check('content_drafts_sections_object', sql`jsonb_typeof(${t.sections}) = 'object'`),
    check('content_drafts_section_state_object', sql`jsonb_typeof(${t.sectionState}) = 'object'`),
    check('content_drafts_claim_warnings_array', sql`jsonb_typeof(${t.claimWarnings}) = 'array'`),
    check('content_drafts_status_check', sql`${t.status} in ('draft', 'in_review', 'approved')`),
    check('content_drafts_version_positive', sql`${t.version} >= 1`),
    index('content_drafts_workspace_campaign_idx').on(
      t.workspaceId,
      t.campaignId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

export const JOB_TYPES = ['generate_brief', 'regenerate_section', 'export_package'] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
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

/**
 * Background jobs (docs/04, D-045 to D-048). The row is the source of truth; the queue only
 * carries the id. `unique (workspace_id, created_by, idempotency_key)` makes job creation
 * idempotent (D-047). The state checks below make impossible combinations unrepresentable
 * (a finished job without a finish time, a lease on a job that is not running, and so on).
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    type: text('type').notNull(),
    status: text('status').notNull().default('queued'),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    errorCode: text('error_code'),
    /** Safe to show to a user. Never holds provider payloads, URLs or secrets. */
    errorMessage: text('error_message'),
    provider: text('provider'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().default(nowMs),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    campaignId: uuid('campaign_id'),
    draftId: uuid('draft_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(nowMs),
  },
  (t) => [
    unique('jobs_workspace_id_id_unique').on(t.workspaceId, t.id),
    unique('jobs_idempotency_unique').on(t.workspaceId, t.createdBy, t.idempotencyKey),
    foreignKey({
      name: 'jobs_campaign_fk',
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }),
    foreignKey({
      name: 'jobs_draft_fk',
      columns: [t.workspaceId, t.draftId],
      foreignColumns: [contentDrafts.workspaceId, contentDrafts.id],
    }),
    check(
      'jobs_type_check',
      sql`${t.type} in ('generate_brief', 'regenerate_section', 'export_package')`,
    ),
    check(
      'jobs_status_check',
      sql`${t.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'jobs_error_code_check',
      sql`${t.errorCode} is null or ${t.errorCode} in ('PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'INVALID_PROVIDER_OUTPUT', 'PROVIDER_AUTH', 'PROVIDER_BUDGET', 'CONTENT_REFUSED', 'SECTION_CHANGED', 'ASSET_UNAVAILABLE', 'EXPORT_TOO_LARGE', 'CANCELLED', 'INTERNAL')`,
    ),
    check('jobs_error_message_length', sql`char_length(${t.errorMessage}) <= 500`),
    check('jobs_input_object', sql`jsonb_typeof(${t.input}) = 'object'`),
    check('jobs_output_object', sql`${t.output} is null or jsonb_typeof(${t.output}) = 'object'`),
    check('jobs_idempotency_key_format', sql`${t.idempotencyKey} ~ '^[A-Za-z0-9_-]{8,128}$'`),
    check('jobs_request_hash_format', sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
    check('jobs_max_attempts_check', sql`${t.maxAttempts} between 1 and 5`),
    check('jobs_attempts_check', sql`${t.attempts} between 0 and ${t.maxAttempts}`),
    check(
      'jobs_finished_consistent',
      sql`(${t.status} in ('succeeded', 'failed', 'cancelled')) = (${t.finishedAt} is not null)`,
    ),
    check('jobs_lease_only_when_running', sql`${t.lockedUntil} is null or ${t.status} = 'running'`),
    check(
      'jobs_output_only_when_succeeded',
      sql`(${t.status} = 'succeeded') = (${t.output} is not null)`,
    ),
    check(
      'jobs_error_only_when_unsuccessful',
      sql`(${t.errorCode} is null) or ${t.status} in ('failed', 'cancelled')`,
    ),
    check(
      'jobs_failed_has_error',
      sql`${t.status} <> 'failed' or (${t.errorCode} is not null and ${t.errorMessage} is not null)`,
    ),
    check(
      'jobs_target_matches_type',
      sql`(${t.type} = 'generate_brief' and ${t.campaignId} is not null) or (${t.type} = 'regenerate_section' and ${t.draftId} is not null) or (${t.type} = 'export_package' and ${t.draftId} is not null)`,
    ),
    index('jobs_claim_idx').on(t.status, t.runAfter),
    index('jobs_workspace_created_idx').on(t.workspaceId, t.createdAt.desc(), t.id.desc()),
    index('jobs_workspace_status_idx').on(t.workspaceId, t.status),
  ],
);

export const DRAFT_ASSET_ROLES = ['cover', 'media'] as const;

/**
 * Assets attached to a draft, in package order (D-067). Both foreign keys carry the workspace, so
 * an asset or a draft of another workspace cannot be linked. At most one cover per draft, at most
 * ten rows per draft (sort_order 0 to 9, unique per draft).
 */
export const draftAssets = pgTable(
  'draft_assets',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    draftId: uuid('draft_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    role: text('role').notNull().default('media'),
    sortOrder: integer('sort_order').notNull(),
    /** The storyboard scene this file is for (D-071), or null for a general attachment. */
    scene: text('scene'),
    /** True when the file was made by an AI tool; exports label it (D-068). */
    aiGenerated: boolean('ai_generated').notNull().default(false),
    /** Free text naming the tool, for example `Meta AI`. */
    generator: text('generator'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ name: 'draft_assets_pk', columns: [t.draftId, t.assetId] }),
    foreignKey({
      name: 'draft_assets_draft_fk',
      columns: [t.workspaceId, t.draftId],
      foreignColumns: [contentDrafts.workspaceId, contentDrafts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'draft_assets_asset_fk',
      columns: [t.workspaceId, t.assetId],
      foreignColumns: [assets.workspaceId, assets.id],
    }),
    unique('draft_assets_order_unique').on(t.draftId, t.sortOrder),
    check('draft_assets_role_check', sql`${t.role} in ('cover', 'media')`),
    check(
      'draft_assets_scene_check',
      sql`${t.scene} is null or ${t.scene} in ('product_hero', 'detail', 'usage', 'final_shot')`,
    ),
    check('draft_assets_generator_length', sql`char_length(${t.generator}) <= 60`),
    check('draft_assets_sort_order_check', sql`${t.sortOrder} between 0 and 9`),
    uniqueIndex('draft_assets_one_cover_idx')
      .on(t.draftId)
      .where(sql`${t.role} = 'cover'`),
    index('draft_assets_asset_idx').on(t.workspaceId, t.assetId),
  ],
);

export const EXPORT_STATUSES = ['ready', 'expired'] as const;

/**
 * A finished export package (D-067). The file lives in object storage under `storage_key`; the row
 * is written in the same transaction that settles the export job, so a row always has a finished
 * job. `expired` rows keep their metadata after the file is deleted.
 */
export const draftExports = pgTable(
  'draft_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    draftId: uuid('draft_id').notNull(),
    jobId: uuid('job_id').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('ready'),
    draftVersion: integer('draft_version').notNull(),
    fileCount: integer('file_count').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    filename: text('filename').notNull(),
    storageKey: text('storage_key').notNull(),
    manifest: jsonb('manifest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('draft_exports_workspace_id_id_unique').on(t.workspaceId, t.id),
    unique('draft_exports_job_unique').on(t.jobId),
    unique('draft_exports_storage_key_unique').on(t.storageKey),
    foreignKey({
      name: 'draft_exports_draft_fk',
      columns: [t.workspaceId, t.draftId],
      foreignColumns: [contentDrafts.workspaceId, contentDrafts.id],
    }),
    foreignKey({
      name: 'draft_exports_job_fk',
      columns: [t.workspaceId, t.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
    }),
    check('draft_exports_status_check', sql`${t.status} in ('ready', 'expired')`),
    check('draft_exports_counts_check', sql`${t.fileCount} >= 0 and ${t.sizeBytes} >= 0`),
    check('draft_exports_sha_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('draft_exports_manifest_object', sql`jsonb_typeof(${t.manifest}) = 'object'`),
    index('draft_exports_workspace_created_idx').on(t.workspaceId, t.createdAt.desc(), t.id.desc()),
    index('draft_exports_draft_idx').on(t.workspaceId, t.draftId),
    index('draft_exports_expiry_idx').on(t.status, t.expiresAt),
  ],
);

export const PROVIDER_PRESETS = ['openrouter', 'custom'] as const;

/**
 * The text provider a workspace chose (D-066). One row per workspace and purpose. The API key is
 * stored only as `key_encrypted` (AES-256-GCM, bound to the workspace id); `key_last4` is what the
 * screen may show. `pricing` and `monthly_cap_usd` feed the usage ledger (D-077).
 */
export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    purpose: text('purpose').notNull().default('text'),
    provider: text('provider').notNull(),
    baseUrl: text('base_url').notNull(),
    model: text('model').notNull(),
    keyEncrypted: text('key_encrypted').notNull(),
    keyLast4: text('key_last4').notNull().default(''),
    pricing: jsonb('pricing'),
    monthlyCapUsd: numeric('monthly_cap_usd', { precision: 12, scale: 2 }),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(nowMs),
  },
  (t) => [
    unique('provider_credentials_workspace_purpose_unique').on(t.workspaceId, t.purpose),
    check('provider_credentials_purpose_check', sql`${t.purpose} = 'text'`),
    check('provider_credentials_provider_check', sql`${t.provider} in ('openrouter', 'custom')`),
    check('provider_credentials_version_check', sql`${t.version} >= 1`),
    check(
      'provider_credentials_pricing_object',
      sql`${t.pricing} is null or jsonb_typeof(${t.pricing}) = 'object'`,
    ),
    check(
      'provider_credentials_cap_check',
      sql`${t.monthlyCapUsd} is null or ${t.monthlyCapUsd} >= 0`,
    ),
  ],
);

export const USAGE_STATUSES = ['reserved', 'settled', 'released'] as const;
export const USAGE_COST_SOURCES = ['reported', 'computed', 'reserved'] as const;

/**
 * One provider call, recorded before it is made (D-077). `reserved_usd` is the worst case that was
 * set aside under the workspace lock; `cost_usd` is what the call turned out to cost. Nothing here
 * holds prompts, product text or outputs. A call that crashed before settling stays `reserved` and
 * keeps counting at its worst case, so the monthly limit fails closed.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    jobId: uuid('job_id').notNull(),
    attempt: integer('attempt').notNull(),
    callIndex: integer('call_index').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull().default('reserved'),
    requests: integer('requests').notNull().default(1),
    inputUnits: integer('input_units').notNull().default(0),
    outputUnits: integer('output_units').notNull().default(0),
    reservedUsd: numeric('reserved_usd', { precision: 14, scale: 6 }).notNull().default('0'),
    costUsd: numeric('cost_usd', { precision: 14, scale: 6 }),
    costSource: text('cost_source'),
    /** True when the provider's reported cost was far above what the owner's prices predict. */
    anomaly: boolean('anomaly').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(nowMs),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    unique('usage_events_call_unique').on(t.jobId, t.attempt, t.callIndex),
    foreignKey({
      name: 'usage_events_job_fk',
      columns: [t.workspaceId, t.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
    }),
    check('usage_events_status_check', sql`${t.status} in ('reserved', 'settled', 'released')`),
    check(
      'usage_events_source_check',
      sql`${t.costSource} is null or ${t.costSource} in ('reported', 'computed', 'reserved')`,
    ),
    check(
      'usage_events_amounts_check',
      sql`${t.requests} >= 0 and ${t.inputUnits} >= 0 and ${t.outputUnits} >= 0 and ${t.reservedUsd} >= 0 and (${t.costUsd} is null or ${t.costUsd} >= 0)`,
    ),
    check(
      'usage_events_settled_check',
      sql`(${t.status} = 'reserved' and ${t.settledAt} is null) or (${t.status} <> 'reserved' and ${t.settledAt} is not null)`,
    ),
    index('usage_events_workspace_month_idx').on(t.workspaceId, t.createdAt),
  ],
);
