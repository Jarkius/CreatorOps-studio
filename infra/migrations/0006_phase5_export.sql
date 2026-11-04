CREATE TABLE "draft_assets" (
	"workspace_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" text DEFAULT 'media' NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "draft_assets_pk" PRIMARY KEY("draft_id","asset_id"),
	CONSTRAINT "draft_assets_order_unique" UNIQUE("draft_id","sort_order"),
	CONSTRAINT "draft_assets_role_check" CHECK ("draft_assets"."role" in ('cover', 'media')),
	CONSTRAINT "draft_assets_sort_order_check" CHECK ("draft_assets"."sort_order" between 0 and 9)
);
--> statement-breakpoint
CREATE TABLE "draft_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"draft_version" integer NOT NULL,
	"file_count" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "draft_exports_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "draft_exports_job_unique" UNIQUE("job_id"),
	CONSTRAINT "draft_exports_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "draft_exports_status_check" CHECK ("draft_exports"."status" in ('ready', 'expired')),
	CONSTRAINT "draft_exports_counts_check" CHECK ("draft_exports"."file_count" >= 0 and "draft_exports"."size_bytes" >= 0),
	CONSTRAINT "draft_exports_sha_format" CHECK ("draft_exports"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "draft_exports_manifest_object" CHECK (jsonb_typeof("draft_exports"."manifest") = 'object')
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_error_code_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_target_matches_type";--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_draft_fk" FOREIGN KEY ("workspace_id","draft_id") REFERENCES "public"."content_drafts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_asset_fk" FOREIGN KEY ("workspace_id","asset_id") REFERENCES "public"."assets"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_exports" ADD CONSTRAINT "draft_exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_exports" ADD CONSTRAINT "draft_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_exports" ADD CONSTRAINT "draft_exports_draft_fk" FOREIGN KEY ("workspace_id","draft_id") REFERENCES "public"."content_drafts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_exports" ADD CONSTRAINT "draft_exports_job_fk" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."jobs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_assets_one_cover_idx" ON "draft_assets" USING btree ("draft_id") WHERE "draft_assets"."role" = 'cover';--> statement-breakpoint
CREATE INDEX "draft_assets_asset_idx" ON "draft_assets" USING btree ("workspace_id","asset_id");--> statement-breakpoint
CREATE INDEX "draft_exports_workspace_created_idx" ON "draft_exports" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "draft_exports_draft_idx" ON "draft_exports" USING btree ("workspace_id","draft_id");--> statement-breakpoint
CREATE INDEX "draft_exports_expiry_idx" ON "draft_exports" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_brief', 'regenerate_section', 'export_package'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_error_code_check" CHECK ("jobs"."error_code" is null or "jobs"."error_code" in ('PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'INVALID_PROVIDER_OUTPUT', 'CONTENT_REFUSED', 'SECTION_CHANGED', 'ASSET_UNAVAILABLE', 'EXPORT_TOO_LARGE', 'CANCELLED', 'INTERNAL'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_target_matches_type" CHECK (("jobs"."type" = 'generate_brief' and "jobs"."campaign_id" is not null) or ("jobs"."type" = 'regenerate_section' and "jobs"."draft_id" is not null) or ("jobs"."type" = 'export_package' and "jobs"."draft_id" is not null));