# Human Instructions

> Living document. The AI updates this file as the project advances; humans complete the checkboxes. Items are ordered — do them top to bottom.
>
> **Last updated:** June 2026 — Phase 3 implemented; solo home build (Bayit dogfood later).
>
> **⚠️ For AI — secrets:** Do **not** commit credentials from this file or chat. Real values live only in local `.env` (gitignored) and Render env vars. **Supabase database password was reset** after an earlier exposure — never reference or restore the old password; if `DATABASE_URL` breaks, ask the human for the current password or have them reset again in Supabase.
>
> **⚠️ For AI — scope:** **Slack is skipped** (`SLACK_WEBHOOK_URL` unset; no Slack work until Bayit semester). **Dogfooding at the Bayit is deferred** — Ben is building and testing solo, likely at his own home first. Design for multi-user co-op still applies; don't remove house/invite flows, but don't block progress on Bayit house decisions or Slack.

---

## Current project status


| Phase                                 | Status                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — KitchenOwl spike + scaffold | ✅ **Done.** Verdict: greenfield (SDD §11). Monorepo scaffolded; Postgres schema migrated locally; API health-checked; PWA builds with service worker |
| Phase 1 — Auth, house, list           | ✅ **Done.** Magic-link auth, profile, invites, run draft→open, list CRUD + dedupe                                                                    |
| Phase 2 — Shop mode + offline         | ✅ **Done.** Lock/done-shopping, shop view, Dexie outbox, Web Push substitutes/issues                                                                 |
| Phase 3 — Receipts + reconciliation   | ✅ **Done.** Supabase storage upload, Gemini parse + auto-match, reconciliation chat + table fallback, finalize + settlement engine + unit tests      |
| Phase 4 — Settlement + payments       | Not started (balances UI, Venmo/Zelle, proof-of-payment — Phase 3 creates `settlements` + `balances` rows)                                           |
| Phase 5 — Meals                       | Not started (P1; Slack **skipped** — see item 6)                                                                                                     |


---

## Action items for humans

### 1. GitHub repository — **mostly done**

- [x] Repo created: `benjaminross6/bayit-shopping-app`
- [x] Local Phase 0 commit pushed
- [x] Merge conflict resolved: GitHub's `Initial commit` (LICENSE) merged with local scaffold via `--allow-unrelated-histories` — no file conflicts; `LICENSE` kept from remote
- [x] **Push the merge commit** so GitHub matches local:

```bash
git push origin main
```

The `.gitignore` already excludes `node_modules/`, `.env`, and the KitchenOwl spike clone.

### 2. Create the Supabase project (database + file storage) — **do now**

