CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"call_index" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"requests" integer DEFAULT 1 NOT NULL,
	"input_units" integer DEFAULT 0 NOT NULL,
	"output_units" integer DEFAULT 0 NOT NULL,
	"reserved_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(14, 6),
	"cost_source" text,
	"anomaly" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "usage_events_call_unique" UNIQUE("job_id","attempt","call_index"),
	CONSTRAINT "usage_events_status_check" CHECK ("usage_events"."status" in ('reserved', 'settled', 'released')),
	CONSTRAINT "usage_events_source_check" CHECK ("usage_events"."cost_source" is null or "usage_events"."cost_source" in ('reported', 'computed', 'reserved')),
	CONSTRAINT "usage_events_amounts_check" CHECK ("usage_events"."requests" >= 0 and "usage_events"."input_units" >= 0 and "usage_events"."output_units" >= 0 and "usage_events"."reserved_usd" >= 0 and ("usage_events"."cost_usd" is null or "usage_events"."cost_usd" >= 0)),
	CONSTRAINT "usage_events_settled_check" CHECK (("usage_events"."status" = 'reserved' and "usage_events"."settled_at" is null) or ("usage_events"."status" <> 'reserved' and "usage_events"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_job_fk" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."jobs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_workspace_month_idx" ON "usage_events" USING btree ("workspace_id","created_at");