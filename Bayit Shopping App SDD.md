# Bayit Shopping App — System Design Document (SDD)

> **Version:** 1.0 — June 2026
> **Source of truth:** `Bayit Shopping App.md` (Product Brief). DECIDED and PROPOSED answers in Brief §4 are treated as requirements.
> **Goal:** A developer with no prior context should be able to implement the MVP from this document alone and pass the acceptance criteria in Brief §2.5, with a first full dogfood cycle this semester.

---

## 1. Executive Summary

The Bayit Shopping App is a collaborative, offline-first **Progressive Web App** for the Berkeley Bayit, an ~11-person housing co-op. It replaces two painful workflows:

1. **List building** — formatted Slack messages consolidated by hand → a shared shopping list with personal/communal tagging, duplicate detection, and store/section sorting.
2. **Settlement** — a manual receipt spreadsheet → receipt photo upload, Gemini-assisted parsing, automatic communal/personal cost splitting, Venmo deep links, and proof-of-payment tracking.

The system is a single weekly **Shopping Run state machine**: the list opens, housemates add items, an assigned shopper shops (offline-capable in-store), receipts are uploaded and reconciled via an AI chat, balances are computed, housemates pay the shopper, and the run closes — which opens the next list.

**Stack:** React/TypeScript PWA · Node.js/TypeScript API (Fastify) · PostgreSQL · Docker · free-tier hosting (Render or Fly.io + Supabase Postgres) · Gemini API for receipt parsing · optional outbound Slack webhooks.

**Non-goals for MVP** (Brief §2.4): 3D aisle mapping, real-time stock, price optimization UI, coupons, duration ML, kitchen-head surveys, AI recipe assistant, two-way Slack bot, gamification, multi-house UI. The schema, however, is multi-house-ready (`house_id` on every tenant-scoped table) and logs all prices for future "price science."

**Pre-build gate:** A short KitchenOwl spike (Brief Q57) decides fork vs greenfield. This SDD documents the greenfield design; §11 defines the spike's evaluation criteria and what survives either outcome.

---

## 2. System Architecture

### 2.1 Component diagram (textual)

```
┌──────────────────────────────────────────────────────────────────┐
│ CLIENT — React/TS PWA (installable, "Add to Home Screen")        │
│                                                                  │
│  ┌────────────┐  ┌─────────────┐  ┌───────────────────────────┐  │
│  │ App Shell  │  │ IndexedDB   │  │ Service Worker            │  │
│  │ (React,    │  │ (Dexie.js)  │  │ - precache app shell      │  │
│  │  Vite PWA) │  │ active run  │  │ - Background Sync queue   │  │
│  └────────────┘  │ list cache  │  │ - Web Push handler        │  │
│                  └─────────────┘  └───────────────────────────┘  │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS / JSON (REST)
┌───────────────▼──────────────────────────────────────────────────┐
│ API — Node.js/TypeScript (Fastify), Docker container             │
│                                                                  │
│  Auth (magic link, JWT cookies)      Run state machine           │
│  List service (fuzzy dedupe)         Settlement engine           │
│  Receipt pipeline orchestrator       Notification dispatcher     │
│  Reconciliation chat endpoint        Cron: reminders (node-cron) │
└──┬──────────────┬──────────────┬──────────────┬──────────────────┘
   │              │              │              │
┌──▼──────────┐ ┌─▼───────────┐ ┌▼────────────┐ ┌▼──────────────┐
│ PostgreSQL  │ │ Object      │ │ Gemini API  │ │ Slack Incoming│
│ (Supabase   │ │ storage     │ │ (receipt    │ │ Webhook       │
│  free tier) │ │ (Supabase   │ │  parse +    │ │ (outbound     │
│             │ │  Storage)   │ │  recon chat)│ │  only, v1)    │
└─────────────┘ └─────────────┘ └─────────────┘ └───────────────┘
```

### 2.2 Key flows


| Flow         | Path                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Add item     | PWA → `POST /items` → fuzzy match check → insert or merge-prompt                                                                         |
| Shop offline | SW caches list at "Heading to store" → check-offs queue in IndexedDB → Background Sync replays on reconnect                              |
| Receipt      | PWA upload → object storage → OCR-less direct image → Gemini structured output → match engine → reconciliation chat → settlement compute |
| Pay          | Balance screen → Venmo deep link / Zelle copy → screenshot upload → shopper or auto-confirm → balance `Paid`                             |
| Reminders    | node-cron daily job → unpaid balances > 3 days → Web Push + email (+ Slack webhook if configured)                                        |


### 2.3 Hosting topology

- **One Docker image** serving both the API and the built PWA static files (Fastify `@fastify/static`). Single free-tier service on Render or Fly.io.
- **PostgreSQL + object storage:** Supabase free tier (500 MB DB, 1 GB storage — ample for one house; receipts ~200 KB × 15 runs/semester).
- **Email:** Resend or Postmark free tier for magic links and reminder fallback.
- **Web Push:** standard VAPID keys, no third-party service.
- **Secrets:** `GEMINI_API_KEY`, `DATABASE_URL`, `SLACK_WEBHOOK_URL` (optional), `VAPID_`*, `EMAIL_API_KEY` — all env vars, swappable per Brief Q56.

