# SYNCHRO — implementation checklist (honest status)

A module is ticked only when its operations, persistence, permissions and integrations are tested — not when a screen exists.
Tests: `npm test` (21 tests, all passing at the last run). Web build: `npm run build` (passes).

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
- [x] Project Card screen: overview, lifecycle (complete / skip / reopen / extra stage), customer and site/logistics data, contract, КС, timeline, audit,
      finance, schedule, progress, logistics+mechanization, tasks+issues, documents, messages — each tab reads the shared module records, permission-gated
- [x] Search (FTS) across projects, customers, contracts, offers, products — permission-filtered
- [x] Offer number rule: one company-wide running number + the preparer's letter (e.g. 39G); next number settable in Settings, only forward — tested.
      Assumption: the running number is shared by all preparers (the Excel note does not say whether each preparer has their own sequence).
- [x] Ready system templates: 23 templates / 47 lines generated from the Excel by `tools/import_offer_template.py` into `server/seed/offer_templates.json`,
      loaded once on first start, inserted into an offer with "+ От готов шаблон" — tested (TOUR COURT line prices to 24.11 as in the Excel).
      Where the Excel takes labour from the Труд sheet (43 cells) man-days / day rate are left empty for the user. Template pictures are not carried over.
      The insert dialog itself was not clicked through in a browser (API and build are tested).
- [x] Offer editor rebuilt as the document itself ("Оферта" tab = the sheet): company logo + the Excel header grid inline
      (На вниманието на / Обект / Адрес / Оферта № / Дата / yellow валидност-месеци cell → Валидна до / Съставил + тел. / Клиент),
      each section a bordered sheet with a two-tier header (customer columns vs tinted internal "Калкулация" block: Материал,
      Доставка, Σдост., Надници, Надник, Монт./ед, Σмонтаж, Сума, Реж.%, Σреж., Себ-ст, Печ.%, Печ./ед, Σпеч., Дан.%, Дан./ед,
      Ръчна, →Ед.цена), per-section totals (без ДДС / ДДС / с ДДС), grand total excluding unselected variants, cost+margin line
      for finance users, the four legal clauses at the bottom. Internal columns toggle with "Показвай калкулацията" and never
      render for users without finance rights. Checked in a real browser on a seeded offer.
- [x] Smart line input: the description cell searches СМР and products as you type; a pick fills description + unit + labour norm
      (man-hours ÷ 8 → надници) for СМР or unit + material cost for products; the picked source shows as a СМР/МАТ tag and the
      catalogue id is stored on the line (offer_lines.smr_type_id / product_id). Free text still possible.
- [x] Spreadsheet behaviour in the grids: Tab/arrows walk cells, Enter moves down and adds a row at the grid end, Enter in the
      description goes to the next row (Shift+Enter = newline). Enter on an open suggestion list takes the highlighted pick.
- [x] Send preflight: lines with missing description, zero quantity or no price (neither breakdown nor manual) get a ⚠ marker
      in the № cell; "Изпрати на клиента" first lists the problem rows ("Отказ — ще поправя" / "Изпрати все пак"). Checked in
      a real browser: 2 problem rows listed, send blocked until confirmed.
- [x] Labour calculator (Труд) tab in the offer editor — built earlier (commit 480ca37), tested (`test/labour.test.mjs`).
      Recipe calculators (SBR/EPDM/Corkeen/grass, pallet rounding) — not built.
- [ ] Known inconsistency (pre-existing, not in the editor scope): the offers list/dashboard figure sums qty×unit_price over
      ALL lines of the current version, including lines in unselected alternative sections; `offerTotals` excludes them.
      The editor and print show the correct total.
- [x] Printable offer in the company layout ("Печат / PDF" on the offer): logo, header block, sections with their own totals, variants marked,
      grand total, four legal clauses (setting `offer_clauses`), footer strip. Customer columns only; a test checks no cost data leaks. Seen on screen in a browser.
- [x] Catalogue gallery wired into offers: `catalog_items` (2,581 isport + 62 Excel-image products, ~5,000 images in `files/`),
      search/detail/image/attach API, 🖼 picker on offer sections and lines, template auto-attach via `offer_templates.catalog_slug`,
      fitted `object-fit: contain` image boxes in print/PDF. `.xlsx` export embeds the same images (webp→png via sharp, fitted anchors).
      NOT verified: how it paginates on paper / in a saved PDF (footer repeat uses a repeating table footer; untested in print). Line pictures are not printed.