- [x] Sign up at [supabase.com](https://supabase.com) (free tier).
- [x] Create a project named `bayit` (region: US West for Berkeley latency).
- [x] Copy the **connection string** (Project Settings → Database → Connection string, "URI" tab, use the *Session pooler* variant) — this becomes `DATABASE_URL` in production. Template looks like:
  ```
  postgresql://postgres.PROJECT_REF:[YOUR-PASSWORD]@....pooler.supabase.com:5432/postgres
  ```
- [x] **Database password reset** after accidental exposure — update `DATABASE_URL` on Render and in local `.env` with the new password. Do not store the password in this file or git.
- [x] Create a **storage bucket** named `receipts` (private) — used from Phase 3 onward.
- [x] Save the project's **service-role key** somewhere safe (Supabase → Project Settings → API) — needed in Phase 3. **Do not paste it here or commit it.**
- [ ] Add `**SUPABASE_URL`** and `**SUPABASE_SERVICE_ROLE_KEY**` to local `.env` and Render (Project Settings → API → Project URL + `service_role` secret). Required for receipt photo upload.

### 3. Create the Render service — **do now**

- [x] Sign up at [render.com](https://render.com) (free tier).
- [x] New → Blueprint → connect the GitHub repo from step 1. Render reads `render.yaml` automatically.
- [x] When prompted for environment variables, set:
  - `**DATABASE_URL`** — full Supabase Session pooler URI with the real password filled in (not the literal text `[YOUR-PASSWORD]`). See **Which password?** below.
  - `**APP_BASE_URL`** — your Render service URL (e.g. `https://bayit-shopping-app.onrender.com`). You may need to deploy once to get the URL, then set this and redeploy.
  - `**JWT_SECRET`** — Render can auto-generate this from `render.yaml`; no action needed unless prompted.
  - `GEMINI_API_KEY`, `EMAIL_API_KEY`, `VAPID_`* — set when ready (several done locally/Render).
  - `SLACK_WEBHOOK_URL` — **leave unset** (Slack skipped; see item 6).
- [x] Verify the deploy: visit `https://YOUR-APP.onrender.com/api/health` — should show `{"ok":true,"db":true,...}`.

#### Which password? (common step-3 blocker)

Render does **not** ask for a separate password. The only password you need is your **Supabase database password** — the one you chose when you created the Supabase project in step 2.

- It is **not** your Render login password.
- It is **not** your Supabase account/login password.
- It is **not** the service-role JWT from the API settings page.

Put it in the connection string where Supabase shows `[YOUR-PASSWORD]`:

```
postgresql://postgres.PROJECT_REF:YOUR_ACTUAL_DB_PASSWORD@....pooler.supabase.com:5432/postgres
```

**Forgot it?** Supabase dashboard → **Project Settings** → **Database** → **Reset database password**. Copy the new password into `DATABASE_URL` on Render (Environment tab), then **Manual Deploy** → Deploy latest commit.

**Special characters in the password?** URL-encode them in the connection string (e.g. `@` → `%40`, `#` → `%23`) or reset to a password that uses only letters and numbers to avoid encoding issues.

### 4. Get a Gemini API key — **before Phase 3**

- [x] Go to [Google AI Studio](https://aistudio.google.com) with the account that will pay (per decision: project author, personally).
- [x] Create an API key.
- [x] In Google Cloud console, set a **billing budget alert** (suggested: $5/month — expected actual usage is well under $1/semester).
- [x] Add the key as `GEMINI_API_KEY` in Render (Environment tab) and in your local `.env`.

### 5. Set up email sending — **before Phase 1 ships**

Used for magic-link sign-in and payment reminders.

- [x] Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day — plenty).
- [x] Create an API key → set as `EMAIL_API_KEY` in Render and local `.env`.
- [ ] Optional but recommended: verify a sending domain if you have one; otherwise the Resend sandbox sender works for dogfooding.

### 6. Slack webhook — **skipped for now**

- [ ] ~~Bayit Slack incoming webhook~~ **Deferred.** No semester Slack workspace yet; Ben is building solo at home first. App uses PWA push + email only. Revisit when approaching Bayit dogfood.
- [x] `SLACK_WEBHOOK_URL` left unset on Render — correct.

### 7. Web Push keys — **before Phase 2 ships**

- [x] Generate a VAPID key pair (one command, run anywhere Node is installed):

```bash
npx web-push generate-vapid-keys
```

- [x] Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in Render and local `.env`.

### 8. House decisions — **deferred (Bayit dogfood later)**

Not needed while building solo at home. Revisit before real Bayit rollout:

- [ ] Decide initial **Admin**, **Internal Manager**, and **Kitchen Head** at the Bayit.
- [ ] Pick dogfooders for the first co-op cycle.
- [ ] Tell housemates the app is coming; Venmo usernames at signup.

**Solo testing now:** one user, one "house" (your home), fake or minimal Venmo handles OK for exercising flows.

---

## Local development (for any technical housemate)

See `README.md` for full instructions. Short version:

```bash
docker compose up -d db   # local Postgres (currently running on this machine)
npm install
cp .env.example .env      # already done on this machine
npm run db:migrate        # already applied on this machine
npm run dev:api           # terminal 1 → http://localhost:3001
npm run dev:web           # terminal 2 → http://localhost:5173
```

---

## What the AI does next

**Phase 4:** Balances UI, Venmo deep links, Zelle copy, proof-of-payment upload, shopper confirm, reminder cron, auto-close, CSV export. **No Slack.**

## How to test Phase 1 locally

```bash
docker compose up -d db          # or use Supabase via .env DATABASE_URL
npm run db:migrate               # applies api/drizzle/*.sql
npm run dev:api                  # terminal 1 → :3001
npm run dev:web                  # terminal 2 → :5173
```

1. Open [http://localhost:5173](http://localhost:5173) → enter your email (Resend sandbox: must be your Resend account email).
2. Copy the magic link from the **API terminal** (also emailed in prod).
3. Complete profile → Home → **Start new run** / **Manage run** → **Open list for house**.
4. Add items (communal/personal); try adding "eggs" twice to see the duplicate warning.

## How to test Phase 2 locally

Use the Phase 1 setup above, then:

1. **Open the list** — Manage run → **Open list for house** (or Home → **Open list**). Add a few items with different sections and store preferences.
2. **Assign yourself as shopper** — Manage run → pick yourself under **Shopper** → **Save**.
3. **Lock the run** — Home or Manage run → **Heading to store**. This locks the run, saves an IndexedDB snapshot, and opens **Shop** (`/shop`).
4. **Shop view** — Items are grouped by store tab, then aisle section. Tap an item to advance `pending → in_cart → purchased`. Use **Report issue** for not-found / out-of-stock / etc.
5. **Offline check-off** — Chrome DevTools → **Network** → **Offline**. Check off more items; you should see a queued-changes indicator. Toggle back online (or use **Application → Service Workers → Sync**) and confirm items sync.
6. **Substitute flow** — On Shop, tap **Request substitute** on an item. On Home or List (same or second browser/profile as the requester), respond via the substitute badge/modal (pick an alternative, free text, or skip). Push notifications work when VAPID keys are set and permission is granted; otherwise poll the badge or refresh.
7. **Finish** — **Done shopping** moves the run to `reconciling`.

## How to test Phase 3 locally

Use the Phase 1–2 setup above, then ensure `.env` has `GEMINI_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (see action item 2).

1. Complete a shopping run through **Done shopping** (run state → `reconciling`).
2. **Upload receipts** — Home → **Upload receipts** (`/receipts`). Photograph or pick a receipt image; Gemini parses lines and auto-matches high-confidence items (`≥ 0.85`).
3. **Reconcile** — `/reconcile`: use the chat assistant to match/assign/skip lines, or resolve every line in the table (works with `GEMINI_API_KEY` unset for manual-only).
4. **Finalize** — when unresolved count is zero, **Finalize run** creates `settlements` + `balances` rows and moves the run to `settling`.
5. **Settlement math** — `npm test -w api` runs unit tests including the SDD Appendix B worked example.

**No-AI fallback:** unset `GEMINI_API_KEY` locally; upload will fail but you can still test manual resolution if you insert receipt rows via SQL, or test the table/chat error path. For full upload testing, keep Gemini + Supabase configured.

**Deploy:** push to GitHub; Render redeploys. Set `APP_BASE_URL` to your Render URL so magic links work in production. Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Render before testing receipt upload in prod.