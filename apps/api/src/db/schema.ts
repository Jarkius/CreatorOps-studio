import { sql } from 'drizzle-orm';
import {
  char,
  check,
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