Render free tier sleeps after inactivity; cold starts (~30 s) are acceptable for a utility app. The cron reminder job runs in-process; if the service sleeps through a reminder window, the job catches up on next wake (reminders are idempotent, keyed by `balance_id + date`).

---

## 3. Database Schema & DDL

### 3.1 Enums and state machines

**Run state machine** (Brief §4.2):

```
Draft ──open──> Open ──"heading to store"──> Locked ──"done shopping"──>
Reconciling ──"splits finalized"──> Settling ──all paid / admin force──> Closed
```


| Transition               | Actor                                                | Side effects                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Draft → Open`           | Manager/KitchenHead/Admin                            | Previous run must be `Closed`. List becomes writable. Notification: "Run scheduled."                                                                           |
| `Open → Locked`          | Assigned shopper                                     | New items blocked; edits to existing items + substitute flags still allowed. List snapshot pushed to shopper's IndexedDB. Notification: "Shopper heading out." |
| `Locked → Reconciling`   | Shopper                                              | Shopper marks shopping done. Receipt upload unlocked.                                                                                                          |
| `Reconciling → Settling` | Shopper                                              | All receipt lines resolved; settlement engine computes balances. Notifications: "You owe $X."                                                                  |
| `Settling → Closed`      | Automatic (all balances `Paid`) or Admin force-close | Unpurchased items → `Archived` (with one-tap re-add next run). Next run may be drafted.                                                                        |


**Item state machine** (Brief §7.3): `Pending → In_Cart → Purchased → Archived`. `Pending → Archived` directly when not bought (skipped, out of stock).

```sql
CREATE TYPE run_state  AS ENUM ('draft','open','locked','reconciling','settling','closed');
CREATE TYPE item_state AS ENUM ('pending','in_cart','purchased','archived');
CREATE TYPE item_kind  AS ENUM ('communal','personal');
CREATE TYPE balance_state AS ENUM ('owed','partially_paid','paid','waived');
CREATE TYPE line_resolution AS ENUM ('auto_matched','manually_matched','assigned_communal','assigned_personal','skipped');
CREATE TYPE issue_kind AS ENUM ('out_of_stock','not_found','substituted','price_surprise','other');
CREATE TYPE store_section AS ENUM ('produce','dairy','meat','bakery','dry_goods','frozen','household','other');
CREATE TYPE meal_state AS ENUM ('proposed','approved','confirmed','cooked','cancelled');
```

### 3.2 DDL

```sql
-- ============ Tenancy & people ============

CREATE TABLE houses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                          -- 'Berkeley Bayit'
  meal_days     int[] NOT NULL DEFAULT '{0,2,4}',       -- 0=Sun,2=Tue,4=Thu (Brief Q7)
  shopping_day  int  NOT NULL DEFAULT 0,                -- Sunday (Brief Q7)
  split_excludes_shopper boolean NOT NULL DEFAULT false,-- shopper pays own share too
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,                          -- 'Benny K.' (Brief Q20)
  full_name     text NOT NULL,                          -- admin-visible only
  venmo_handle  text,                                   -- required before first settlement (Q19)
  zelle_contact text,                                   -- phone or email, optional
  allergens     text[] NOT NULL DEFAULT '{}',           -- structured: 'peanut','gluten',... (Q33)
  preferences   text NOT NULL DEFAULT '',               -- free text (Q33)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  house_id      uuid NOT NULL REFERENCES houses(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  is_admin      boolean NOT NULL DEFAULT false,
  is_manager    boolean NOT NULL DEFAULT false,         -- meal assignment (Q12)
  is_kitchen_head boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,          -- false = excluded from future splits (Q16)
  deactivated_at timestamptz,
  PRIMARY KEY (house_id, user_id)
);
-- Deactivated members keep login access to pay carried-forward balances (Q16, Q47).

CREATE TABLE invites (
  token         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id      uuid NOT NULL REFERENCES houses(id),
  created_by    uuid NOT NULL REFERENCES users(id),
  expires_at    timestamptz NOT NULL,
  used_by       uuid REFERENCES users(id)
);

-- ============ Stores ============

CREATE TABLE stores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id      uuid NOT NULL REFERENCES houses(id),
  name          text NOT NULL                           -- seeded: 'Safeway (Elmwood)', 'Trader Joe''s' (Q27)
);

-- ============ Shopping runs & list ============

CREATE TABLE shopping_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id      uuid NOT NULL REFERENCES houses(id),
  state         run_state NOT NULL DEFAULT 'draft',
  scheduled_at  timestamptz,                            -- set by manager (Q10)
  shopper_id    uuid REFERENCES users(id),
  locked_at     timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Enforce one non-closed run per house:
CREATE UNIQUE INDEX one_active_run_per_house
  ON shopping_runs (house_id) WHERE state <> 'closed';

