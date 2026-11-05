CREATE TABLE "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purpose" text DEFAULT 'text' NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"key_encrypted" text NOT NULL,
	"key_last4" text DEFAULT '' NOT NULL,
	"pricing" jsonb,
	"monthly_cap_usd" numeric(12, 2),
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "provider_credentials_workspace_purpose_unique" UNIQUE("workspace_id","purpose"),
	CONSTRAINT "provider_credentials_purpose_check" CHECK ("provider_credentials"."purpose" = 'text'),
	CONSTRAINT "provider_credentials_provider_check" CHECK ("provider_credentials"."provider" in ('openrouter', 'custom')),
	CONSTRAINT "provider_credentials_version_check" CHECK ("provider_credentials"."version" >= 1),
	CONSTRAINT "provider_credentials_pricing_object" CHECK ("provider_credentials"."pricing" is null or jsonb_typeof("provider_credentials"."pricing") = 'object'),
	CONSTRAINT "provider_credentials_cap_check" CHECK ("provider_credentials"."monthly_cap_usd" is null or "provider_credentials"."monthly_cap_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;