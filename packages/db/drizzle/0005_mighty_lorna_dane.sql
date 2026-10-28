ALTER TABLE "sessions" ADD COLUMN "mode" text DEFAULT 'LIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "guard_mode" text DEFAULT 'ENFORCE' NOT NULL;