CREATE TABLE list_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES shopping_runs(id),
  requester_id  uuid NOT NULL REFERENCES users(id),
  name          text NOT NULL,
  normalized_name text NOT NULL,                        -- lowercased, trimmed; for fuzzy match
  quantity      numeric,
  unit          text,                                   -- 'dozen','lb','count',...
  kind          item_kind NOT NULL,                     -- communal | personal (Q21)
  state         item_state NOT NULL DEFAULT 'pending',
  notes         text,
  store_pref    uuid REFERENCES stores(id),             -- NULL = 'Any' (Q29)
  section       store_section NOT NULL DEFAULT 'other', -- shopper-facing sort key (Q28)
  source_meal_id uuid,                                  -- FK added below; meal-suggested items
  alternatives  text[] NOT NULL DEFAULT '{}',           -- pre-approved substitutes (Q25)
  client_id     text,                                   -- idempotency key from PWA (offline sync)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_items_run_state ON list_items (run_id, state);
CREATE UNIQUE INDEX list_items_client_dedupe ON list_items (run_id, client_id)
  WHERE client_id IS NOT NULL;
CREATE EXTENSION IF NOT EXISTS pg_trgm;                 -- fuzzy dedupe (Q23)
CREATE INDEX list_items_trgm ON list_items USING gin (normalized_name gin_trgm_ops);

CREATE TABLE shopper_issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES shopping_runs(id),
  item_id       uuid REFERENCES list_items(id),
  kind          issue_kind NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============ Receipts & reconciliation ============

CREATE TABLE receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES shopping_runs(id),
  store_id      uuid REFERENCES stores(id),
  image_path    text NOT NULL,                          -- object storage key
  purchased_at  timestamptz,
  subtotal_cents int,
  tax_cents     int,
  total_cents   int,
  gemini_raw    jsonb,                                  -- full structured response, audit trail
  delete_after  date,                                   -- semester end + 90 days (Q61)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipt_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id    uuid NOT NULL REFERENCES receipts(id),
  raw_text      text NOT NULL,                          -- 'ORGNBRWN EGG'
  parsed_name   text NOT NULL,                          -- 'Organic Brown Eggs'
  quantity      numeric NOT NULL DEFAULT 1,
  unit_price_cents int,
  total_cents   int NOT NULL,                           -- negative for discounts
  is_discount   boolean NOT NULL DEFAULT false,
  is_fee        boolean NOT NULL DEFAULT false,         -- bags, CRV, etc.
  matched_item_id uuid REFERENCES list_items(id),
  match_confidence real,                                -- 0..1 from Gemini
  resolution    line_resolution,                        -- NULL = unresolved
  resolved_kind item_kind,                              -- final communal/personal verdict
  resolved_user_id uuid REFERENCES users(id)            -- payer if personal & no matched item
);

-- ============ Settlement ============

CREATE TABLE settlements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL UNIQUE REFERENCES shopping_runs(id),  -- one per run (Q40)
  shopper_id    uuid NOT NULL REFERENCES users(id),
  communal_total_cents int NOT NULL,
  split_member_ids uuid[] NOT NULL,                     -- denominator snapshot (Q17, Q36)
  finalized_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES settlements(id),
  debtor_id     uuid NOT NULL REFERENCES users(id),
  amount_cents  int NOT NULL,                           -- communal share + personal items
  paid_cents    int NOT NULL DEFAULT 0,                 -- partial payments (Q44)
  state         balance_state NOT NULL DEFAULT 'owed',
  UNIQUE (settlement_id, debtor_id)
);

CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id    uuid NOT NULL REFERENCES balances(id),
  amount_cents  int NOT NULL,
  proof_image_path text NOT NULL,                       -- screenshot required (Q45)
  confirmed_by  uuid REFERENCES users(id),              -- shopper confirms, or admin
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============ Price ledger (v1 logs only; analytics v2) ============

CREATE TABLE purchase_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id      uuid NOT NULL REFERENCES houses(id),
  store_id      uuid REFERENCES stores(id),
  item_name     text NOT NULL,                          -- normalized parsed_name
  unit_price_cents int,
  total_cents   int NOT NULL,
  quantity      numeric,
  purchased_at  timestamptz NOT NULL,
  receipt_line_id uuid REFERENCES receipt_lines(id)
);
CREATE INDEX ledger_item_store ON purchase_ledger (house_id, item_name, store_id);

-- ============ Meals (P1) ============

CREATE TABLE meals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id      uuid NOT NULL REFERENCES houses(id),
  date          date NOT NULL,
  state         meal_state NOT NULL DEFAULT 'proposed',
  dish_title    text,
  servings      int,                                    -- default = active member count (Q32)
  ingredients   jsonb NOT NULL DEFAULT '[]',            -- [{name, quantity, unit}]
  approval_deadline timestamptz                         -- 48h before lock (Q34)
);

CREATE TABLE meal_cooks (
  meal_id       uuid NOT NULL REFERENCES meals(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  approved      boolean NOT NULL DEFAULT false,         -- co-chef approval (Q34)
  PRIMARY KEY (meal_id, user_id)
);

ALTER TABLE list_items
  ADD CONSTRAINT fk_source_meal FOREIGN KEY (source_meal_id) REFERENCES meals(id);

-- ============ Notifications ============

CREATE TABLE push_subscriptions (
  user_id       uuid NOT NULL REFERENCES users(id),
  endpoint      text NOT NULL,
  keys          jsonb NOT NULL,
  PRIMARY KEY (user_id, endpoint)
);

CREATE TABLE notification_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  kind          text NOT NULL,            -- 'run_scheduled','substitute_needed','balance_owed','payment_reminder',...
  dedupe_key    text NOT NULL,            -- e.g. 'reminder:{balance_id}:{date}' — idempotency
  sent_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);
