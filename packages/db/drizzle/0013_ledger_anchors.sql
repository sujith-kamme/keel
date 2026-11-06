CREATE TABLE "ledger_anchors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"hash" text NOT NULL,
	"tsa" text NOT NULL,
	"token" "bytea" NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ledger_anchors_seq_idx" ON "ledger_anchors" USING btree ("seq");