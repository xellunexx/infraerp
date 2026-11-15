# SYNCHRO — implementation checklist (honest status)

A module is ticked only when its operations, persistence, permissions and integrations are tested — not when a screen exists.
Tests: `npm test` (14 tests, all passing at the last run). Web build: `npm run build` (passes).

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
- [x] Offer number rule: one company-wide running number + the preparer's letter (e.g. 39G); next number settable in Settings, only forward — tested.
      Assumption: the running number is shared by all preparers (the Excel note does not say whether each preparer has their own sequence).
- [x] Ready system templates: 23 templates / 47 lines generated from the Excel by `tools/import_offer_template.py` into `server/seed/offer_templates.json`,
      loaded once on first start, inserted into an offer with "+ От готов шаблон" — tested (TOUR COURT line prices to 24.11 as in the Excel).
      Where the Excel takes labour from the Труд sheet (43 cells) man-days / day rate are left empty for the user. Template pictures are not carried over.
      The insert dialog itself was not clicked through in a browser (API and build are tested).
- [ ] Labour calculator (Труд) and recipe calculators (SBR/EPDM/Corkeen/grass, pallet rounding) — not built
- [x] Printable offer in the company layout ("Печат / PDF" on the offer): logo, header block, sections with their own totals, variants marked,
      grand total, four legal clauses (setting `offer_clauses`), footer strip. Customer columns only; a test checks no cost data leaks. Seen on screen in a browser.
      NOT verified: how it paginates on paper / in a saved PDF (footer repeat uses a repeating table footer; untested in print). Line pictures are not printed.
- [x] Excel export of an offer ("Excel" button): sheet "Оферта" in the customer layout with live formulas (line totals, section sums, VAT) and the logo;
      sheet "Калкулация" with the cost breakdown only for users who may see costs — tested by reading the produced file back. Not opened in Excel itself.
      Dependency note: exceljs pulls an old `uuid` with a moderate advisory (GHSA-w5hq-g745-h8pq, buffer bounds check when a caller passes its own buffer).
      SYNCHRO only writes workbooks and never passes such a buffer; the only offered fix downgrades exceljs, so it is left as is.
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
- [x] Private preview on port 4800 (Devin sign-in required) — server answers, page loads (checked with HTTP requests)
- [x] Public internet access through a Cloudflare quick tunnel (`synchro-tools/cloudflared.exe tunnel --url http://127.0.0.1:4800`), checked from the public
      address: page 200, API 200, first-run setup refused with 403. The address is random and changes every time the tunnel restarts; Cloudflare gives
      no uptime guarantee for account-less tunnels; it stops when the session machine sleeps.
- [x] Hardening before exposure (tested, `test/exposure.test.mjs`): first administrator can only be created from the private address; 5 wrong passwords per
      user+address (20 per address) in 15 minutes lock the login for 15 minutes; failed logins are audited; Secure cookie over HTTPS; noindex header.
- [ ] Permanent public address: needs a Cloudflare account + domain (named tunnel) and a machine that stays on. Not set up.
- [ ] Not done for internet exposure: 2-factor login, password strength rules beyond 8 characters, automatic backups.
## Weather on the Project Card (requested 15:41) — reachability measured from this machine
- Geocoding: Nominatim (OpenStreetMap, full address) 200 OK; Open-Meteo geocoding (place names) 200 OK.
- Forecast sources (keyless): Open-Meteo ECMWF ~15 days, Open-Meteo GFS (NOAA model) 16 days, Open-Meteo ICON (DWD model) ~7 days,
  MET Norway (yr.no) to day 10, 7Timer 7 days, wttr.in 3 days.
- So: 7 days = 5 independent sources; 14 days = ECMWF + GFS through Open-Meteo (two different national models, one provider) + MET Norway up to day 10.
- [x] Built and tested (`test/weather.test.mjs`, 2 tests with a fake network) and checked live against the real services:
      site address geocoded (Nominatim, fallback Open-Meteo geocoding), coordinates editable by hand, 5 sources fetched (live run: ECMWF 15 days,
      GFS 16, ICON 7, MET Norway 10, 7Timer 7; refresh took 3.3 s), per-day median of all sources, spread shown, warnings for rain / wind / low temperature
      (thresholds in settings: weather_rain_mm 2, weather_wind_ms 10, weather_min_temp 5 — my defaults, not company rules), 7/14-day switch,
      per-source table, a failing source is shown and the others still work, background refresh every 3 h (weather_refresh_hours), address change resets location.
- [ ] Known accuracy issue (seen live): "Бургас, кв. Зорница" geocoded to Зорница in Несебър municipality, not the Burgas district. The resolved place is
      shown on the card with a "коригирай" link for exact coordinates; geocoding precision for short addresses is NOT solved.
- [ ] Weather thresholds are not yet on the Settings screen (stored as settings keys only).