```

### 3.3 Settlement math (normative)

For a run with communal total `C` (sum of `resolved_kind='communal'` line totals, including communal-attributed tax/fees — see §7.2), split members `M` (active members at finalization, admin-editable; Brief Q17/Q36), and per-person personal totals `P(u)`:

```
share        = C / |M|                       (integer cents, remainder distributed
                                              one cent each to first (C mod |M|)
                                              members ordered by user id — deterministic)
owes(u)      = share·[u ∈ M] + P(u)          for u ≠ shopper
shopper net  = total paid − share·[shopper ∈ M] − P(shopper)
```

The shopper's own communal share and personal items are simply not billed to anyone (they paid at the till). Every other member gets exactly one `balances` row. Sum of all balances + shopper's own share + shopper's personal items = receipt grand total (invariant; assert in code).

---

## 4. Core API Endpoints

REST, JSON, JWT session cookie. All routes scoped to the caller's house. `403` on role violations, `409` on illegal state transitions.

### 4.1 Auth & profile


| Method & path                 | Auth   | Description                                                      |
| ----------------------------- | ------ | ---------------------------------------------------------------- |
| `POST /auth/magic-link`       | —      | Send sign-in email. Body: `{email}`                              |
| `GET /auth/verify?token=`     | —      | Exchange token for session cookie                                |
| `POST /invites`               | Admin  | Create invite link                                               |
| `POST /invites/:token/accept` | —      | Join house; create user + membership                             |
| `GET/PATCH /me`               | Member | Profile: allergens, preferences, `venmo_handle`, `zelle_contact` |
| `POST /me/push-subscription`  | Member | Register Web Push subscription                                   |


### 4.2 Runs


| Method & path                  | Auth                      | Description                                                                                    |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /runs`                   | Manager/KitchenHead/Admin | Create draft. `409` if a non-closed run exists                                                 |
| `PATCH /runs/:id`              | Manager/Admin             | Set `scheduled_at`, `shopper_id`                                                               |
| `POST /runs/:id/open`          | Manager/Admin             | `Draft → Open`; fires "run scheduled" notification                                             |
| `POST /runs/:id/lock`          | Assigned shopper          | "Heading to store." Returns full list snapshot for IndexedDB                                   |
| `POST /runs/:id/done-shopping` | Shopper                   | `Locked → Reconciling`                                                                         |
| `POST /runs/:id/finalize`      | Shopper                   | `Reconciling → Settling`; `409` if unresolved receipt lines remain; computes settlement (§3.3) |
| `POST /runs/:id/close`         | Auto / Admin              | `Settling → Closed`; archives unpurchased items                                                |
| `GET /runs/current`            | Member                    | Active run + state + list summary                                                              |


### 4.3 List items


| Method & path                         | Auth      | Description                                                                                                                                                                                                                                                                             |
| ------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /runs/:id/items?store=&section=` | Member    | Sorted by store → section for shop mode                                                                                                                                                                                                                                                 |
| `POST /runs/:id/items`                | Member    | Add item. `409 {duplicates:[...]}` if trigram similarity > 0.55 against pending items (Q23); client then re-sends with `force:true` or calls merge. Requires run in `Open` (or `Locked` only for the shopper's substitute additions). Accepts `client_id` for idempotent offline replay |
| `POST /items/:id/merge`               | Member    | Merge quantities of a flagged duplicate into existing item                                                                                                                                                                                                                              |
| `PATCH /items/:id`                    | Member    | Edit any field (full transparency, Q13). State transitions validated: `pending→in_cart→purchased` by shopper; `→archived` by shopper/admin                                                                                                                                              |
| `DELETE /items/:id`                   | Member    | Allowed while run `Open`                                                                                                                                                                                                                                                                |
| `POST /items/:id/substitute-request`  | Shopper   | "Can't find it." Notifies requester (push + badge). Response options: pick alternative / free-text / no response ⇒ shopper skips (Q25)                                                                                                                                                  |
| `POST /items/:id/substitute-response` | Requester | `{choice}` relayed to shopper                                                                                                                                                                                                                                                           |
| `POST /runs/:id/issues`               | Shopper   | Log out-of-stock / not-found / etc.                                                                                                                                                                                                                                                     |


### 4.4 Receipts & reconciliation


| Method & path              | Auth    | Description                                                                                                       |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /runs/:id/receipts`  | Shopper | Multipart image upload → storage → Gemini pipeline (§6). Returns `receipt_id` + parsed lines with match proposals |
| `GET /receipts/:id/lines`  | Member  | Lines with match status                                                                                           |
| `PATCH /receipt-lines/:id` | Shopper | Manual resolution: `{resolution, matched_item_id?, resolved_kind?, resolved_user_id?}`                            |
| `POST /receipts/:id/chat`  | Shopper | Reconciliation chat turn (§6.4). Body: `{message}`; returns assistant reply + any line mutations applied          |


