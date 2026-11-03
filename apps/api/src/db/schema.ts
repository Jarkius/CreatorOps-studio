import { sql } from 'drizzle-orm';
import {
  bigint,
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
      'upload_intents_filename_length',
      sql`char_length(${t.originalFilename}) between 1 and 255`,
    ),
    index('upload_intents_workspace_status_idx').on(t.workspaceId, t.status),
    index('upload_intents_expires_idx').on(t.expiresAt),
  ],
);
