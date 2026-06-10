CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."balance_state" AS ENUM('owed', 'partially_paid', 'paid', 'waived');--> statement-breakpoint
CREATE TYPE "public"."issue_kind" AS ENUM('out_of_stock', 'not_found', 'substituted', 'price_surprise', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('communal', 'personal');--> statement-breakpoint
CREATE TYPE "public"."item_state" AS ENUM('pending', 'in_cart', 'purchased', 'archived');--> statement-breakpoint
CREATE TYPE "public"."line_resolution" AS ENUM('auto_matched', 'manually_matched', 'assigned_communal', 'assigned_personal', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."meal_state" AS ENUM('proposed', 'approved', 'confirmed', 'cooked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_state" AS ENUM('draft', 'open', 'locked', 'reconciling', 'settling', 'closed');--> statement-breakpoint
CREATE TYPE "public"."store_section" AS ENUM('produce', 'dairy', 'meat', 'bakery', 'dry_goods', 'frozen', 'household', 'other');--> statement-breakpoint
CREATE TABLE "balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"state" "balance_state" DEFAULT 'owed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "houses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"meal_days" integer[] DEFAULT '{0,2,4}'::int[] NOT NULL,
	"shopping_day" integer DEFAULT 0 NOT NULL,
	"split_excludes_shopper" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"house_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" uuid
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"quantity" numeric,
	"unit" text,
	"kind" "item_kind" NOT NULL,
	"state" "item_state" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"store_pref" uuid,
	"section" "store_section" DEFAULT 'other' NOT NULL,
	"source_meal_id" uuid,
	"alternatives" text[] DEFAULT '{}'::text[] NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_cooks" (
	"meal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	CONSTRAINT "meal_cooks_meal_id_user_id_pk" PRIMARY KEY("meal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"house_id" uuid NOT NULL,
	"date" date NOT NULL,
	"state" "meal_state" DEFAULT 'proposed' NOT NULL,
	"dish_title" text,
	"servings" integer,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_deadline" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"house_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"is_kitchen_head" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "memberships_house_id_user_id_pk" PRIMARY KEY("house_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"proof_image_path" text NOT NULL,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"house_id" uuid NOT NULL,
	"store_id" uuid,
	"item_name" text NOT NULL,
	"unit_price_cents" integer,
	"total_cents" integer NOT NULL,
	"quantity" numeric,
	"purchased_at" timestamp with time zone NOT NULL,
	"receipt_line_id" uuid
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	CONSTRAINT "push_subscriptions_user_id_endpoint_pk" PRIMARY KEY("user_id","endpoint")
);
--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"parsed_name" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"unit_price_cents" integer,
	"total_cents" integer NOT NULL,
	"is_discount" boolean DEFAULT false NOT NULL,
	"is_fee" boolean DEFAULT false NOT NULL,
	"matched_item_id" uuid,
	"match_confidence" real,
	"resolution" "line_resolution",
	"resolved_kind" "item_kind",
	"resolved_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"store_id" uuid,
	"image_path" text NOT NULL,
	"purchased_at" timestamp with time zone,
	"subtotal_cents" integer,
	"tax_cents" integer,
	"total_cents" integer,
	"gemini_raw" jsonb,
	"delete_after" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"shopper_id" uuid NOT NULL,
	"communal_total_cents" integer NOT NULL,
	"split_member_ids" uuid[] NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "shopper_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid,
	"kind" "issue_kind" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"house_id" uuid NOT NULL,
	"state" "run_state" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"shopper_id" uuid,
	"locked_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"house_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"full_name" text NOT NULL,
	"venmo_handle" text,
	"zelle_contact" text,
	"allergens" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferences" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_debtor_id_users_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_run_id_shopping_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."shopping_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_store_pref_stores_id_fk" FOREIGN KEY ("store_pref") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_source_meal_id_meals_id_fk" FOREIGN KEY ("source_meal_id") REFERENCES "public"."meals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_cooks" ADD CONSTRAINT "meal_cooks_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_cooks" ADD CONSTRAINT "meal_cooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_balance_id_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_ledger" ADD CONSTRAINT "purchase_ledger_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_ledger" ADD CONSTRAINT "purchase_ledger_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_ledger" ADD CONSTRAINT "purchase_ledger_receipt_line_id_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_matched_item_id_list_items_id_fk" FOREIGN KEY ("matched_item_id") REFERENCES "public"."list_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_resolved_user_id_users_id_fk" FOREIGN KEY ("resolved_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_run_id_shopping_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."shopping_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_run_id_shopping_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."shopping_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_shopper_id_users_id_fk" FOREIGN KEY ("shopper_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_issues" ADD CONSTRAINT "shopper_issues_run_id_shopping_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."shopping_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_issues" ADD CONSTRAINT "shopper_issues_item_id_list_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."list_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_runs" ADD CONSTRAINT "shopping_runs_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_runs" ADD CONSTRAINT "shopping_runs_shopper_id_users_id_fk" FOREIGN KEY ("shopper_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balances_settlement_debtor" ON "balances" USING btree ("settlement_id","debtor_id");--> statement-breakpoint
CREATE INDEX "list_items_run_state" ON "list_items" USING btree ("run_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "list_items_client_dedupe" ON "list_items" USING btree ("run_id","client_id") WHERE client_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "list_items_trgm" ON "list_items" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ledger_item_store" ON "purchase_ledger" USING btree ("house_id","item_name","store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_run_per_house" ON "shopping_runs" USING btree ("house_id") WHERE state <> 'closed';