### 4.5 Settlement & payments


| Method & path                 | Auth          | Description                                                                                                      |
| ----------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /me/balances`            | Member        | All owed balances incl. carried-forward (Q47), with Venmo deep link + Zelle copy payload per row                 |
| `POST /balances/:id/payments` | Debtor        | Multipart: amount + proof screenshot (Q44/Q45)                                                                   |
| `POST /payments/:id/confirm`  | Shopper/Admin | Confirm proof; updates `paid_cents`; balance → `paid` when fully covered; run auto-closes when all balances paid |
| `GET /house/export.csv`       | Admin         | Ledger + balances CSV (Q63)                                                                                      |


Venmo deep link, generated server-side per Brief §5.4:

```
venmo://paycharge?txn=pay&recipients={shopper_venmo}&amount={dollars}&note=Bayit%20run%20{date}
```

with `https://venmo.com/...` web fallback for desktop. Zelle: response includes `{recipient, amount}` for clipboard copy.

### 4.6 Meals (P1)


| Method & path                   | Auth          | Description                                                                                                                                  |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /meals`                   | Manager       | Create meal slot for a meal day; assign cooks                                                                                                |
| `POST /meals/:id/propose-dish`  | Assigned cook | `{dish_title, servings, ingredients[]}` → returns **allergy conflicts** computed against all active members' `allergens` before confirm (Q5) |
| `POST /meals/:id/approve`       | Co-chef       | Approve; meal `confirmed` when all cooks approve or 48 h deadline passes (Q34)                                                               |
| `POST /meals/:id/suggest-items` | Cook          | One-click: scale ingredients to `servings`, return draft items (communal default) for explicit add — never silent auto-add (Q35)             |


### 4.7 Admin


| Method & path                | Auth  | Description                                                       |
| ---------------------------- | ----- | ----------------------------------------------------------------- |
| `PATCH /memberships/:userId` | Admin | Toggle `active`, roles. Deactivation keeps login + balances (Q16) |
| `POST /runs/:id/force-close` | Admin | Close with unpaid balances; balances persist and keep reminding   |


---

## 5. Offline Sync & Conflict Resolution

### 5.1 Scope (Brief Q51)

Offline supports the **shopper's in-store workflow only**: read the list, transition items `pending ↔ in_cart`, flag substitute requests, log issues. Offline **add/delete is not supported** in v1 — adds are blocked at lock time anyway (Q9), so the only people affected are non-shoppers browsing offline, who get a read-only cached view.

### 5.2 Mechanics

1. **App shell:** Vite PWA plugin (Workbox under the hood) precaches HTML/JS/CSS/icons. App opens instantly with no network.
2. **List snapshot:** `POST /runs/:id/lock` response is written to IndexedDB (Dexie.js): items, alternatives, store/section sort, requester contact metadata.
3. **Mutation queue:** Every offline action appends `{op, item_id, payload, client_ts, seq}` to a Dexie `outbox` table and optimistically updates the local view.
4. **Background Sync:** Service worker registers a `sync` event; on connectivity, the outbox replays in `seq` order against the normal REST endpoints. Each op carries an idempotency key (`item_id + op + seq`) so retries are safe. iOS Safari lacks Background Sync — fallback is replay-on-app-foreground + `online` event listener (works because the shopper reopens the app to continue shopping).
5. **Substitute requests offline:** queued like any op; the requester is only notified when the op syncs. UI shows "will send when back online" so the shopper knows to fall back to a phone call in a true dead zone.

### 5.3 Conflict resolution (Brief Q52)


| Conflict                                                | Rule                                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two devices toggle the same item's state                | **Last-write-wins by server receipt time.** Check-offs are idempotent and low-stakes; the shopper's device is almost always the sole writer while `Locked` |
| Offline check-off vs concurrent online edit (notes/qty) | Field-level merge: state from shopper op, other fields from latest edit — ops only touch `state`, so no true conflict                                      |
| Duplicate adds racing before lock                       | Server-side trigram check at insert; second insert gets `409` + merge prompt (Q23). Offline adds don't exist, so no add-conflicts on sync                  |
| Replay arrives after run left `Locked`                  | Ops against `Reconciling` runs still accepted for `state` transitions (shopper may sync in the parking lot); rejected with per-op error after `Settling`   |


The sync response returns per-op results; failed ops surface as a dismissible "couldn't sync N changes" list rather than blocking the queue.

---

## 6. Gemini Receipt Pipeline

### 6.1 Flow

```
Shopper uploads photo(s) (phone or laptop)
  → API stores image in object storage
  → Gemini multimodal call: image + active list context + JSON schema (structured output)
  → Validate response (zod) against schema; retry once on schema failure
  → Insert receipt + receipt_lines; auto-apply matches with confidence ≥ 0.85
  → Matched list items: in_cart → purchased
  → Lines with confidence < 0.85 or no match → unresolved; reconciliation chat UI
  → purchase_ledger rows written for every non-discount, non-fee line
