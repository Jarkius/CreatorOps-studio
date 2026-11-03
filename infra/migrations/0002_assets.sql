CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"original_filename" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "assets_type_check" CHECK ("assets"."type" in ('image', 'video')),
	CONSTRAINT "assets_status_check" CHECK ("assets"."status" in ('ready', 'deleted')),
	CONSTRAINT "assets_mime_check" CHECK ("assets"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4')),
	CONSTRAINT "assets_type_matches_mime" CHECK (("assets"."type" = 'image' and "assets"."mime_type" like 'image/%') or ("assets"."type" = 'video' and "assets"."mime_type" like 'video/%')),
	CONSTRAINT "assets_size_positive" CHECK ("assets"."size_bytes" > 0),
	CONSTRAINT "assets_filename_length" CHECK (char_length("assets"."original_filename") between 1 and 255),
	CONSTRAINT "assets_sha256_format" CHECK ("assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assets_source_check" CHECK ("assets"."source" in ('upload', 'generated', 'imported')),
	CONSTRAINT "assets_deleted_consistent" CHECK (("assets"."status" = 'deleted') = ("assets"."deleted_at" is not null)),
	CONSTRAINT "assets_dimensions_positive" CHECK (("assets"."width" is null or "assets"."width" > 0) and ("assets"."height" is null or "assets"."height" > 0))
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid,
	"asset_id" uuid NOT NULL,
	"declared_mime" text NOT NULL,
	"declared_size" bigint NOT NULL,
	"original_filename" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detected_mime" text,
	"received_size" bigint,
	"sha256" char(64),
	"storage_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "upload_intents_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "upload_intents_status_check" CHECK ("upload_intents"."status" in ('pending', 'receiving', 'received', 'completed', 'failed')),
	CONSTRAINT "upload_intents_mime_check" CHECK ("upload_intents"."declared_mime" in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4')),
	CONSTRAINT "upload_intents_size_check" CHECK ("upload_intents"."declared_size" between 1 and 209715200),
	CONSTRAINT "upload_intents_filename_length" CHECK (char_length("upload_intents"."original_filename") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "primary_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_workspace_status_created_idx" ON "assets" USING btree ("workspace_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "assets_workspace_product_idx" ON "assets" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "upload_intents_workspace_status_idx" ON "upload_intents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "upload_intents_expires_idx" ON "upload_intents" USING btree ("expires_at");