CREATE TABLE "gauntlet_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"pack" text NOT NULL,
	"kind" text NOT NULL,
	"repeat" integer NOT NULL,
	"session_id" text,
	"outcome" text NOT NULL,
	"triggered" boolean NOT NULL,
	"leaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gauntlet_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"guarded" boolean NOT NULL,
	"packs" jsonb NOT NULL,
	"repeats" integer NOT NULL,
	"versions" jsonb NOT NULL,
	"progress" jsonb DEFAULT '{"total":0,"done":0}'::jsonb NOT NULL,
	"scorecard" jsonb,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gauntlet_scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"pack" text NOT NULL,
	"body" jsonb NOT NULL,
	"source" text NOT NULL,
	"source_session_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gauntlet_results" ADD CONSTRAINT "gauntlet_results_run_id_gauntlet_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."gauntlet_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gauntlet_results_run_scenario_repeat_idx" ON "gauntlet_results" USING btree ("run_id","scenario_id","repeat");--> statement-breakpoint
CREATE INDEX "gauntlet_results_run_idx" ON "gauntlet_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "gauntlet_runs_created_idx" ON "gauntlet_runs" USING btree ("created_at");