```

No separate OCR step: Gemini's multimodal models read receipt images directly, which halves cost and failure modes versus OCR→LLM. **Cost note (Q56):** one receipt image ≈ a few thousand tokens; at two receipts per run × 15 runs/semester, total semester cost is well under $1 on current Gemini Flash pricing. Use the cheapest Flash-tier model; key supplied via `GEMINI_API_KEY`.

### 6.2 Prompt context

The request includes the run's list items as compact JSON (`id`, `name`, `quantity`, `unit`, `kind`, `requester`) so Gemini proposes matches in the same call.

### 6.3 Exact response JSON schema

Enforced via Gemini structured-output (`response_schema`); validated server-side with zod.

```json
{
  "type": "object",
  "required": ["store_guess", "purchased_at", "lines", "subtotal_cents", "tax_cents", "total_cents"],
  "properties": {
    "store_guess": { "type": "string", "enum": ["safeway", "trader_joes", "unknown"] },
    "purchased_at": { "type": "string", "description": "ISO 8601, null if unreadable" },
    "subtotal_cents": { "type": "integer" },
    "tax_cents": { "type": "integer" },
    "total_cents": { "type": "integer" },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["raw_text", "parsed_name", "quantity", "total_cents", "is_discount", "is_fee", "match"],
        "properties": {
          "raw_text":   { "type": "string", "description": "verbatim receipt text, e.g. 'ORGNBRWN EGG'" },
          "parsed_name":{ "type": "string", "description": "human-readable, e.g. 'Organic Brown Eggs'" },
          "quantity":   { "type": "number" },
          "unit_price_cents": { "type": "integer", "description": "null if not printed" },
          "total_cents":{ "type": "integer", "description": "negative for discounts/coupons" },
          "is_discount":{ "type": "boolean" },
          "is_fee":     { "type": "boolean", "description": "bags, CRV, bottle deposit" },
          "match": {
            "type": "object",
            "required": ["list_item_id", "confidence"],
            "properties": {
              "list_item_id": { "type": "string", "description": "id from provided list context, or null" },
              "confidence":   { "type": "number", "minimum": 0, "maximum": 1 }
            }
          }
        }
      }
    }
  }
}
```

**Integrity check:** server verifies `Σ lines ≈ subtotal` and `subtotal + tax ≈ total` within ±5¢; mismatch flags the receipt header for chat review rather than rejecting it.

### 6.4 Reconciliation chat (Brief Q39/Q41, laptop-first)

A constrained chat: each turn sends Gemini the unresolved lines + unmatched list items + the shopper's message, with **function-calling tools** the model may invoke:

- `match_line(line_id, item_id)`
- `assign_line(line_id, kind, user_id?)` — communal, or personal with payer
- `skip_line(line_id)` — excluded from settlement (e.g. shopper's own impulse buy they'll cover)
- `edit_line(line_id, parsed_name?, total_cents?)` — fix OCR misreads

Every tool call is applied transactionally and echoed in the UI as a structured diff ("Matched `TJ KOSHR CHK` → *Kosher chicken thighs* (Dana R.)"), so the tired shopper can undo any step. `finalize` stays disabled until zero unresolved lines. The same `PATCH /receipt-lines/:id` endpoint backs a plain table UI as a no-AI fallback.

---

## 7. Financial Settlement

### 7.1 Trigger

`POST /runs/:id/finalize` (shopper, run in `Reconciling`, zero unresolved lines across all of the run's receipts — single settlement covers both stores' receipts, Q40).

### 7.2 Classification rules (Brief §4.8)


| Receipt element                             | Treatment                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Line matched to communal item               | Communal pool                                                                                                                      |
| Line matched to personal item               | Billed to item's requester                                                                                                         |
| Unmatched line resolved `assigned_communal` | Communal pool (shared supplies default communal, Q37)                                                                              |
| Unmatched line resolved `assigned_personal` | Billed to `resolved_user_id`                                                                                                       |
| Discounts (`is_discount`)                   | Applied to the pool/person of the line they discount; store-level coupons → communal                                               |
| Fees (`is_fee`: bags, CRV)                  | Communal (Q38)                                                                                                                     |
| Tax                                         | Prorated: `tax × (communal subtotal / receipt subtotal)` → communal; remainder prorated across personal subtotals per person (Q38) |
| `skipped` lines                             | Excluded entirely (shopper self-covers)                                                                                            |


### 7.3 Balance lifecycle

```
owed ──payment uploaded──> (shopper confirms) ──partial──> partially_paid
                                              └──full────> paid
