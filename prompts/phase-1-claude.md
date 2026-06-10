# Phase 1 Implementation Prompt (Claude)

Copy everything below the line into Claude (or another coding agent) with the repo open as context.

---

You are implementing **Phase 1** of the Bayit Shopping App — a collaborative grocery/shopping PWA for a housing co-op (currently being built solo at home; Bayit dogfood is months away).

## Source of truth (read these first)

1. **`Bayit Shopping App SDD.md`** — §3 (schema/state machines), §4.1–4.3 (API contracts), §10 Phase 1
2. **`Bayit Shopping App.md`** — product decisions in §4 (especially Q13 permissions, Q21 personal/communal, Q23 dedupe)
3. **`human_instructions.md`** — scope notes: no Slack, no secrets in git, solo dev mode
4. **Existing code** — `api/src/schema.ts`, `api/src/index.ts`, `web/src/App.tsx`

Do not redesign Phase 2+ features. Do not add Slack. Do not commit `.env` or credentials.

## Current codebase (Phase 0 done)

- **Monorepo:** `api/` (Fastify + TypeScript + Drizzle), `web/` (React + Vite PWA)
- **DB:** PostgreSQL; full schema migrated (`api/drizzle/0000_*.sql`); `pg_trgm` enabled
- **API today:** only `GET /api/health` in `api/src/index.ts`
- **Web today:** placeholder page that pings `/api/health`
- **Env vars** (already in local `.env` and Render): `DATABASE_URL`, `JWT_SECRET`, `APP_BASE_URL`, `EMAIL_API_KEY`, `GEMINI_API_KEY`, `VAPID_*` — use `EMAIL_API_KEY` for magic links via Resend; ignore Gemini/VAPID in Phase 1

## Phase 1 scope — implement exactly this

### Backend (`api/`)

**A. Auth & sessions**
- `POST /api/auth/magic-link` — body `{ email }`; create short-lived token; send link via Resend to `{APP_BASE_URL}/auth/verify?token=...`
- `GET /api/auth/verify?token=` — validate token, set HTTP-only session cookie (JWT), redirect to app home
- Add a `magic_link_tokens` table (migration) — not in schema yet; tokens expire in 15 min, single-use
- Auth middleware: read session cookie on all `/api/*` routes except health, magic-link, verify, invite accept

**B. Bootstrap & invites (solo-friendly)**
- If no `houses` row exists on first successful verify: create house named `"Home"` (or `"Berkeley Bayit"` configurable later), seed stores `Safeway (Elmwood)` and `Trader Joe's`, make user admin + manager + kitchen_head
- `POST /api/invites` — admin only; returns invite URL with token
- `POST /api/invites/:token/accept` — new user joins existing house (for later multi-user; implement now)

**C. Profile**
- `GET /api/me` — user + membership roles + house id
- `PATCH /api/me` — `displayName`, `fullName`, `allergens[]`, `preferences`, `venmoHandle`, `zelleContact`
- Standard allergen enum for UI: `peanut`, `tree_nut`, `dairy`, `egg`, `gluten`, `soy`, `shellfish`, `fish`, `sesame` + free-text preferences

**D. Shopping runs (minimal lifecycle)**
- `POST /api/runs` — manager/kitchen_head/admin; creates `draft`; `409` if another non-closed run exists (DB partial unique index already enforces this)
- `PATCH /api/runs/:id` — set `scheduledAt`, `shopperId`
- `POST /api/runs/:id/open` — `draft → open`; email notification to house optional (Resend), no Slack
- `GET /api/runs/current` — active run for caller's house + item count by state
- Do **not** implement `lock`, `done-shopping`, `finalize`, `close` yet (Phase 2–4)

**E. List items**
- `GET /api/runs/:id/items` — optional `?store=` `?section=`; sort store → section
- `POST /api/runs/:id/items` — requires run `open`; fields per SDD §4.3; compute `normalizedName`; fuzzy dedupe via `pg_trgm` similarity > 0.55 on pending items → `409 { duplicates: [...] }` unless `force: true`
- `POST /api/items/:id/merge` — merge quantity into existing item
- `PATCH /api/items/:id` — edit fields; all members can edit (transparency)
- `DELETE /api/items/:id` — only while run `open`
- Item states stay `pending` in Phase 1 (no in_cart transitions yet)

