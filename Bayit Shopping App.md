# Bayit Shopping App — Product Brief for System Design

> **Purpose of this document:** Input for writing an engineering-ready System Design Document (SDD). An SDD produced from this brief should be sufficient to build a working MVP for the Berkeley Bayit co-op.
>
> **Status:** Name in progress. Single-house deployment first; multi-house architecture is a future consideration.
>
> **How to use:** Read §1–3 for scope and constraints, §4 (Q&A) for resolved decisions and open items, §5–8 for feature and technical specs, §9 for the SDD generation prompt.

---

## 1. Context

### 1.1 Problem

The Berkeley Bayit is an ~11-person housing co-op. Members cook, shop, and clean communally. Shopping is disorganized: meal assignments are unclear, list items arrive as formatted Slack messages, the shopper consolidates them manually, receipt costs get split in a spreadsheet, and reimbursements lag.

**Product goal:** Save time and money. This is a utility app — not designed for engagement or screen time. It should be pleasant to use but not gamified in v1.

### 1.2 Users

- **Housemates (“Bayitniks”):** ~11 residents, variable 8–15 across semesters.
- **Roles (see §4.3):** Member, Shopper (per run), Kitchen Head, Internal Manager, Admin.

### 1.3 Stores (v1)

- **Safeway** and **Trader Joe's** near Elmwood, Berkeley — typically one trip hits both.
- Kosher meat is often sourced at TJ's; stock-outs have happened (no real-time inventory integration).

### 1.4 Cadence (known)