admin may set waived (writes off remainder)
```

- Debtor flow: balance row → **"Pay with Venmo"** deep link (amount + note pre-filled) or **"Copy Zelle details"** → completes payment in the P2P app → uploads screenshot → shopper gets a confirm prompt showing screenshot + expected amount.
- **Reminders (Q46):** daily cron — push + email to debtors with `owed/partially_paid` balances older than 3 days; admin notified at 7 days. Idempotent via `notification_log.dedupe_key`. Reminders persist across semesters until paid (Q47).
- **Auto-close:** when the last balance of a run's settlement reaches `paid`, the run transitions `Settling → Closed` and the next list can open.
- **Turnover (Q16):** deactivating a membership removes the user from future `split_member_ids` but leaves balances and login intact.

---

## 8. Slack Integration

### 8.1 v1 — outbound webhooks only (Q48)

Single config value `SLACK_WEBHOOK_URL` (Slack *Incoming Webhook* to the house channel). If unset, the dispatcher silently skips Slack — PWA push + email remain the canonical channels (Q49).


| Event (Q50)                               | Message                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Run opened/scheduled                      | "🛒 Shopping run scheduled for Sun 3 PM — shopper: Dana. List is open." |
| Lock warning (T-2h before `scheduled_at`) | "List locks soon — add your items."                                     |
| Shopper heading out                       | "Dana is heading to Safeway + TJ's. List is locked."                    |
| Settlement finalized                      | "Receipts are in. Check the app for what you owe."                      |
| Payment reminder digest                   | "3 outstanding balances from Sun's run."                                |


No per-user Slack DMs in v1 (webhooks can't DM); personal nudges go via push/email.

### 8.2 v1.1 — two-way bot (explicitly out of MVP)

Slack Bolt app with slash commands (`/bayit-list add Milk`, `/bayit-list show`), event subscriptions, and per-user Slack↔app identity linking. Requires a public request URL and app-level tokens; deferred per Brief Q3. The notification dispatcher is already channel-abstracted (`push | email | slack`) so Bolt slots in as a fourth transport plus a command controller calling the existing REST handlers.

---

## 9. Failure Modes & Mitigations


| #   | Failure                                                     | Impact                                 | Mitigation                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gemini misparses receipt (wrong totals, hallucinated lines) | Wrong balances                         | Schema-enforced output; ±5¢ arithmetic integrity check; confidence threshold 0.85 for auto-match; every line human-reviewable in chat/table UI; `gemini_raw` stored for audit; settlement invariant assertion (§3.3) |
| 2   | Gemini API down or key exhausted                            | Can't reconcile                        | Plain-table manual entry path uses the same `PATCH /receipt-lines` endpoint with zero AI; shopper can type lines by hand. Run is never blocked on AI                                                                 |
| 3   | Receipt photo unreadable                                    | Pipeline returns junk                  | Client-side capture guidance (flatten, lighting); re-upload replaces receipt; manual entry fallback                                                                                                                  |
| 4   | Offline ops lost (browser eviction of IndexedDB)            | Check-offs lost                        | Outbox persisted via Dexie with `navigator.storage.persist()`; list snapshot redownloadable; worst case shopper re-checks items — minutes, not data corruption                                                       |
| 5   | iOS lacks Background Sync                                   | Delayed sync                           | Replay on app foreground + `online` event (§5.2); shopper naturally reopens app in-store                                                                                                                             |
| 6   | Conflicting concurrent edits                                | Confusing list state                   | Narrow offline write surface (state only); LWW + field-merge (§5.3); full edit history not kept in v1                                                                                   |
| 7   | Debtor never pays                                           | Shopper liability (core money problem) | Daily reminders after 3 days; admin escalation at 7; balances survive run close, semester turnover, and deactivation; admin `waived` as last resort                                                                  |
| 8   | Fake/wrong payment screenshot                               | False settlement                       | Shopper (payee) must confirm each payment against the screenshot; amounts compared in confirm UI                                                                                                                     |
| 9   | Venmo deep link fails (no app, Android quirks)              | Payment friction                       | `https://venmo.com` web fallback link; Zelle copy path; manual "I paid cash" → still requires shopper confirm                                                                                                        |
| 10  | Free-tier service sleeps through cron window                | Missed reminders                       | Idempotent catch-up job on boot scans for due reminders; reminders are daily-granular so a late send is fine                                                                                                         |
| 11  | Member leaves with debt                                     | Lost money                             | Carry-forward by design (Q47); login retained; CSV export preserves record if app sunsets (Q63)                                                                                                                      |
| 12  | Substitute request unanswered in-store                      | Shopper stuck                          | Policy is explicit (Q25): no alternatives + no response ⇒ skip, item archived with issue logged; requester sees why it wasn't bought                                                                                 |
| 13  | Two runs created concurrently                               | Split-brain lists                      | DB-level partial unique index: one non-closed run per house (§3.2)                                                                                                                                                   |
| 14  | Maintainer graduates                                        | App rots                               | Single Docker image, two managed services, env-var config, CSV export, this SDD checked into the repo                                                                                                                |


---

## 10. MVP Implementation Phases

Ordered to satisfy Brief §2.5 acceptance criteria, sized for a this-semester dogfood (Q60). Each phase ends in a deployable state.

### Phase 0 — KitchenOwl spike + scaffold *(≈ 1 week)*

- Run KitchenOwl in Docker; evaluate against §11 criteria; record fork-vs-greenfield decision in this doc.
- (Greenfield path assumed below.) Monorepo scaffold: Vite + React + TS PWA, Fastify + TS API, Postgres via docker-compose, migration tool (drizzle-kit or node-pg-migrate), deploy pipeline to Render/Fly + Supabase.

### Phase 1 — Auth, house, list *(≈ 2 weeks)* → criteria #1

- Magic-link auth, invite flow, profiles (allergens, Venmo/Zelle).
- Run lifecycle `Draft→Open` minimal; list CRUD with personal/communal, trigram dedupe + merge, store/section fields.
- **Milestone: house stops posting list items to Slack.**

