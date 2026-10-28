CREATE TABLE "agent_controls" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
