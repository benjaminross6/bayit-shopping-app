# Bayit Shopping App

Collaborative, offline-first shopping app for the Berkeley Bayit co-op. Replaces Slack list messages and the receipt spreadsheet with a shared list, receipt AI reconciliation, and Venmo settlement.

- **Product brief:** `Bayit Shopping App.md`
- **System design:** `Bayit Shopping App SDD.md`
- **Human setup steps:** `human_instructions.md`

## Stack

| Part | Tech |
|------|------|
| `web/` | React + TypeScript PWA (Vite, vite-plugin-pwa) |
| `api/` | Fastify + TypeScript, Drizzle ORM |
| DB | PostgreSQL 16 (Supabase in prod, Docker locally) |
| Deploy | Single Docker image on Render free tier (`render.yaml`) |

## Local development

```bash
# 1. Start Postgres
docker compose up -d db

# 2. Install dependencies
npm install

# 3. Configure env
cp .env.example .env

# 4. Apply migrations
npm run db:migrate

# 5. Run API (terminal 1) and web (terminal 2) — both must stay running
npm run dev:api
npm run dev:web
```

Web dev server: http://localhost:5173 (proxies `/api` to the API on :3001).

**Sign in locally:** enter your email on the sign-in page. In dev, the magic link appears on screen after submit (and in the `dev:api` terminal). Resend’s sandbox only delivers email to the address on your Resend account; use the on-screen link for other addresses.

Run each setup command separately (don’t paste the whole block at once — shell comments like `#` will error in zsh).

**If `dev:api` fails with an esbuild version mismatch:** from the repo root run `rm -rf node_modules && npm install`, then try again. The repo pins `tsx@4.19.4` to stay compatible with Vite’s `esbuild`.

**If Vite shows `proxy error: ECONNREFUSED`:** the API is not running on :3001. Start `npm run dev:api` in a separate terminal and wait for `Server listening at http://127.0.0.1:3001`. If port 3001 is stuck, quit duplicate `dev:api` processes and try again.

## Database migrations

Schema lives in `api/src/schema.ts` (mirrors SDD §3). After editing:

```bash
npm run db:generate   # emit SQL migration into api/drizzle/
npm run db:migrate    # apply to DATABASE_URL
```

Production runs migrations automatically on boot (`api/dist/migrate.js`).

## Production build

```bash
docker build -t bayit .
docker run -p 3001:3001 --env-file .env bayit
```

The image serves the built PWA and the API from one Fastify process.