- **3 communal meals per week:** Sunday, Tuesday, Thursday.
- **Default shopping day:** Sunday (same trip typically covers Safeway + TJ's).
- **~15 shopping runs per semester.**
- Meal assignments currently use an external weekly form; the app should eventually own or mirror this.

### 1.5 References

| Product | Notes |
|---------|-------|
| [Anylist](https://www.anylist.com/features) | Feature-rich; not open or free |
| [KitchenOwl](https://github.com/TomBursch/kitchenowl) | Open, free; evaluate for reuse vs greenfield |

---

## 2. MVP Definition

### 2.1 One-sentence MVP

**Replace the Slack shopping-list message format and the post-trip receipt spreadsheet for one complete shopping cycle** — from list building through settlement — for all active Bayit housemates.

### 2.2 Core loop (v1)

```
List opens → housemates add items → shopper shops (offline check-off) →
receipt(s) uploaded → costs split → housemates pay shopper → run closed
```

### 2.3 In scope for MVP

| Area | v1 requirement |
|------|----------------|
| **Shopping list** | Shared list; personal vs communal per item; fuzzy duplicate warnings; list locked until previous run is closed |
| **Shopping run** | Schedule/display next run; assign shopper; organize list by store + section (generic categories OK) |
| **In-store** | PWA offline: read list + check off / move to In Cart; sync on reconnect |
| **Substitutes** | Requester can list alternatives at add-time; notify on mismatch; no response → shopper not obligated |
| **Receipts** | Upload photo(s); OCR + Gemini parse; AI chat correction UI on laptop; match to list items |
| **Settlement** | Communal split + personal charges; per-person balances owed to shopper; Venmo deep links + Zelle copy |
| **Payments** | Payment proof upload required to mark settled; reminders for outstanding balances |
| **Meals (basic)** | Internal manager assigns people to weekly meals; allergies/preferences on profile; conflict warnings before meal confirm |
| **Auth** | House invite flow; profiles include allergies, Venmo username, Zelle contact |
| **Admin** | Semester turnover: deactivate members, exclude from future splits; outstanding balances carry forward |
| **Issue log** | Shopper can log problems (out of stock, couldn't find item) for future reference |

### 2.4 Out of scope for MVP (defer)

| Feature | Target |
|---------|--------|
| 3D aisle mapping from store video | v2+ |
| Real-time grocery stock APIs | **Scrapped** |
| Cross-store price optimization (“price science”) | v2 (ledger still logs prices in v1) |
| Coupon tracking and rewards numbers | v2 |
| Shopping duration estimates / ML model | v2 |
| Kitchen-head consumption surveys with cadence logic | v2 |
| AI recipe assistant (scale bolognese to 10) | v1.1 — manual list entry sufficient for MVP |
| Full two-way Slack bot (`/bayit-list add …`) | v1.1 — see §4.10 |
| Gamification (points, languages, seasonal homepage) | v2+ |
| Multi-house self-serve onboarding | Post-Bayit |

### 2.5 Acceptance criteria (dogfood)

1. All housemates add items in-app instead of Slack for one full cycle.
2. Shopper completes a Safeway + TJ's trip using offline check-off.
3. Shopper uploads receipt(s) and finalizes splits without opening the spreadsheet.
4. Every housemate with a balance can pay via Venmo deep link or Zelle copy and upload proof.
5. Admin can close the run and open the next list.

---

## 3. Product Constraints

- **Anti-engagement:** Minimize time in app; no infinite scroll or attention hooks.
- **Offline-critical:** Cellular dead zones in TJ's/Safeway; shopper workflow must work offline.
- **Long-term ops:** Low maintenance after technical housemates graduate; Dockerized, free-tier hosting; admin self-service for roster changes.
- **Budget:** Prefer $0/month hosting. Gemini/OCR paid by project author personally; minimize API usage and prefer free tiers where possible.

---

## 4. Design Decisions Q&A

Answers are marked **DECIDED** (from brainstorming), **PROPOSED** (reasonable default for SDD — confirm before build), or **OPEN** (blocks detailed design).

### 4.1 Scope

| # | Question | Answer |
|---|----------|--------|
| Q1 | What is the single core loop for v1? | **DECIDED:** List → shop → receipt → settle → close run. Meal planning supports the list but is secondary to replacing Slack + spreadsheet. |
| Q2 | Which features are explicitly out of v1? | **DECIDED:** See §2.4. |
| Q3 | Is Slack required for v1? | **PROPOSED:** App-first. Slack v1 = optional read-only notifications (run scheduled, shopper heading out, payment reminders). Slash commands deferred to v1.1. |
| Q4 | Is the AI recipe assistant required for v1? | **PROPOSED:** No. Manual item entry + meal-linked suggestions (if meals in app) are enough. AI freestyle prompts → v1.1. |
| Q5 | Is full meal assignment + allergy flow required for v1? | **PROPOSED:** Yes, basic flow: manager assigns meals, profiles store allergies/preferences, conflicts shown before confirm. Dish offer + co-chef approval included. Auto-push ingredients to list → suggest only, not auto-add. |
| Q6 | Is receipt OCR + auto-split required for v1? | **DECIDED:** Yes — centerpiece of money-saving value. AI chat assists correction on laptop; not fully unattended. |

### 4.2 Weekly rhythm & state machine

| # | Question | Answer |
|---|----------|--------|
| Q7 | Canonical week? | **DECIDED:** Meals Sun / Tue / Thu; default shopping day Sunday. House config in schema for future houses. |
| Q8 | When does the list open/close? | **DECIDED:** Items cannot be added until previous shopping is completed. **PROPOSED:** Run completes when shopper marks done AND receipt settlement is finalized (balances computed); admin can force-close. |
| Q9 | Adds after shopper starts? | **PROPOSED:** Allowed until shopper taps "Heading to store" — then list locks for new items; in-cart edits/substitute flags still allowed. |
| Q10 | Who schedules the run? | **DECIDED:** Often decided hours before — house org problem. App displays time once set and sends reminders. **PROPOSED:** Internal manager or kitchen head sets datetime + shopper in app. |
| Q11 | One run or multiple per week? | **DECIDED:** Usually one trip covering both Safeway and TJ's. **PROPOSED:** Single `ShoppingRun` with multiple store legs and multiple receipt uploads. |

**PROPOSED run states:** `Draft → Open → Locked (shopping) → Reconciling (receipt) → Settling → Closed`

**PROPOSED item states:** `Pending → In_Cart → Purchased → Archived` (per §7.3)

### 4.3 Roles & permissions

| # | Question | Answer |
|---|----------|--------|
| Q12 | Roles in v1? | **PROPOSED:** `Member`, `Shopper` (per run), `KitchenHead`, `Manager` (meal assignment), `Admin` (roster, force-close). One person may hold multiple roles. |
| Q13 | Who can do what? | **PROPOSED:** All members: view/add/edit/delete any list item (transparency). Manager: meal assignments. Shopper (assigned): upload receipts, mark run progress, log issues. Admin: deactivate users, force-close runs. |
| Q14 | Single-tenant or multi-house? | **DECIDED:** Bayit first. **PROPOSED:** Schema includes `House` entity for future reuse; no multi-house UI in MVP. |
| Q15 | Onboarding? | **PROPOSED:** Admin sends invite link; new user sets profile (allergies, Venmo, Zelle). |
| Q16 | Semester turnover? | **DECIDED:** Admin removes people from future cost division each semester. Outstanding balances **carry forward** — former members can still log in and pay what they owe. |
| Q17 | Headcount for splits? | **PROPOSED:** Default communal split among active members at run close; admin can exclude absent members. Configurable denominator per house. |

### 4.4 Authentication & identity

| # | Question | Answer |
|---|----------|--------|
| Q18 | Sign-in method? | **PROPOSED:** Email magic link or Google OAuth (low friction for co-op). |
| Q19 | Venmo/Zelle required at signup? | **PROPOSED:** Venmo username required before first settlement; Zelle optional (fallback). |
| Q20 | Display names? | **PROPOSED:** First name + last initial in UI; full name admin-only. |

### 4.5 Shopping list

| # | Question | Answer |
|---|----------|--------|
| Q21 | Personal vs communal? | **DECIDED:** User selects per item. Meal ingredients → communal by default. Standing staples (eggs, etc.) → communal. |
| Q22 | Recurring staples in v1? | **PROPOSED:** Manual re-add each week in MVP. Kitchen-head surveys → v2. |
| Q23 | Duplicate handling? | **DECIDED:** Fuzzy match warning. **PROPOSED:** User chooses merge quantities or keep separate. |
| Q24 | Item fields (minimum)? | **PROPOSED:** Name (required), quantity, unit, personal/communal, requester, optional notes, optional store preference, optional alternatives[]. |
| Q25 | Alternatives policy? | **DECIDED:** Encouraged at add-time. No alternatives + no response → shopper not obligated. |
| Q26 | Substitute notifications? | **PROPOSED:** Push (PWA) + in-app badge; Slack if integrated. No SMS in v1. |

### 4.6 Stores & organization

| # | Question | Answer |
|---|----------|--------|
| Q27 | Which stores? | **DECIDED:** Elmwood Safeway + TJ's. **PROPOSED:** Hardcoded in v1; configurable later. |
| Q28 | Aisle/section sorting? | **DECIDED:** Organize by store and section at shop time. **PROPOSED:** Generic sections (Produce, Dairy, Meat, Dry goods, Frozen, Other) per store — no 3D path in v1. |
| Q29 | Store per item? | **PROPOSED:** Optional user preference; shopper can override. Default "Any" if unknown. |
| Q30 | Kosher rules in app? | **PROPOSED:** No automated enforcement in v1; note field + institutional knowledge. Issue log captures stock-outs. |

### 4.7 Meal planning

| # | Question | Answer |
|---|----------|--------|
| Q31 | Recipe source? | **PROPOSED v1:** Chef enters meal title + ingredient list manually or confirms suggested ingredients. URL import → v1.1. |
| Q32 | Scaling? | **DECIDED:** Scale to house size (e.g. 10–11). **PROPOSED:** Cook enters servings; default = active member count. |
| Q33 | Allergy/preference fields? | **DECIDED:** Collected at signup. **PROPOSED:** Structured common allergens (checkboxes) + free-text preferences. |
| Q34 | Dish approval? | **DECIDED:** Co-chefs approve offered dishes. **PROPOSED:** Async approval with 48h deadline before meal lock. |
| Q35 | Meal → list integration? | **DECIDED:** Suggest items from meals. **PROPOSED:** One-click "Add all to communal list" — never silent auto-add. |

### 4.8 Receipts & cost splitting

| # | Question | Answer |
|---|----------|--------|
| Q36 | Communal split rule? | **PROPOSED:** Even split across active members at run close (see Q17). |
| Q37 | Shared supplies? | **PROPOSED:** Communal by default (cleaning, spices, etc.). |
| Q38 | Tax, bags, fees? | **PROPOSED:** Communal items split like groceries; tax on personal items → personal. Shopper assigns ambiguous lines during reconciliation. |
| Q39 | Unmatched receipt lines? | **PROPOSED:** Shopper assigns communal/personal/skip via AI chat UI. |
| Q40 | Multiple receipts per run? | **DECIDED:** Yes (Safeway + TJ's). Single settlement per run. |
| Q41 | Manual review? | **DECIDED:** AI chat on laptop; expect review every trip until matching improves. |
| Q42 | Historical ledger in v1? | **PROPOSED:** Store all purchases and prices for future price science; no analytics UI in v1. |

### 4.9 Payments & debts

| # | Question | Answer |
|---|----------|--------|
| Q43 | Settlement model? | **PROPOSED:** Bilateral per run: "You owe [Shopper] $X for [Run date]." Running net ledger → v2. |
| Q44 | Partial payments? | **PROPOSED:** Allowed; balance tracks remainder. Round to cents. |
| Q45 | Proof of payment? | **DECIDED:** Screenshot upload required to mark paid (fool-proof vs deep-link alone). Venmo deep link pre-fills payment. |
| Q46 | Reminders? | **DECIDED:** Frequent reminders for outstanding balances. **PROPOSED:** Daily after 3 days unpaid; admin notified after 7. |
| Q47 | Cross-semester debt? | **DECIDED:** Balances carry forward across semesters; no forced settlement on deactivation. Reminders continue until paid. |

### 4.10 Notifications & Slack

| # | Question | Answer |
|---|----------|--------|
| Q48 | Slack in MVP? | **PROPOSED:** Optional webhook notifications only in v1; Bolt slash commands in v1.1. |
| Q49 | Without Slack? | **PROPOSED:** PWA push + email for critical events. |
| Q50 | Critical alerts (v1)? | **DECIDED/PROPOSED:** Run scheduled, list locking soon, substitute needed, balance owed, payment reminder. |

### 4.11 Offline PWA

| # | Question | Answer |
|---|----------|--------|
| Q51 | Offline depth in v1? | **PROPOSED:** Read list + check-off / In Cart + substitute flags. No offline add/delete (requires sync). |
| Q52 | Conflict resolution? | **PROPOSED:** Last-write-wins for check-off; server timestamp wins on reconnect. Duplicate adds merged via fuzzy match on sync. |
| Q53 | Primary devices? | **DECIDED:** Phone in-store; laptop for receipt AI chat. |

### 4.12 Technology & ops

| # | Question | Answer |
|---|----------|--------|
| Q54 | Stack preference? | **PROPOSED:** React/TypeScript PWA + Node.js/TypeScript API + PostgreSQL — single language, good PWA tooling. Python/FastAPI acceptable if builder prefers. |
| Q55 | Hosting budget? | **DECIDED:** Free tier (Render, Fly.io, Supabase). |
| Q56 | Gemini/API ownership? | **DECIDED:** Project author pays personally. SDD should minimize token usage; support env-var API key swap; document rough per-receipt cost. |
| Q57 | KitchenOwl fork vs greenfield? | **DECIDED:** Spike KitchenOwl before implementation; SDD should document both integration and greenfield paths until spike completes. |

### 4.13 Success & timeline

| # | Question | Answer |
|---|----------|--------|
| Q58 | MVP success (one sentence)? | See §2.1. |
| Q59 | Dogfooders? | **PROPOSED:** Author + 2 housemates (one shopper, one frequent list-adder) for first full cycle. |
| Q60 | Timeline? | **DECIDED:** First full dogfood cycle **this semester** — prioritize MVP scope over v1.1 polish. |

### 4.14 Legal & data

| # | Question | Answer |
|---|----------|--------|
| Q61 | Receipt retention? | **PROPOSED:** Keep through semester + 90 days; admin export/delete. |
| Q62 | Payment handles? | **PROPOSED:** Stored per user; visible to housemates for settlement only. |
| Q63 | Export? | **PROPOSED:** CSV export of ledger and balances for migration off app. |

### 4.15 Prior brainstorming resolutions (Gemini session)

| Topic | Resolution |
|-------|------------|
| 3D aisle mapping | Layouts stable enough near Elmwood to be worth it eventually — **deferred past MVP** |
| Real-time stock | **Scrapped** — no public APIs |
| Receipt OCR ambiguity | AI chat correction UI on laptop |
| Venmo vs screenshot | Both: deep links for convenience, screenshot to confirm settlement |
| Long-term maintenance | Self-running app; admin manages roster each semester |

---

## 5. Feature Specifications (by priority)

### 5.1 P0 — Shopping list (centerpiece)

- Replaces formatted Slack messages as the canonical list.
- Each item: personal or communal, requester, optional quantity/unit/notes/alternatives.
- Fuzzy duplicate warning on add.
- List gated: inactive while a run is `Open` through `Settling`; opens when previous run `Closed`.
- Suggest items from confirmed meals and purchase history (simple frequency, not ML).

### 5.2 P0 — Shopping run & in-store

- Create run: datetime, assigned shopper, optional store order.
- "Heading to store" locks new items.
- Sort items by store → section.
- Offline: cache list in IndexedDB; check off / In Cart; background sync on reconnect.
- Shopper logs issues (out of stock, not found) linked to item.

### 5.3 P0 — Receipt reconciliation

1. Shopper uploads receipt image(s).
2. OCR extracts raw text.
3. Gemini returns structured JSON (schema in SDD).
4. Auto-match to list items; transition matched → `Purchased`.
5. Unmatched → AI chat UI (laptop) for shopper to resolve.
6. Compute communal total ÷ split denominator; assign personal lines to requesters.

### 5.4 P0 — Settlement

- Per-member balance owed to shopper for the run.
- Venmo deep link: `venmo://paycharge?txn=charge&recipients=USERNAME&amount=X&note=Bayit...`
- Zelle: copy recipient + amount.
- Upload payment screenshot → mark `Paid`; partial payments supported.
- Automated balance reminders.

### 5.5 P1 — Meal planning (basic)

- Manager assigns members to 3 weekly meals.
- Profiles: allergies + preferences.
- Conflict warnings before meal confirmation.
- Co-chefs approve proposed dishes.
- Suggest ingredients → one-click add to communal list.

### 5.6 P1 — Slack notifications (optional v1)

- Outbound only: run scheduled, shopper en route, payment nudge.
- v1.1: Bolt bot, `/bayit-list add`, two-way sync.

### 5.7 P2+ — Deferred

See §2.4 (price science, surveys, 3D aisles, AI recipe chat, gamification).

---

## 6. Problem → Solution Map (original notes)

### Time problems

| Problem | Solution | MVP? |
|---------|----------|------|
| Meal assignment takes time | Manager assigns in app; allergy conflicts surfaced | P1 |
| Recipe → list takes time | Suggest ingredients; AI scaling | P1 / v1.1 |
| Unclear shopping time | Display + reminders once scheduled | P0 |
| Slack list format | Shared shopping list app | P0 |
| Staples run out early | Kitchen-head surveys | v2 |
| Consolidating Slack messages | Single live list | P0 |
| Shopping takes too long | Duration model + 3D path | v2 |
| TJ's kosher meat out | Issue log (not live stock) | P0 log only |
| Can't find item, call requester | Alternatives + async notify | P0 |
| Receipt → spreadsheet | OCR + Gemini + auto-split | P0 |
| Chasing reimbursements | Balances + Venmo + proof + reminders | P0 |

### Money problems

| Problem | Solution | MVP? |
|---------|----------|------|
| Shopper financial liability | Fast settlement + reminders | P0 |
| Wrong store pricing | Price logging; optimize later | Log in v1 |
| Coupons / rewards | Track and surface | v2 |

---

## 7. Technical Architecture (decided direction)

### 7.1 Stack & deployment

- **Frontend:** Progressive Web App (service workers, installable).
- **Backend:** Node.js/TypeScript API (or Python/FastAPI).
- **Database:** PostgreSQL.
- **Containers:** Docker; deploy to free-tier (Render, Fly.io, or Supabase).
- **No native app** — avoids App Store fees and approval delays.

### 7.2 Offline-first

- Service worker caches app shell.
- IndexedDB holds active run's list for shopper.
- Background Sync queues check-offs when offline.
- Conflict policy: see Q52.

### 7.3 Data model (core entities)

| Entity | Purpose |
|--------|---------|
| `House` | Bayit config: split rules, stores, meal days |
| `User` | Profile, allergies, payment handles, role flags |
| `Meal` | Weekly meal slot, assigned cooks, approved dish |
| `ShoppingRun` | Cycle container: schedule, shopper, state, receipts |
| `ListItem` | Name, qty, personal/communal, alternatives, state enum |
| `Receipt` / `ReceiptLine` | Uploaded image, parsed lines, match confidence |
| `Settlement` / `Balance` | Who owes whom for which run |
| `PurchaseLedger` | Historical prices for future analytics |
| `ShopperIssue` | Stock-out, not found, etc. |

**Item state enum:** `Pending → In_Cart → Purchased → Archived`

### 7.4 Integrations

| Integration | v1 scope |
|-------------|----------|
| **Gemini API** | Receipt OCR post-processing → structured JSON |
| **Slack** | Outbound webhooks; full Bolt bot → v1.1 |
| **Venmo** | Deep-link generation (no Venmo API) |
| **Zelle** | Clipboard copy fallback |

### 7.5 Permissions

- All active members: full CRUD on list items (transparency).
- Shopper + admin: receipt and run state transitions.

---

## 8. Resolved Survey (Jun 2026)

| Topic | Decision |
|-------|----------|
| Schedule | Meals Sun / Tue / Thu; shop Sunday |
| Debt on exit | Balances carry forward; former members can still pay |
| Gemini billing | Author pays personally; minimize usage |
| KitchenOwl | Spike first, then fork vs greenfield |
| Dogfood target | This semester |

**Remaining pre-build task:** Complete KitchenOwl spike (Q57) and record outcome in SDD §Implementation Strategy.

---

## 9. SDD Generation Prompt

Use the following when writing the System Design Document:

---

Act as a Lead Software Architect and Full-Stack Engineer. Write a comprehensive, engineering-ready **System Design Document (SDD)** for the **Bayit Shopping App** — a collaborative, offline-first PWA for an ~11-person housing co-op.

**Source of truth:** This document (§1–8). Treat **DECIDED** and **PROPOSED** answers in §4 as requirements unless marked **OPEN**. Flag **OPEN** items as assumptions with alternatives.

**MVP scope:** §2.3 (in) and §2.4 (out). Do not design v2 features except where v1 schema should extensibility (e.g. price ledger).

**Required SDD sections:**

1. **Executive Summary**
2. **System Architecture** (textual diagram: PWA, API, Postgres, Gemini, optional Slack webhooks)
3. **Database Schema & DDL** — entities in §7.3; item state machine; run state machine (§4.2)
4. **Core API Endpoints** — list CRUD, run lifecycle, receipt upload, reconciliation chat, settlement
5. **Offline Sync & Conflict Resolution** — service worker, IndexedDB, background sync (§7.2, Q51–Q52)
6. **Gemini OCR Pipeline** — upload → OCR → Gemini prompt → **exact JSON schema** for receipt lines and list matching
7. **Financial Settlement** — communal/personal split rules (§4.8), Venmo deep links, Zelle fallback, proof upload
8. **Slack Integration** — v1 webhook notifications; note v1.1 Bolt scope separately
9. **Failure Modes & Mitigations** — OCR errors, offline conflicts, unpaid balances, member turnover
10. **MVP Implementation Phases** — ordered build plan to satisfy §2.5 acceptance criteria

**Stack constraints:** PWA + Node/TS (preferred) or FastAPI + PostgreSQL + Docker + free-tier hosting.

**Tone:** Engineering-ready. A developer with no prior context should be able to implement the MVP from this SDD alone.

---
