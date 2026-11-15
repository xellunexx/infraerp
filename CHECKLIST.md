# SYNCHRO — implementation checklist (honest status)

A module is ticked only when its operations, persistence, permissions and integrations are tested — not when a screen exists.
Tests: `npm test` (6 tests, all passing at the last run). Web build: `npm run build` (passes).

## Phase 1 — Foundation
- [x] Database schema (SQLite, WAL, foreign keys) — all phases' tables created
- [x] Login, first-run admin setup, sessions, password hashing (scrypt)
- [x] Departments, roles, per-role permissions (read/write/approve) enforced on the server; editable in Settings — tested
- [x] Brigadier sees only assigned projects; no financial data without `finance.read` — tested
- [x] Audit log on every write; optimistic concurrency (409 on stale save) — tested on contracts
- [x] Event engine: outbox events with dedupe key, per-handler effects recorded once, retries with backoff, failed state, manual retry, crash recovery — tested
- [x] Customers, products, СМР operations with recipes (API + screens)
- [x] Inquiries and offers: versions, revisions (old version kept and locked), send, reject, confirm — tested
- [x] Offer template from the company Excel: cost breakdown, overhead/profit/corporate tax formula, manual price, sections, alternative variants,
      header fields (attention to, date, validity months → valid until) — tested against hand-worked figures
- [x] Offer confirmed → Project Card + КС lines + recipes + lifecycle stages + contract draft + notifications (sync handlers) — tested
- [x] Contract: draft → review → approve (immutable version 1 + Appendices 1-3) → signed; special terms need Management approval — tested
- [x] Contract signed → baseline active, dates, linear schedule built from planned days, procurement + technical review tasks — tested
- [x] Project Card screen: overview, lifecycle (complete / skip / reopen / extra stage), customer and site/logistics data, contract, КС, timeline, audit
- [x] Search (FTS) across projects, customers, contracts, offers, products — permission-filtered
- [ ] Offer number rule (running number + preparer's letter G/S/P/T) — schema only
- [ ] Ready system templates from the Excel (MultiPLAY, InfraSPORT, Padel, tiles, GreenSet, grass, equipment) — not loaded
- [ ] Labour calculator (Труд) and recipe calculators (SBR/EPDM/Corkeen/grass, pallet rounding) — not built
- [ ] Printable offer in the company layout (logo, pictures, clauses, footer) and Excel export — not built
- [ ] Documents and file versioning (uploads, photos, line images) — tables exist, no API
- [ ] Contract amendments / annexes (new versions after signing) — versioning core exists, no amendment workflow yet
- [ ] Backups (daily copy + manual backup/restore) — not built

## Phase 2 — Execution: NOT started (Technical, Brigadier mobile screen, schedule editing/Gantt, daily progress, photos, consumption alerts)
   Calculations already written and used by the Project Card: progress %, theoretical vs actual consumption (`server/calc.js`) — consumption not tested yet.
## Phase 3 — Resources: NOT started (Warehouse, requests, reservations, Logistics, machinery, transfers, returns)
## Phase 4 — Financial control: NOT started (proformas, income/expenses, payment requests/approvals, reconciliation)
   Finance figures on the Project Card are computed from transactions/proformas; there is no way to enter them yet.
## Phase 5 — Management intelligence: NOT started (global dashboard beyond the role-aware start page, profitability, deviations, workload, reports)

## Hosting
- [ ] Served as Devin App `synchro` with `deploy_devin_app` — the tool was not available in this session (searched several times)