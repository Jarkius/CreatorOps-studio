ALTER TABLE "draft_assets" ADD COLUMN "scene" text;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD COLUMN "ai_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD COLUMN "generator" text;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_scene_check" CHECK ("draft_assets"."scene" is null or "draft_assets"."scene" in ('product_hero', 'detail', 'usage', 'final_shot'));--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_generator_length" CHECK (char_length("draft_assets"."generator") <= 60);