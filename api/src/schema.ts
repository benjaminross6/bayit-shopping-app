// Database schema — mirrors SDD §3.2. Keep the SDD updated when this changes.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ============ Enums (SDD §3.1) ============

export const runState = pgEnum("run_state", [
  "draft",
  "open",
  "locked",
  "reconciling",
  "settling",
  "closed",
]);

export const itemState = pgEnum("item_state", [
  "pending",
  "in_cart",
  "purchased",
  "archived",
]);

export const itemKind = pgEnum("item_kind", ["communal", "personal"]);

export const balanceState = pgEnum("balance_state", [
  "owed",
  "partially_paid",
  "paid",
  "waived",
]);

export const lineResolution = pgEnum("line_resolution", [
  "auto_matched",
  "manually_matched",
  "assigned_communal",
  "assigned_personal",
  "skipped",
]);

export const issueKind = pgEnum("issue_kind", [
  "out_of_stock",
  "not_found",
  "substituted",
  "price_surprise",
  "other",
]);

export const storeSection = pgEnum("store_section", [
  "produce",
  "dairy",
  "meat",
  "bakery",
  "dry_goods",
  "frozen",
  "household",
  "other",
]);

export const mealState = pgEnum("meal_state", [
  "proposed",
  "approved",
  "confirmed",
  "cooked",
  "cancelled",
]);

// ============ Tenancy & people ============

export const houses = pgTable("houses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // 0=Sun,2=Tue,4=Thu (Brief Q7)
  mealDays: integer("meal_days").array().notNull().default(sql`'{0,2,4}'::int[]`),
  shoppingDay: integer("shopping_day").notNull().default(0),
  splitExcludesShopper: boolean("split_excludes_shopper").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  fullName: text("full_name").notNull(),
  venmoHandle: text("venmo_handle"),
  zelleContact: text("zelle_contact"),
  allergens: text("allergens").array().notNull().default(sql`'{}'::text[]`),
  preferences: text("preferences").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    houseId: uuid("house_id").notNull().references(() => houses.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    isAdmin: boolean("is_admin").notNull().default(false),
    isManager: boolean("is_manager").notNull().default(false),
    isKitchenHead: boolean("is_kitchen_head").notNull().default(false),
    // false = excluded from future splits; login + balances retained (Q16, Q47)
    active: boolean("active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.houseId, t.userId] })],
);

export const invites = pgTable("invites", {
  token: uuid("token").primaryKey().defaultRandom(),
  houseId: uuid("house_id").notNull().references(() => houses.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedBy: uuid("used_by").references(() => users.id),
});

// ============ Stores ============

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  houseId: uuid("house_id").notNull().references(() => houses.id),
  name: text("name").notNull(),
});

// ============ Shopping runs & list ============

export const shoppingRuns = pgTable(
  "shopping_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    houseId: uuid("house_id").notNull().references(() => houses.id),
    state: runState("state").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    shopperId: uuid("shopper_id").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One non-closed run per house (SDD failure mode #13)
    uniqueIndex("one_active_run_per_house")
      .on(t.houseId)
      .where(sql`state <> 'closed'`),
  ],
);

export const listItems = pgTable(
  "list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => shoppingRuns.id),
    requesterId: uuid("requester_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    quantity: numeric("quantity"),
    unit: text("unit"),
    kind: itemKind("kind").notNull(),
    state: itemState("state").notNull().default("pending"),
    notes: text("notes"),
    storePref: uuid("store_pref").references(() => stores.id),
    section: storeSection("section").notNull().default("other"),
    sourceMealId: uuid("source_meal_id").references(() => meals.id),
    alternatives: text("alternatives").array().notNull().default(sql`'{}'::text[]`),
    // Idempotency key for offline sync replay
    clientId: text("client_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("list_items_run_state").on(t.runId, t.state),
    uniqueIndex("list_items_client_dedupe")
      .on(t.runId, t.clientId)
      .where(sql`client_id IS NOT NULL`),
    // Trigram index for fuzzy dedupe (Q23); pg_trgm enabled in migration SQL
    index("list_items_trgm").using("gin", sql`${t.normalizedName} gin_trgm_ops`),
  ],
);

export const shopperIssues = pgTable("shopper_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => shoppingRuns.id),
  itemId: uuid("item_id").references(() => listItems.id),
  kind: issueKind("kind").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============ Receipts & reconciliation ============

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => shoppingRuns.id),
  storeId: uuid("store_id").references(() => stores.id),
  imagePath: text("image_path").notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  subtotalCents: integer("subtotal_cents"),
  taxCents: integer("tax_cents"),
  totalCents: integer("total_cents"),
  // Full structured Gemini response, audit trail (SDD §6)
  geminiRaw: jsonb("gemini_raw"),
  // Semester end + 90 days (Q61)
  deleteAfter: date("delete_after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receiptLines = pgTable("receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  rawText: text("raw_text").notNull(),
  parsedName: text("parsed_name").notNull(),
  quantity: numeric("quantity").notNull().default("1"),
  unitPriceCents: integer("unit_price_cents"),
  // Negative for discounts
  totalCents: integer("total_cents").notNull(),
  isDiscount: boolean("is_discount").notNull().default(false),
  isFee: boolean("is_fee").notNull().default(false),
  matchedItemId: uuid("matched_item_id").references(() => listItems.id),
  matchConfidence: real("match_confidence"),
  // NULL = unresolved
  resolution: lineResolution("resolution"),
  resolvedKind: itemKind("resolved_kind"),
  resolvedUserId: uuid("resolved_user_id").references(() => users.id),
});

// ============ Settlement ============

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  // One settlement per run (Q40)
  runId: uuid("run_id").notNull().unique().references(() => shoppingRuns.id),
  shopperId: uuid("shopper_id").notNull().references(() => users.id),
  communalTotalCents: integer("communal_total_cents").notNull(),
  // Denominator snapshot (Q17, Q36)
  splitMemberIds: uuid("split_member_ids").array().notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
});

