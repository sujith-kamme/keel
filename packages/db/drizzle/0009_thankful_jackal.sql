CREATE TABLE "console_account" (
	"id" integer PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "console_account_single_row" CHECK ("console_account"."id" = 1)
);
--> statement-breakpoint
-- Demo payer identities move off demo.keel.test (hand-written). The ledger and past sessions keep the old addresses.
UPDATE "store_orders" SET "payer_email" = 'maya@gmail.com' WHERE "payer_email" = 'maya@demo.keel.test';--> statement-breakpoint
UPDATE "store_orders" SET "payer_email" = 'sam@gmail.com' WHERE "payer_email" = 'sam@demo.keel.test';
