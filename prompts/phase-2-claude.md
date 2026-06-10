# Phase 2 Implementation Prompt (Claude)

Copy everything below the line into Claude (or another coding agent) with the repo open as context.

---

You are implementing **Phase 2** of the Bayit Shopping App — shop mode, offline sync, substitute requests, and Web Push.

## Source of truth (read these first)

1. **`Bayit Shopping App SDD.md`** — §4.2–4.3, §5, §7, §10 Phase 2
2. **`human_instructions.md`** — scope notes: no Slack, no secrets in git
3. **Existing code** — `api/src/routes/runs.ts`, `api/src/routes/items.ts`, `web/src/pages/ShopPage.tsx`

Do not build Phase 3+ (receipts, settlement). Do not add Slack.

## Phase 2 scope — implement exactly this

### Backend

- `requireShopper` in `api/src/lib/context.ts` (shopper or admin)
- `POST /api/runs/:id/lock` — open→locked, return list snapshot
- `POST /api/runs/:id/done-shopping` — locked→reconciling
- `PATCH /api/items/:id/state` — item state transitions + idempotency (`clientId`+`seq`)
- Loosen `POST /runs/:id/items` for locked shopper substitute adds (`shopperSubstitute: true`)
- `POST /api/push/subscribe`, `GET /api/push/vapid-public-key`
- `POST /api/items/:id/substitute-request`, `POST /api/substitute-requests/:id/respond`
- `GET /api/substitute-requests/pending`
- `POST /api/runs/:id/issues`
- Schema: `substitute_requests`, `item_sync_ops` — migration `0002_great_luckman.sql`
- `web-push` + `lib/push.ts` (VAPID from env)

### Frontend

- `web/src/pages/ShopPage.tsx` — store/section tabs, tap check-off, skip/substitute/issue
- Home + RunAdmin: "Heading to store", "Done shopping", link to `/shop`
- `web/src/offline/db.ts` + `sync.ts` — Dexie snapshot + outbox replay
- `web/src/sw.ts` — Workbox runtime cache + Background Sync tag + push handler
- Push subscription after login; `SubstituteRequests` modal for requesters

## Acceptance criteria

- [ ] Shopper locks run, shops with store→section view, marks done-shopping
- [ ] Offline check-offs queue and replay on reconnect (idempotent)
- [ ] Substitute request → push → requester responds (two browser profiles)
- [ ] `npm run typecheck -w api` and `npm run build -w web` pass
- [ ] `npm run db:migrate` applies `0002_great_luckman.sql` on fresh DB

## When done

Update `human_instructions.md`: Phase 2 complete + test steps.