- [x] Excel export of an offer ("Excel" button): sheet "Оферта" in the customer layout with live formulas (line totals, section sums, VAT) and the logo;
      sheet "Калкулация" with the cost breakdown only for users who may see costs — tested by reading the produced file back. Not opened in Excel itself.
      Dependency note: exceljs pulls an old `uuid` with a moderate advisory (GHSA-w5hq-g745-h8pq, buffer bounds check when a caller passes its own buffer).
      SYNCHRO only writes workbooks and never passes such a buffer; the only offered fix downgrades exceljs, so it is left as is.
- [ ] Documents and file versioning (uploads, photos, line images) — tables exist, no API
- [ ] Contract amendments / annexes (new versions after signing) — versioning core exists, no amendment workflow yet
- [ ] Backups (daily copy + manual backup/restore) — not built

## Phase 2 — Execution: PARTIAL
- [x] Техник workspace (`/technical`): projects needing attention, open tasks/issues — tested
- [x] Tasks: create/assign to dept-user, done/reopen, `task.assigned` → notify — tested
- [x] Linear schedule: read (baseline vs current, pct/planned %, late/slip/behind), edit with 409 guard, add custom item, `schedule.changed` → brigadier+logistics — tested
- [x] Daily progress: Technical enters per-КС-line entries, uid dedupe, void-not-edit, first entry sets actual_start + execution stage — tested
- [x] Consumption view: required/expected/consumed/on-site/variance per product — tested
- [x] `progress.recorded → execution_watch`: over-consumption/unplanned → one tracked issue per product; behind-plan line → one issue per line — tested
- [x] Fixed gate: free-text offer lines (no smr_type_id) were never scheduled — now every non-product КС line gets a schedule item; PRJ-2026-001 backfilled (audit `schedule_item/backfill`) — tested
- [x] Brigadier field interface (`/brigade` + `/brigade/:id`): assigned-project scope, daily plan, progress entry, attendance, issues, photos, messages — tested
- [x] Photos/documents: multipart upload/list/download API under `documents` permission — tested (versioning tables pre-existing)
- [ ] Растер на настилките — not built (operator deferred)
- [x] Issues workflow: report → in_progress → resolved (resolution required) → reopen/cancel, dept routing + notify, UI in Бригадир — tested
- [x] Material requests: MRQ lifecycle (submit → approve+reserve → fulfil → issue) — tested; requests filed from Warehouse AND from Technical/Contracts via `/api/projects/:pid/material-requests` (origin stamped)
- [x] Machinery/asset allocation lives under Logistics (`assets` + `asset_allocations`); Warehouse gets a read-only fleet view (`/api/warehouse/fleet`)
## Phase 3 — Resources: BUILT (`/warehouse` live: stock, movements, requests, reservations, transfers, returns)
- [x] Movements: receipt/issue/return/adjust + project↔project transfer (paired `transfer_out`+`transfer_in` in one transaction, warehouse total unchanged, on-site shifts) — tested
- [x] Issue movements carry `project_line_id` from the request item → on-site consumption is attributable to a КС line — tested
- [x] Demand assistant (`/warehouse/demand`): required vs free vs reserved → suggest_qty + short — tested; now also lists products physically on-site but not in the plan (`issued > 0`)
## Phase 3.5 — Logistics: BUILT (`/logistics` live)
- [x] Portfolio: per-project delivery counts by status + live allocations + fleet status — tested
- [x] Deliveries: DLV-####, items[] (product+qty), carrier/courier/pallets/vehicle, request link, planned→in_transit→delivered/cancelled flow, 409 edits — tested
- [x] Assets: AST-#### registry (kind/plate/status/location) + project allocations with overlap guard — tested
- [x] Events: delivery.created→warehouse+technical+brigadir, delivered→site, cancelled→warehouse, asset.allocated→technical — tested
- [ ] Delivery ↔ material_request stock coupling (delivery does not yet decrement reservations/stock)
- [ ] Driver/route planning, fuel costs

