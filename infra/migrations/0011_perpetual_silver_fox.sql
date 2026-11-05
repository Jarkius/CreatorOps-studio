CREATE TABLE "campaign_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"scene" text,
	"label" text NOT NULL,
	"amount_thb" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "campaign_costs_scene_check" CHECK ("campaign_costs"."scene" is null or "campaign_costs"."scene" in ('product_hero', 'detail', 'usage', 'final_shot')),
	CONSTRAINT "campaign_costs_label_length" CHECK (char_length("campaign_costs"."label") between 1 and 80),
	CONSTRAINT "campaign_costs_amount_range" CHECK ("campaign_costs"."amount_thb" > 0 and "campaign_costs"."amount_thb" <= 1000000)
);
--> statement-breakpoint
ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_costs_campaign_idx" ON "campaign_costs" USING btree ("workspace_id","campaign_id","created_at");