**F. Code organization**
- Split routes into modules: `routes/auth.ts`, `routes/me.ts`, `routes/invites.ts`, `routes/runs.ts`, `routes/items.ts`
- Shared: `lib/auth.ts`, `lib/email.ts`, `lib/dedupe.ts`, `lib/errors.ts`
- Use Drizzle for all queries; zod for request validation
- Return consistent JSON errors: `{ error: string, code?: string, details?: unknown }`

### Frontend (`web/`)

Build a minimal but usable PWA UI — utility-first, not flashy. Mobile-friendly.

**Pages / flows:**
1. **Sign in** — email input → "Check your email" confirmation
2. **Auth verify** — `/auth/verify` route handles redirect from magic link (or landing that completes verify)
3. **Profile setup** — first login: display name, allergens checkboxes, optional Venmo (skip OK for solo)
4. **Home** — shows current run state; buttons: "Start new run" (admin/manager), "Open list" if run is open
5. **List** — add item form (name, qty, unit, communal/personal toggle, notes, optional alternatives); item list with requester; duplicate warning modal (merge or force add)
6. **Run admin** (if manager/admin) — create draft, set shopper + schedule, "Open list for house"

Use `fetch` with `credentials: 'include'` for cookie sessions. No auth library needed if cookies work.

**Styling:** simple CSS in `index.css` or a single `App.css` — green accent `#2e7d32`, off-white background. No component library unless you strongly prefer one (keep deps minimal).

### Migrations

- Add `magic_link_tokens` table: `token uuid PK`, `email`, `expires_at`, `used_at`
- Run `npm run db:generate` and `npm run db:migrate`
- Optional seed script `api/src/seed.ts` for dev only — not required if bootstrap-on-first-login works

## Explicitly out of scope (do not build)

- Slack (any)
- Web Push / VAPID registration
- Offline sync / IndexedDB / shop mode (Phase 2)
- Receipt upload, Gemini, settlement, Venmo links (Phase 3–4)
- Meals (Phase 5)
- Substitute request/response, shopper issues
- Run states beyond `draft` and `open`
- Item state transitions beyond `pending`
- Google OAuth (magic link only)

## Implementation rules

1. **Match existing conventions** — ESM (`"type": "module"`), `.js` import extensions in API, Drizzle camelCase columns
2. **Minimal diff** — no unrelated refactors; no new docs unless updating `human_instructions.md` phase status when done
3. **Never commit secrets** — `.env` is gitignored
4. **Solo dev path must work** — one person can sign in, bootstrap house, create run, open it, add communal + personal items, see dedupe warning
5. **Production path** — Docker build still works; `NODE_ENV=production` serves PWA from API

## Acceptance criteria (verify before finishing)

- [ ] `npm run db:migrate` succeeds on fresh DB
- [ ] `npm run dev:api` + `npm run dev:web` — full solo flow in browser at localhost:5173
- [ ] Magic link email sends via Resend (link uses `APP_BASE_URL`)
- [ ] First login creates house + stores + admin membership
- [ ] Manager can `POST /runs` → `PATCH` → `POST .../open`
- [ ] Any member can add/edit/delete items while run is `open`
- [ ] Adding "eggs" when "1 dozen eggs" exists returns 409 with duplicates unless `force: true`
- [ ] `npm run build` succeeds for both workspaces
- [ ] `GET /api/health` still returns `{ ok: true, db: true }`

## When done

1. Update `human_instructions.md`: mark Phase 1 complete; note any follow-ups for Phase 2
2. List every new file and endpoint in your summary
3. Tell the human how to test locally (two terminals, Resend sandbox = magic link only to account email)

Begin by reading the SDD and existing schema, then implement backend routes, then frontend, then verify acceptance criteria.