export const balances = pgTable(
  "balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id").notNull().references(() => settlements.id),
    debtorId: uuid("debtor_id").notNull().references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    state: balanceState("state").notNull().default("owed"),
  },
  (t) => [uniqueIndex("balances_settlement_debtor").on(t.settlementId, t.debtorId)],
);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  balanceId: uuid("balance_id").notNull().references(() => balances.id),
  amountCents: integer("amount_cents").notNull(),
  // Screenshot required (Q45)
  proofImagePath: text("proof_image_path").notNull(),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============ Price ledger (v1 logs only; analytics v2) ============

export const purchaseLedger = pgTable(
  "purchase_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    houseId: uuid("house_id").notNull().references(() => houses.id),
    storeId: uuid("store_id").references(() => stores.id),
    itemName: text("item_name").notNull(),
    unitPriceCents: integer("unit_price_cents"),
    totalCents: integer("total_cents").notNull(),
    quantity: numeric("quantity"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    receiptLineId: uuid("receipt_line_id").references(() => receiptLines.id),
  },
  (t) => [index("ledger_item_store").on(t.houseId, t.itemName, t.storeId)],
);

// ============ Meals (P1) ============

export const meals = pgTable("meals", {
  id: uuid("id").primaryKey().defaultRandom(),
  houseId: uuid("house_id").notNull().references(() => houses.id),
  date: date("date").notNull(),
  state: mealState("state").notNull().default("proposed"),
  dishTitle: text("dish_title"),
  // Default = active member count (Q32)
  servings: integer("servings"),
  // [{name, quantity, unit}]
  ingredients: jsonb("ingredients").notNull().default(sql`'[]'::jsonb`),
  // 48h before lock (Q34)
  approvalDeadline: timestamp("approval_deadline", { withTimezone: true }),
});

export const mealCooks = pgTable(
  "meal_cooks",
  {
    mealId: uuid("meal_id").notNull().references(() => meals.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    // Co-chef approval (Q34)
    approved: boolean("approved").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.mealId, t.userId] })],
);

// ============ Notifications ============

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    endpoint: text("endpoint").notNull(),
    keys: jsonb("keys").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.endpoint] })],
);

export const notificationLog = pgTable("notification_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  // e.g. 'reminder:{balance_id}:{date}' — idempotency (SDD §7.3)
  dedupeKey: text("dedupe_key").notNull().unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
