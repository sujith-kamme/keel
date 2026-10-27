CREATE TABLE "catalog_items" (
	"sku" text PRIMARY KEY NOT NULL,
	"channel3_id" text NOT NULL,
	"title" text NOT NULL,
	"image_url" text,
	"list_price" text NOT NULL,
	"min_price" text NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "catalog_items_channel3_id_unique" UNIQUE("channel3_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"claimed_email" text NOT NULL,
	"order_ids" jsonb NOT NULL,
	"verified_payer" text,
	"otp_hash" text NOT NULL,
	"otp_expires_at" timestamp with time zone NOT NULL,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_orders" (
	"order_id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"scenario" text NOT NULL,
	"payer_email" text NOT NULL,
	"currency" text NOT NULL,
	"total" text NOT NULL,
	"items" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_orders_scenario_unique" UNIQUE("scenario")
);
