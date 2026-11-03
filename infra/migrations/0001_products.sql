CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_url" text,
	"price_amount" numeric(12, 2),
	"currency" char(3),
	"selling_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_audience" text,
	"brand_tone" text,
	"restricted_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "products_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "products_name_length" CHECK (char_length("products"."name") between 1 and 200),
	CONSTRAINT "products_description_length" CHECK (char_length("products"."description") <= 5000),
	CONSTRAINT "products_source_url_length" CHECK (char_length("products"."source_url") <= 2048),
	CONSTRAINT "products_target_audience_length" CHECK (char_length("products"."target_audience") <= 500),
	CONSTRAINT "products_brand_tone_length" CHECK (char_length("products"."brand_tone") <= 500),
	CONSTRAINT "products_status_check" CHECK ("products"."status" in ('active', 'archived')),
	CONSTRAINT "products_archived_consistent" CHECK (("products"."status" = 'archived') = ("products"."archived_at" is not null)),
	CONSTRAINT "products_price_currency_check" CHECK (("products"."price_amount" is null) = ("products"."currency" is null)),
	CONSTRAINT "products_price_nonnegative" CHECK ("products"."price_amount" >= 0),
	CONSTRAINT "products_selling_points_array" CHECK (jsonb_typeof("products"."selling_points") = 'array'),
	CONSTRAINT "products_restricted_claims_array" CHECK (jsonb_typeof("products"."restricted_claims") = 'array'),
	CONSTRAINT "products_version_positive" CHECK ("products"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_workspace_status_created_idx" ON "products" USING btree ("workspace_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);