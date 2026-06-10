CREATE TYPE "public"."substitute_request_status" AS ENUM('pending', 'answered', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."substitute_response_kind" AS ENUM('alternative', 'free_text', 'none');--> statement-breakpoint
CREATE TABLE "item_sync_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"op" text NOT NULL,
	"seq" integer NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "substitute_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"status" "substitute_request_status" DEFAULT 'pending' NOT NULL,
	"response_kind" "substitute_response_kind",
	"response_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "item_sync_ops" ADD CONSTRAINT "item_sync_ops_item_id_list_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."list_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_item_id_list_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."list_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_run_id_shopping_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."shopping_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_sync_ops_dedupe" ON "item_sync_ops" USING btree ("item_id","op","seq");--> statement-breakpoint
CREATE INDEX "substitute_requests_item" ON "substitute_requests" USING btree ("item_id");