## Phase 4 — Financial control: PARTIAL (Accounting module live at `/accounting`)
- [x] Proformas: issue against contracted project (PF-####, net of VAT), mark paid (posts one linked receipt, idempotent), cancel — tested
- [x] Income/expenses: manual transactions in/out, planned/committed/paid/voided, edit with 409 guard, proforma link — tested
- [x] Payment requests: file → approvals row → Management approve/reject (no auto money-posting, manual entry after) — tested
- [x] Accommodations: per-project records (place, dates, beds, cost/night, payment method) — tested
- [x] Finance views: portfolio KPIs + per-project reconciliation (`calc.finance()`) + Project Card "Финанси" tab — tested
- [x] Project lifecycle status: `projects.status` derives from the stage checklist (leading edge), on_hold/archive manual — tested; startup sweep heals existing rows
- [x] Shared ledger `/api/ledger`: fixed `tx_kind` vocabulary + free-text category, method bank/cash/card, `company` legal entity (ЕВРОВАГ), cost centers, accountable persons, assets, VAT flag+amount, PKO/RKO, labour worker×days×rate; filters + totals — tested + live-checked on a real-DB clone
- [x] Document→settlement matching: `open_amount` computed from linked paid rows, partial payments supported, payment→payment and direction-mismatch rejected — tested + live
- [x] Accountable-person cards (`/api/accountable-persons/:id/card`): given / spent / returned / balance — tested + live
- [x] Cost centers CRUD (`/api/cost-centers`) — live-checked
- [x] Supplier orders `/api/supplier-orders`: ready date from advance+prod days, days-left countdown, final amount, expected-vs-forecast delivery, auto status — tested + live
- [x] Contract payment milestones `PUT .../contract/payments` (advance/interim/final, real paid dates) + computed `final_deadline` (never typed); `contract_kind` + prod/install days editable while draft — tested + live
- [x] Dashboard buckets `/api/dashboard`: negotiating / upcoming (awaiting_advance flag) / executing — tested + live
- [x] Project reopen flow: reasoned request → Management approval → target stage active + downstream stages reset → status re-derived; events + notifications — tested
- [x] Notifications carry project + author + linked-entity status; unread filter on the page — tested
- [ ] Import of the real workbook (`Таблица ексел.xlsx`, 578-row master sheet) — analyzed as the design reference, no import tool yet
- [ ] Proforma document printing (records exist, no printable invoice yet)
- [ ] Automatic postings from completed work / cost allocations (kept manual per design — traceable + approval rules)
- [ ] Worker communication about accommodation/parking — records only
## Phase 5 — Management intelligence: PARTIAL (`/management` live)
- [x] Management board: KPIs (projects, money, approvals, overdue, critical, failed sync, in-transit), attention queues, portfolio finance table, workload by department — tested
- [x] Approval queue truthfulness: `events.approval_status` now resolves on decision (was a dead 'pending' forever) — tested
- [ ] Profitability per project deep-dive, deviation analytics, scheduled reports/exports

## Hosting
- [ ] Served as Devin App `synchro` with `deploy_devin_app` — the tool was not available in this session (searched several times)
- [x] Private preview on port 4800 (Devin sign-in required) — server answers, page loads (checked with HTTP requests)
- [x] Public internet access through a Cloudflare quick tunnel (`synchro-tools/cloudflared.exe tunnel --url http://127.0.0.1:4800`), checked from the public
      address: page 200, API 200, first-run setup refused with 403. The address is random and changes every time the tunnel restarts; Cloudflare gives
      no uptime guarantee for account-less tunnels; it stops when the session machine sleeps.
- [x] Hardening before exposure (tested, `test/exposure.test.mjs`): first administrator can only be created from the private address; 5 wrong passwords per
      user+address (20 per address) in 15 minutes lock the login for 15 minutes; failed logins are audited; Secure cookie over HTTPS; noindex header.
- [x] Deployed to dedicated VM `devops@68.210.226.194` (tenderops-vm, Ubuntu 24.04): Node 22.23.5,
      systemd `synchro.service` (:4800, SYNCHRO_DATA=/home/devops/synchro/synchro-data) + `synchro-tunnel.service`
      (cloudflared quick tunnel, empty --config to avoid the TenderOps named-tunnel 404 catch-all).
      Public: https://laboratory-founded-design-louis.trycloudflare.com (quick-tunnel URL — changes on tunnel restart;
      permanent address still needs a named tunnel + own domain). Local :4800 instance retired to prevent DB split-brain;
      local synchro-data kept as offline backup.
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