### Phase 2 — Shop mode + offline *(≈ 2 weeks)* → criterion #2

- Lock flow, store→section sorted shop view, item state transitions.
- Service worker precache, IndexedDB snapshot, outbox + Background Sync, iOS fallback.
- Substitute request/response with Web Push; shopper issue log.
- **Milestone: one real shopping trip completed in-app, offline-tested inside TJ's.**

### Phase 3 — Receipts + reconciliation *(≈ 2–3 weeks)* → criterion #3

- Upload → storage → Gemini structured parse → auto-match → ledger writes.
- Reconciliation chat with function-calling tools + plain-table fallback.
- Finalize endpoint with settlement engine + invariant tests (property-test the cent-distribution math).
- **Milestone: receipt spreadsheet retired.**

### Phase 4 — Settlement + payments *(≈ 1–2 weeks)* → criteria #4–5

- Balances UI, Venmo deep links, Zelle copy, proof upload, shopper confirm, partial payments.
- Reminder cron + notification log; auto-close on full payment; admin force-close; CSV export.
- **Milestone: full cycle closed in-app — MVP acceptance complete.**

### Phase 5 — Meals (P1) + Slack webhooks *(≈ 1–2 weeks, parallelizable)*

- Meal slots, cook assignment, dish proposal with allergy-conflict surfacing, co-chef approval, scaled-ingredient suggestions → one-click communal add.
- Outbound Slack webhook dispatcher for the five v1 events.

### Post-MVP backlog (do not build now)

v1.1: AI recipe assistant, Slack Bolt two-way bot, recipe URL import. v2: price-science analytics over `purchase_ledger`, kitchen-head surveys, duration estimates, coupons. v2+: 3D aisle mapping, gamification, multi-house onboarding.

---

## 11. KitchenOwl Spike — Evaluation Criteria (pre-Phase-1 gate)

Timebox: **2 days.** Fork KitchenOwl only if **all** of the following hold; otherwise greenfield per this SDD:

1. Its list + household model can represent personal-vs-communal items and per-run lifecycle without forking core schema.
2. Its Flutter web client supports our offline shop-mode requirements (or its API is cleanly consumable by our own PWA).
3. Receipt parsing, settlement math, Venmo/proof flow can be added as a sidecar service without patching upstream in ways that block pulling updates.
4. The team is comfortable maintaining Flutter + Python (KitchenOwl's stack) instead of one TypeScript codebase.

### Spike verdict (completed June 2026): **Greenfield.**

Evaluated against KitchenOwl `main` (clone inspected at `spike/kitchenowl`):

| Criterion | Result | Evidence |
|---|---|---|
| 1. List model fits personal/communal + run lifecycle without forking core schema | **Fail** | `ShoppinglistItems` is a flat household list (`shoppinglist_id`, `item_id`, `description`, `created_by`) — no item kind, no state enum, no run container, no alternatives. All would require core schema forks |
| 2. Flutter web client supports our offline shop-mode, or API cleanly consumable | **Partial** | Flutter app is offline-capable, but shop-mode customization (substitute flow, store legs) means writing Dart; consuming only the API discards the part we'd want most |
| 3. Receipt parsing + settlement addable as sidecar without patching upstream | **Fail** | `Expense`/`ExpensePaidFor` is manual entry with float dollar amounts and split factors — no integer cents, no balance/payment lifecycle, no proof-of-payment, no reminders, no link from expenses to list items or receipt lines. Settlement is our core; a sidecar would need deep upstream patches |
| 4. Team comfortable maintaining Flutter + Python | **Fail** | Stack is Flask/SQLAlchemy + Flutter/Dart; project prefers one TypeScript codebase (Brief Q54) |

**Patterns worth borrowing from KitchenOwl:** category-sorted shop view, single-tap check-off UX, expense split-factor concept (generalizes our equal split if weighted splits are ever wanted), household export/import for data portability.

---

## Appendix A — Environment variables


| Var                                      | Purpose                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`                           | Postgres connection                                             |
| `GEMINI_API_KEY`                         | Receipt parsing + reconciliation chat (author-owned, swappable) |
| `STORAGE_`*                              | Supabase storage bucket creds                                   |
| `EMAIL_API_KEY`                          | Magic links + reminder emails                                   |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push                                                        |
| `SLACK_WEBHOOK_URL`                      | Optional; omit to disable Slack                                 |
| `JWT_SECRET`                             | Session signing                                                 |
| `APP_BASE_URL`                           | Link generation                                                 |


## Appendix B — Settlement worked example

Receipt total $231.40 (Safeway $148.10 + TJ's $83.30). After reconciliation: communal $187.00, personal: Dana (shopper) $12.40, Noam $18.00, Rivka $14.00. Active split members: all 11 (shopper included).

- Communal share = 18700 ÷ 11 = 1700 cents exactly → $17.00/person.
- Noam owes 17.00 + 18.00 = **$35.00**; Rivka owes 17.00 + 14.00 = **$31.00**; each of the other 8 non-shoppers owes **$17.00**.
- Dana is owed 35 + 31 + 8×17 = **$202.00** = 231.40 − 17.00 (own share) − 12.40 (own personal). Invariant holds.

