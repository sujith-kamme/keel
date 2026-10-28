CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text,
	"order_id" text,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"stage" text,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"classification" text,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"injection" text,
	"action" text,
	"action_error" text,
	"outcome" text DEFAULT 'OPEN' NOT NULL,
	"evidence_type" text,
	"evidence_notes" text,
	"evidence_pdf" "bytea",
	"evidence_sha256" text,
	"decision_id" text,
	"paypal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "disputes_capture_idx" ON "disputes" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "disputes_updated_idx" ON "disputes" USING btree ("updated_at");