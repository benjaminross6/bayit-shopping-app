# Human Instructions

> Living document. The AI updates this file as the project advances; humans complete the checkboxes. Items are ordered — do them top to bottom.
>
> **Last updated:** June 9, 2026 — Phase 0 complete.

---

## Current project status

| Phase | Status |
|-------|--------|
| Phase 0 — KitchenOwl spike + scaffold | ✅ **Done.** Verdict: greenfield (SDD §11). Monorepo scaffolded; Postgres schema migrated locally; API health-checked; PWA builds with service worker |
| Phase 1 — Auth, house, list | ⏳ Next up (AI work; needs items 1–3 below first) |
| Phase 2 — Shop mode + offline | Not started |
| Phase 3 — Receipts + reconciliation | Not started (needs item 4) |
| Phase 4 — Settlement + payments | Not started |
| Phase 5 — Meals + Slack | Not started (needs item 6) |

---

## Action items for humans

### 1. Create the GitHub repository — **do now**

- [ ] Create a new GitHub repo (e.g. `bayit-shopping-app`), private or public — your call.
- [ ] From this project folder, run:

```bash
git init
git add .
git commit -m "Phase 0: scaffold + SDD"
git remote add origin git@github.com:YOUR_USERNAME/bayit-shopping-app.git
git push -u origin main
```

The `.gitignore` already excludes `node_modules/`, `.env`, and the KitchenOwl spike clone.

### 2. Create the Supabase project (database + file storage) — **do now**

- [ ] Sign up at [supabase.com](https://supabase.com) (free tier).
- [ ] Create a project named `bayit` (region: US West for Berkeley latency).
- [ ] Copy the **connection string** (Project Settings → Database → Connection string, "URI" tab, use the *session pooler* variant) — this becomes `DATABASE_URL` in production.
- [ ] Create a **storage bucket** named `receipts` (private) — used from Phase 3 onward.
- [ ] Save the project's service-role key somewhere safe (needed when storage is wired up in Phase 3).

### 3. Create the Render service — **do now**

- [ ] Sign up at [render.com](https://render.com) (free tier).
- [ ] New → Blueprint → connect the GitHub repo from step 1. Render reads `render.yaml` automatically.
- [ ] When prompted for environment variables, set:
  - `DATABASE_URL` — the Supabase connection string from step 2
  - `APP_BASE_URL` — the Render URL it assigns (e.g. `https://bayit-shopping-app.onrender.com`)
  - Leave `GEMINI_API_KEY`, `EMAIL_API_KEY`, `VAPID_*`, `SLACK_WEBHOOK_URL` empty for now — filled in by later steps.
- [ ] Verify the deploy: visit `https://YOUR-APP.onrender.com/api/health` — should show `{"ok":true,"db":true,...}`.

### 4. Get a Gemini API key — **before Phase 3**

- [ ] Go to [Google AI Studio](https://aistudio.google.com) with the account that will pay (per decision: project author, personally).
- [ ] Create an API key.
- [ ] In Google Cloud console, set a **billing budget alert** (suggested: $5/month — expected actual usage is well under $1/semester).
- [ ] Add the key as `GEMINI_API_KEY` in Render (Environment tab) and in your local `.env`.

### 5. Set up email sending — **before Phase 1 ships**

Used for magic-link sign-in and payment reminders.

- [ ] Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day — plenty).
- [ ] Create an API key → set as `EMAIL_API_KEY` in Render and local `.env`.
- [ ] Optional but recommended: verify a sending domain if you have one; otherwise the Resend sandbox sender works for dogfooding.

### 6. Slack webhook (optional) — **anytime before Phase 5**

- [ ] In the Bayit Slack workspace: create an app → enable **Incoming Webhooks** → add a webhook to the shopping channel.
- [ ] Set the URL as `SLACK_WEBHOOK_URL` in Render. Leave unset to disable Slack entirely — the app works without it.

### 7. Web Push keys — **before Phase 2 ships**

- [ ] Generate a VAPID key pair (one command, run anywhere Node is installed):

```bash
npx web-push generate-vapid-keys
```

- [ ] Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in Render and local `.env`.

### 8. House decisions — **before first dogfood cycle**

- [ ] Decide who the initial **Admin**, **Internal Manager**, and **Kitchen Head** are (one person can hold several).
- [ ] Pick the 2–3 dogfooders for the first cycle: one shopper + one frequent list-adder + you.
- [ ] Tell housemates the app is coming and that Venmo usernames will be requested at signup.

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

## What the AI does next (no human action needed)

Phase 1: magic-link auth, invite flow, profiles (allergies, Venmo/Zelle), run lifecycle (`Draft → Open`), list CRUD with personal/communal tagging and fuzzy duplicate detection. Blocked only on steps 1–3 above for deployability; local development can proceed immediately.
