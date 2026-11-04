CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"language" text NOT NULL,
	"tone" text,
	"platform" text DEFAULT 'generic' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"variants" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "campaigns_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "campaigns_workspace_id_id_product_unique" UNIQUE("workspace_id","id","product_id"),
	CONSTRAINT "campaigns_name_length" CHECK (char_length("campaigns"."name") between 1 and 120),
	CONSTRAINT "campaigns_template_id_length" CHECK (char_length("campaigns"."template_id") between 1 and 64),
	CONSTRAINT "campaigns_template_version_positive" CHECK ("campaigns"."template_version" >= 1),
	CONSTRAINT "campaigns_language_check" CHECK ("campaigns"."language" in ('th', 'en')),
	CONSTRAINT "campaigns_tone_length" CHECK (char_length("campaigns"."tone") <= 100),
	CONSTRAINT "campaigns_platform_check" CHECK ("campaigns"."platform" in ('tiktok', 'facebook', 'shopee', 'generic')),
	CONSTRAINT "campaigns_duration_check" CHECK ("campaigns"."duration_seconds" between 5 and 180),
	CONSTRAINT "campaigns_variants_check" CHECK ("campaigns"."variants" between 1 and 3),
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "campaigns_version_positive" CHECK ("campaigns"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_index" integer DEFAULT 0 NOT NULL,
	"sections" jsonb NOT NULL,
	"section_state" jsonb NOT NULL,
	"claim_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "content_drafts_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "content_drafts_variant_check" CHECK ("content_drafts"."variant_index" between 0 and 2),
	CONSTRAINT "content_drafts_sections_object" CHECK (jsonb_typeof("content_drafts"."sections") = 'object'),
	CONSTRAINT "content_drafts_section_state_object" CHECK (jsonb_typeof("content_drafts"."section_state") = 'object'),
	CONSTRAINT "content_drafts_claim_warnings_array" CHECK (jsonb_typeof("content_drafts"."claim_warnings") = 'array'),
	CONSTRAINT "content_drafts_status_check" CHECK ("content_drafts"."status" in ('draft', 'in_review', 'approved')),
	CONSTRAINT "content_drafts_version_positive" CHECK ("content_drafts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error_code" text,
	"error_message" text,
	"provider" text,
	"created_by" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" char(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"locked_until" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"campaign_id" uuid,
	"draft_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "jobs_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "jobs_idempotency_unique" UNIQUE("workspace_id","created_by","idempotency_key"),
	CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_brief', 'regenerate_section')),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_error_code_check" CHECK ("jobs"."error_code" is null or "jobs"."error_code" in ('PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'INVALID_PROVIDER_OUTPUT', 'CONTENT_REFUSED', 'SECTION_CHANGED', 'CANCELLED', 'INTERNAL')),
	CONSTRAINT "jobs_error_message_length" CHECK (char_length("jobs"."error_message") <= 500),
	CONSTRAINT "jobs_input_object" CHECK (jsonb_typeof("jobs"."input") = 'object'),
	CONSTRAINT "jobs_output_object" CHECK ("jobs"."output" is null or jsonb_typeof("jobs"."output") = 'object'),
	CONSTRAINT "jobs_idempotency_key_format" CHECK ("jobs"."idempotency_key" ~ '^[A-Za-z0-9_-]{8,128}$'),
	CONSTRAINT "jobs_request_hash_format" CHECK ("jobs"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "jobs_max_attempts_check" CHECK ("jobs"."max_attempts" between 1 and 5),
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" between 0 and "jobs"."max_attempts"),
	CONSTRAINT "jobs_finished_consistent" CHECK (("jobs"."status" in ('succeeded', 'failed', 'cancelled')) = ("jobs"."finished_at" is not null)),
	CONSTRAINT "jobs_lease_only_when_running" CHECK ("jobs"."locked_until" is null or "jobs"."status" = 'running'),
	CONSTRAINT "jobs_output_only_when_succeeded" CHECK (("jobs"."status" = 'succeeded') = ("jobs"."output" is not null)),
	CONSTRAINT "jobs_error_only_when_unsuccessful" CHECK (("jobs"."error_code" is null) or "jobs"."status" in ('failed', 'cancelled')),
	CONSTRAINT "jobs_failed_has_error" CHECK ("jobs"."status" <> 'failed' or ("jobs"."error_code" is not null and "jobs"."error_message" is not null)),
	CONSTRAINT "jobs_target_matches_type" CHECK (("jobs"."type" = 'generate_brief' and "jobs"."campaign_id" is not null) or ("jobs"."type" = 'regenerate_section' and "jobs"."draft_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id","product_id") REFERENCES "public"."campaigns"("workspace_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_draft_fk" FOREIGN KEY ("workspace_id","draft_id") REFERENCES "public"."content_drafts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_workspace_status_created_idx" ON "campaigns" USING btree ("workspace_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "campaigns_workspace_product_idx" ON "campaigns" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "content_drafts_workspace_campaign_idx" ON "content_drafts" USING btree ("workspace_id","campaign_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_workspace_created_idx" ON "jobs" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_workspace_status_idx" ON "jobs" USING btree ("workspace_id","status");