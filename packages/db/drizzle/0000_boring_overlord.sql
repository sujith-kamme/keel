CREATE TABLE "ledger_entries" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"session_id" text,
	"order_id" text,
	"capture_id" text,
	"dispute_id" text,
	"mode" text NOT NULL,
	"verdict" text NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"approved_text" text NOT NULL,
	"rules" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_decision_idx" ON "ledger_entries" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "ledger_session_idx" ON "ledger_entries" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ledger_order_idx" ON "ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_capture_idx" ON "ledger_entries" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "ledger_dispute_idx" ON "ledger_entries" USING btree ("dispute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_version_idx" ON "policies" USING btree ("policy_id","version");