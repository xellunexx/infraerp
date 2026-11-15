# Changelog

## 2026-11-15 — Offer editor rebuilt as the document (Excel offer template)

The "Оферта" tab of the offer editor is now the offer document itself, modelled on
`Offer Template_+ правно административни допълнения.xlsx` (КСС / Equipment sheets).

**Layout**
- Letterhead: `offer_logo.png` + the Excel header grid inline — На вниманието на,
  Обект, Адрес, Оферта № (code), Дата, yellow "валидност N месец/а" cell driving
  the computed "Валидна до" date, Съставил + телефон, Клиент. Notes/execution
  logic collapsed under the header ("Бележки и логика на изпълнение").
- Every section is a bordered sheet: section title/description/footer editable,
  "вариант" marker, two-tier header splitting customer columns (№, Описание,
  Ед. мярка, Кол-во, Ед. цена, Стойност) from the tinted internal "Калкулация"
  block (Материал, Доставка, Σдост., Надници, Надник, Монт./ед, Σмонтаж, Сума,
  Реж.%, Σреж., Себ-ст, Печ.%, Печ./ед, Σпеч., Дан.%, Дан./ед, Ръчна, →Ед.цена).
- Each Σ column is a live read-only formula cell mirroring `server/pricing.js`
  (material+delivery+labour → direct; ×3.5% overhead; ×30% profit; ×10% tax on
  profit → customer unit price). Manual price shows the calculated value beneath.
- Per-section totals (без ДДС / ДДС 20% / с ДДС) inside the grid footer; grand
  totals at the document end excluding unselected variants, plus cost/margin
  line (finance only) and the four legal clauses from `offer_clauses`.
- Internal columns hidden unless `finance` rights + "Показвай калкулацията" on;
  never rendered into print/export regardless.

**Smart input**
- Description cell searches the СМР catalogue and products while typing.
  Picking a СМР fills description + unit + labour_days (labour_norm_h ÷ 8);
  picking a product fills description + unit + material_cost (unit_cost).
  The catalogue id is stored on the line (smr_type_id / product_id) and shown
  as a СМР/МАТ tag. Free text remains possible.
- "+ От готов шаблон" (existing templates) and the Труд calculator tab kept.

**Spreadsheet behaviour**
- Tab/Shift-Tab and arrow keys walk cells; Enter moves down and appends a row
  past the last row of a grid; Enter in the description goes to the next row
  (Shift+Enter = newline); Enter on an open suggestion list takes the pick.

**Guardrails**
- `lineIssues` flags missing description, zero quantity and no price (neither
  cost breakdown nor manual) — shown as ⚠ in the № cell; "Изпрати на клиента"
  runs a preflight listing the problem rows before sending.

**Files:** `web/src/pages/OfferEditor.tsx` (rewritten, same API/data flow),
`web/src/styles.css` (sheet/grid/doc styles), `web/public/offer_logo.png` (new).
No server/API/schema changes.

**Verified:** `npm run build` ✓; `npm test` 15/15 ✓; live browser check on a
seeded offer — header, both grids, calc toggle (54→0→54 columns), СМР pick
(fill + labour norm), Enter-adds-row (2→3 rows, focus follows), send preflight
(2 problem rows listed, send blocked), save persisted (server totals unchanged).

### Ops — quick tunnel config (same date)

- `web/cloudflared-quick.yml` (new, intentionally empty): isolates
  `cloudflared tunnel --url http://127.0.0.1:4800` from the machine-wide
  `~/.cloudflared/config.yml`, whose named-tunnel ingress catch-all
  (`http_status:404`) was answering every trycloudflare hostname with 404.
  Run: `cloudflared tunnel --config web/cloudflared-quick.yml --url
  http://127.0.0.1:4800 --no-autoupdate`. Verified: public URL 404 → 200,
  `/api/projects` 401 (auth gate intact).

## 2026-11-15 — Phase 2 slice: Техник — linear schedule, daily progress, consumption watch

**Server (`server/routes_technical.js`, new; mounted in `index.js`)**
- `GET /api/technical` workspace: active projects (progress %, open issues, overdue items, next deadline), open tasks for technical/me, open issues for technical — brigadier rows filtered by project assignment.
- Tasks: `POST /api/tasks` (assign to dept/user, `TSK-` code, `task.assigned` → notify assignee), `POST /api/tasks/:id/done|reopen`.
- Schedule: `GET /api/projects/:id/schedule` (items with pct / planned % / late_days / slip_days / behind + install deadline), `POST .../schedule` (custom item, optional КС link + dependency), `PATCH /api/schedule-items/:id` (dates/name/crew/dependency/sort; row_version → 409; `schedule.changed` → brigadier+logistics).
- Progress: `GET/POST /api/projects/:id/progress` (per-line done/qty + history; `uid` dedupe — a field double-tap is a no-op), `POST /api/progress-entries/:id/void` (void, never edit — corrections stay auditable). First entry sets `actual_start` and activates the `execution` stage. `progress.recorded`/`progress.voided` events.
- `GET /api/projects/:id/consumption` — required (contract) vs expected (by recorded progress) vs consumed (warehouse), tolerance from `overconsumption_tolerance_pct`.

**Handlers (`server/domain.js`)**
- `progress.recorded → execution_watch`: over-consumption/unplanned material opens ONE tracked `issue` per product (kind `overconsumption`, high); a worked КС line behind plan/late opens one issue per line (kind `schedule_delay`). Newly opened issues notify technical+management. Recalc needs no handler — all figures are computed on read.
- `progress.voided → notify accounting`; `schedule.changed → notify brigadier+logistics`; `task.assigned → notify assignee`.

**Bug fix (mechanism, not a line):** `init_project_card` scheduled only offer lines with `smr_type_id` — free-text work lines (most real offer lines, incl. all 6 lines of PRJ-2026-001) fell through both gates: no schedule row, no recipe row. Gate rewritten: every КС line that is not a catalogue product gets a schedule item; product lines keep their 1:1 recipe. Live repair for PRJ-2026-001 backfilled 6 items chained 24→29.11 (audit `schedule_item/backfill`).

**Web (`web/src/pages/Technical.tsx`, new; `main.tsx` routes; `styles.css` gantt bars)**
- `/technical` — workspace: KPIs, projects table, tasks (Готово action), open issues.
- `/technical/:id` — tabs: Линеен график (baseline dashed vs current bars, today + deadline markers, late/behind/slip flags, edit/add modals), Дневен прогрес (entry form + per-line bars + voidable history), Материали (planned vs actual, over/unplanned flagged).

**Verified:** `npm test` 21/21 ✓ (6 new Technical tests incl. the gate regression); `npm run build` ✓; live 127.0.0.1:4800 — CTR-0001 signed (install 24.11→19.12.2026), schedule visible, all endpoints serve real data. NOT yet checked in a real browser; no real progress entries recorded (left to the operator).

## 2026-11-15 — Счетоводство (Phase 4 core)

The `/accounting` page is built: portfolio finance overview plus record-keeping
for proformas, income/expenses, payment requests with Management approval, and
worker accommodations. Finance figures were already computed by `calc.finance()`;
this phase adds the write side — until now there was no way to enter them.

**Server — `server/routes_accounting.js` (new, mounted in `index.js`)**
- `GET /api/accounting` — every visible project with `finance()` figures + totals.
- `GET /api/projects/:pid/finance` — the reconciliation block plus the project's
  proformas, transactions, payment requests and accommodations.
- Proformas `GET/POST /api/proformas`, `POST /api/proformas/:id/paid|cancel` —
  issued against a project that has a contract (`PF-####`, amount net of VAT,
  `vat_pct` defaults from settings). "Платена" posts exactly one incoming
  transaction linked by `proforma_id` (idempotent — repeat calls return the same
  receipt, no double-posting); cancelled proformas drop out of `invoiced`.
- Transactions `GET/POST /api/transactions`, `PATCH /api/transactions/:id` —
  manual income/expense, direction in/out, status planned/committed/paid/voided.
  No delete: corrections are audited edits; `voided` is excluded from every
  `finance()` total automatically.
- Payment requests `GET/POST /api/payment-requests`,
  `POST /api/payment-requests/:id/approve|reject` — filed by accounting, each
  creates an `approvals` row; only `approvals.approve` holders decide.
  `exceptional` auto-flags amounts over `exceptional_expense_limit`.
  Approval does **not** post money — the expense is entered manually afterwards
  (operator decision). `payment_request.created` notifies Management,
  `payment_request.decided` notifies Счетоводство.
- Accommodations `GET/POST /api/accommodations`, `PATCH /api/accommodations/:id`.
- All writes hit `audit_log` (before/after) and emit engine events; every endpoint
  is gated by `finance` read/write, decisions by `approvals.approve`.

**Schema** — `row_version` added to `proformas`, `transactions`,
`payment_requests`, `accommodations` (additive `migrateColumns`, live DB
migrated on boot): financial records get the same 409 optimistic-concurrency
guard as the rest of the system.

**Web**
- `web/src/pages/Accounting.tsx` (new): KPI strip (receivables, payables,
  received, result-to-date), per-project finance table with totals, project
  filter, tabs for the four record types with add/edit modals and row actions
  (proforma paid/cancel, request approve/reject for approvers).
- `ProjectCard` gains the missing **Финанси** tab (was in the PLANNED list):
  `finance()` KPIs, reconciliation vs completed work, the project's records
  read-only, link into `/accounting?pid=`.
- Route wired in `main.tsx`.

**Verified:** `test/accounting.test.mjs` — 5 tests (role gates, proforma→paid
single receipt + idempotency + cancel rules, transaction edit/409/void
exclusion, request approve/reject + notifications + no auto money,
accommodations + portfolio bundle). `npm test` 26/26 pass; `npm run build` pass.
Live on :4800 after restart: all five GET endpoints 200 for admin (temp session,
deleted after), public tunnel serves the new bundle, `/accounting` → 200.
Not measured: browser click-through of the new page.

## 2026-11-15 — Логистика (deliveries, assets, allocations)

The `/logistics` page is built: it was a `Soon` placeholder while its tables
(`deliveries`, `delivery_items`, `assets`, `asset_allocations`) sat as dead
schema. Настаняване stays in Счетоводство per operator decision.

**Server — `server/routes_logistics.js` (new, mounted in `index.js`)**
- `GET /api/logistics` — portfolio: per visible project delivery counts by
  status + live allocations, fleet by status, totals.
- `GET /api/projects/:pid/logistics` — one project: deliveries with items,
  allocations, and the project's logistics questionnaire fields.
- Deliveries `GET/POST /api/deliveries`, `PATCH /api/deliveries/:id` — code
  `DLV-####`, kind to_site/return/other, planned date, carrier, courier office,
  pallets, palletized, vehicle (asset), optional material_request link (same
  project enforced), items[] (product+qty, ≥1 required, replaced atomically on
  PATCH). Status flow planned→in_transit→delivered, cancelled from either;
  delivered/cancelled terminal. `row_version` 409 guard on edits.
- Assets `GET/POST /api/assets`, `PATCH /api/assets/:id` — registry (code
  `AST-####`, name, kind, plate, status available/in_use/maintenance/retired,
  location) with current-allocation lookup.
- Allocations `GET/POST /api/asset-allocations`, `PATCH .../:id` — assign asset
  to project for a date range; overlap guard rejects double-booking while
  planned/active (re-checked on PATCH excluding self).
- All gated by `logistics` read/write + per-project visibility (brigadier sees
  only assigned projects). Writes hit `audit_log`; events notify ops:
  `delivery.created`→warehouse+technical+brigadir, `delivery.delivered`→
  brigadir+technical, `delivery.cancelled`→warehouse (warn),
  `asset.allocated`→technical+logistics.

**Schema** — `row_version` added to `asset_allocations` (additive
`migrateColumns`; the only editable logistics table missing it).

**Web** — `web/src/pages/Logistics.tsx` (new): KPI strip, per-project logistics
table, tabs Доставки (status advance/cancel, edit modal with item rows editor)
and Техника (registry + allocations with activate/complete/cancel). Route in
`main.tsx`; `?pid=` deep link supported.

**Verified:** `test/logistics.test.mjs` — 3 tests (role gates incl. brigadier
scope, delivery lifecycle + 409 + items replace + bundle + notification,
asset registry + overlap guard + allocation lifecycle + portfolio). `npm test`
29/29 pass; `npm run build` pass. Live on :4800: all five GET endpoints 200
plus POST /api/assets 200 (temp admin created direct in DB, verified, then
deleted with session + audit row — operator's own `bosshev` admin untouched).
Public tunnel serves new bundle; `/logistics` → 200. Not measured: browser
click-through.

## 2026-11-15 — Бригадир (field interface)

**Server — `server/routes_brigade.js` (new, mounted in `index.js`)**
- `GET /api/brigade` — workspace bundle: projects visible to the user
  (`canSeeProject` — brigadier sees only assigned projects) with progress %,
  open-issue count, today's crew headcount; plus open tasks and issues routed
  to the user / brigadier dept.
- Attendance `GET /api/projects/:pid/attendance?date=`, `POST /api/attendance` —
  daily crew list (worker, hours, team); upsert on (project, work_date, worker)
  so re-posting corrects instead of duplicating. Gated by `progress` write.
- Issues `GET /api/issues?project_id=&status=`, `POST /api/issues`,
  `PATCH /api/issues/:id` — brigadir reports problem/delay/material_shortage/
  damage/additional_work/other with severity, optional product/line link and
  `assigned_dept` (default `technical` — the "request support" path). Status
  open→in_progress→resolved (resolution required)→reopen/cancel, `row_version`
  409 guard. `issue.reported`/`issue.resolved` notify the assigned department.
- Messages `GET/POST /api/projects/:pid/messages` — project comment thread with
  author join, optional entity link, gated by `messages` read/write +
  project visibility.
- Documents `POST /api/projects/:pid/documents` (multer multipart — images/pdf/
  office, 25 MB cap), `GET .../documents`, `GET /api/documents/:vid/file` —
  stored under `synchro-data/files/` with sha256 + mime on the version row.
  Gated by `documents` read/write + project visibility. Download streams the
  file and returns `undefined` — returning the stream made the shared `h()`
  wrapper try to `res.json()` it (500); fixed at the handler boundary.

**Schema** — `row_version` added to `issues` (additive `migrateColumns`).

**Web** — `web/src/pages/Brigade.tsx` (new): `/brigade` project cards
(progress %, open issues, today's crew) + tasks/issues inbox;
`/brigade/:id` field workspace, mobile-first single column, tabs План
(schedule + site logistics notes + line instructions), Прогрес (daily qty
form with uid dedupe, per-line progress, voidable entries), Присъствие
(date + crew upsert list), Проблеми (report form + status workflow),
Снимки (multipart upload + image grid + open/download), Съобщения (thread).
Routes wired in `main.tsx`.

**Verified:** `test/brigade.test.mjs` — 5 tests (scope/gates, attendance
upsert, issue lifecycle + notify, messages, photo upload→list→download
roundtrip). Written failing first (all 404), now 5/5. Full suite **34/34**;
`npm run build` pass. Live on :4800 (restarted onto new code): all 8 brigade
endpoints 200 plus POST /api/attendance and POST /api/issues 200 via temp
admin (probe rows + temp user + sessions + audit fully removed after —
operator's `bosshev` untouched). Public tunnel serves new bundle;
`/brigade` → 200. Not measured: browser click-through.

## 2026-11-15 — Lifecycle status sync (projects.status was a dead-end field)

**Illness:** `projects.status` (the coarse badge: Очаква договор / Подготовка /
Изпълнение / Завършен / Закрит / Спрян) had exactly one writer —
`contract.signed → 'preparation'` — and no transition mechanism. The 22-stage
checklist (`project_stages`) completing never propagated, so finished projects
stayed "Подготовка" forever. `archived` and `on_hold` were equally dead: read
by four modules, written nowhere.

**Fix — derive, don't duplicate:** `deriveProjectStatus()` + `syncProjectStatus()`
in `domain.js`. Status = leading edge of the stage checklist: phase of the
furthest-progressed (active/done) stage — pending earlier stages don't hold it
back (first-unfinished waterfall was tried and rejected: prep paperwork
routinely finishes during early execution). `skipped` counts as finished;
wrap-up stages (`completion` onward) read as `completed`; unsigned contract →
`contract_pending`; all done/skipped → `completed`. `closed`/`on_hold` are
manual states, never auto-derived.

- `setStage()` calls `syncProjectStatus()` — every stage transition (UI,
  contract-sign handler, Technical's auto `execution→active` on first progress
  entry) re-derives atomically in the same transaction.
- Stage `add` endpoint syncs too (new pending stage can regress the frontier).
- Startup sweep in `index.js` heals existing rows once per boot (manual states
  skipped) — project PRJ-2026-001 went `preparation → completed` on restart.
- `PATCH /api/projects/:id` accepts `status:'on_hold'` (pause, sticky) and
  `status:'resume'` (clears hold → re-derive); other values rejected.
- `POST /api/projects/:id/archive {archived}` — archive sets `archived=1` +
  `status='closed'`; unarchive clears the flag and re-derives. Audited.
- ProjectCard header: Пауза/Възобнови + Архивирай/Възстанови buttons
  (`projects` write permission).

**Verified:** `test/lifecycle.test.mjs` — 3 tests written failing first
(status stuck at `preparation`), now green: contract_pending→preparation→
execution→completed derivation, hold stickiness + resume, archive→closed +
unarchive re-derive, skipped-counts + frontier regression. Full suite
**37/37**; `npm run build` pass. Live :4800 restarted: startup sweep flipped
PRJ-2026-001 to `completed` (verified in DB); public `/projects/1` → 200 on
the new bundle. Not measured: browser click-through.

## 2026-11-15 — Управител (management portfolio board)

**Server — `server/routes_management.js` (new, mounted in `index.js`)**
- `GET /api/management` — one bundle for approvals-holding roles (`approvals`
  read = admin/manager only; every other role gets 403):
  - `kpis` — active projects, contract value / receivables / payables /
    result-to-date / forecast (only when `finance` read is held — verified by
    stripping the permission), critical issues, pending approvals, overdue
    tasks, failed events, in-transit deliveries.
  - `attention.approvals` — events with `approval_status='pending'` (the live
    decision queue), `attention.issues` — open high/critical, `attention.tasks`
    — open past due_date, `attention.events` — failed sync events.
  - `projects` — per-project portfolio rows (status, progress %, critical
    issues, finance fields when permitted).
  - `workload` — open tasks/issues/critical per department.

**Illness fixed at the mechanism (same dead-field class as projects.status):**
`events.approval_status` was written `'pending'` at emit time and NEVER
transitioned — decided approvals stayed in the queue forever. New
`resolveApproval()` in `core.js` marks the originating event approved/rejected
inside the same transaction as the decision; wired into contract
approve/return (`routes_projects.js`) and payment-request approve/reject
(`routes_accounting.js`). The management queue is now truthful: it drains on
decision (tested).

**Web — `web/src/pages/Management.tsx` (new)**, route `/management` in
`main.tsx` (was a `Soon` placeholder): KPI strip, four attention cards
(approvals / critical issues / overdue tasks / failed sync) with deep links,
portfolio table with money columns, workload-by-department table.

**Verified:** `test/management.test.mjs` — 3 tests (role gates across all 8
non-management roles, bundle content + queue drains after approve, finance
sections hidden when permission stripped). Full suite **40/40**;
`npm run build` pass. Live :4800 restarted: `/api/management` 200 for temp
manager — real KPIs returned (PRJ-2026-001 completed, PRJ-2026-002
contract_pending, contract_value totals correct); temp user + session removed
after. Public `/management` → 200 on new bundle. Not measured: browser
click-through.

## 2026-11-15 — Бригадир nav fix (module was unreachable)

The Бригадир menu item pointed to `/brigadier` but the module routes are
`/brigade` + `/brigade/:id` — clicking it fell through to the `Soon`
placeholder. NAV `to` corrected to `/brigade`. Frontend-only change;
`npm run build` pass, server restarted, public bundle verified
(`index-iy7Jpe6Y.js`), `/brigade` and `/brigade/1` → 200. Not measured:
browser click-through.

## 2026-11-15 — Project Card: real tabs for built modules

The "Предстоящи раздели" list claimed eight shipped capabilities were unbuilt.
Each now reads the same shared records through a real, permission-gated tab —
nothing is duplicated into a card-specific store.

**Server**
- `GET /api/projects/:pid/tasks` (routes_technical.js) — per-project bundle of
  tasks + issues with assignee/dept names; gated by `tasks` read + project
  visibility. The workspace `/api/technical` tasks view stays global.

**Web — `web/src/pages/ProjectCard.tsx`**
- Six new tabs, each gated by its module permission: **График**
  (`/projects/:id/schedule` — items, %, late/behind flags; `technical`),
  **Изпълнение** (`/progress` — per-line % + daily reports; `progress`),
  **Логистика** (`/logistics` — site logistics notes, deliveries, механизация
  allocations; `logistics`), **Задачи** (`/tasks` — tasks + problems;
  `tasks`), **Документи** (`/documents` — file list + image grid;
  `documents`), **Съобщения** (`/messages` — thread + post box;
  `messages` write for the input).
- Each tab deep-links into its owning module (Технически / Логистика /
  Бригадир) for edits — the card is a window onto shared records, not a
  second editor.
- `PLANNED` trimmed to what is genuinely missing: Технически спецификации,
  Склад. Анекси removed — contract versions/appendices already live in the
  Договор tab.

**Proof** — `test/technical.test.mjs` extended (per-project bundle returns
the created task + issues array; commercial role reads it). Full suite
**40/40**, `npm run build` pass. Live :4800 restarted: all six endpoints
200 on project 1 (schedule/progress/tasks return real rows; logistics/
documents/messages return honest empty arrays). Temp session removed after.
Public `/projects/1` → 200 on new bundle. Not measured: browser click-through.

## 2026-11-15 — Over-contract progress: warn-and-allow

Reporting more than the contracted quantity was silently accepted and the %
column capped at 100, so 154% of a line rendered as a clean "100%".

**Server** — `POST /api/projects/:pid/progress` now returns
`over_contract: { contract_qty, done_qty, excess }` whenever cumulative
non-voided quantity on the line exceeds `project_lines.qty` (epsilon-guarded
for float noise). The entry still saves — extra work is real — including on
the deduped-replay path, which reports current state.

**Web**
- "над договора +N" badge under Извършено wherever done-vs-contract is shown:
  ProjectCard Изпълнение + КС tabs, Technical Дневен прогрес, Brigade Прогрес.
- Both entry forms (Technical, Brigade) toast "Отчетът е записан — над
  договора с N unit" instead of the plain success message when the response
  carries the flag.

**Proof** — assertions added to the daily-progress test (90/100 → no flag;
110/100 → flag with excess 10; deduped replay still reports state): failed
before the change, pass after. Full suite **40/40**, `npm run build` pass.
Live :4800 restarted; `GET /api/projects/4/progress` returns line 38 at
done_qty 1000 vs qty 648 — the badge now surfaces the +352 that was
invisible. Temp session removed after. Not measured: browser click-through
of the badge/toast.

## 2026-11-15 — Каталог с изображения + галерия в офертите

**Goal** — offers should look like the company's Excel template without
copy-pasting photos: a searchable catalogue gallery wired into the offer
editor, with images rendering fitted in the printed/PDF output.

**Schema** — `catalog_items(slug UNIQUE, name, brand, cat, specs JSON,
images JSON, source 'isport'|'excel', active)`; `offer_templates.catalog_slug`
links a template to its catalogue image. Images live in
`DATA_DIR/files` as `cat-*` (no duplication per attach).

**Import** — `tools/import_catalog.mjs` (announced, DB backed up first):
- isport `crawl/catalog.norm.json` + `images.map.json`: 2,581 unique items
  (186 exact-duplicate source rows collapse on slug), 5,037 live image refs
  copied (74 dead links skipped), zero basename collisions verified.
- Excel embedded product images: 62 items (MultiPLAY/Play/Sport/Padel/
  SBR Tiles/GreenSet/Grass/Melos EPDM/Corkeen/Equipment), 51 staged files.
- All 23 offer templates mapped to their Excel system photo (23/23).

**API** (`server/routes_catalog.js`) — `catalog` read for browse (every
role has it): `GET /api/catalog/items?q=&cat=&brand=` (120-row cap,
excel-sourced first), `GET /api/catalog/items/:ref` (id or slug, image URL
list), `GET /api/catalog/items/:ref/img/:idx` (streamed, immutable cache),
`GET /api/catalog/facets`. `POST /api/catalog/items/:ref/attach` requires
`offers` write: materializes a `documents` row (`entity_type='catalog'`,
`project_id NULL`) + version pointing at the same stored file — idempotent
per (item, image); returns `document_id` for `image_document_id`.

**Offers** — `offerView` resolves `image_url` (latest document version)
for sections and lines; PUT already round-trips `image_document_id`.
Print/PDF (`server/print.js`) resolves `image_document_id` → latest version
→ base64 and renders `.pimg` — `object-fit: contain` inside a 26mm×52mm
bordered box floated in the section header / line description cell.
Excel `.xlsx` export intentionally does not embed images (flagged
limitation, not silent).

**Web** — OfferEditor: 🖼 button on every section header and line row opens
`CatalogPicker` (search grid → item detail → click an image → attach →
`image_document_id` set, saved by the normal PUT). Inserting an offer
template auto-attaches its `catalog_slug` image to the new section.
Thumbnails show next to the button once set.

**Proof** — `test/catalog.test.mjs` (2 tests): search/detail/stream/404,
anon 401, accounting read OK + attach 403, attach idempotent by id AND
slug, attached image serves via `/api/documents/:vid/file`, offer PUT
round-trip persists `image_document_id`+`image_url`, print HTML contains
`class="pimg"` + `data:image/png;base64`. Full suite **42/42**,
`npm run build` pass. Live: import run against `synchro-data` (backup
`synchro-pre-catalog-20261115-204911.db`), :4800 restarted — live search
returns excel+isport items, image streams `200 image/webp`, attach →
`document_id` then `reused:true` on repeat, anon 401, public tunnel 200.
Smoke session + probe document row removed (4 real sessions untouched).
Not measured: browser click-through of the picker; xlsx export has no
images by design.

## 2026-11-15 — Template picker: multi-select without auto-close

The "Готови системи" modal no longer closes after each "Добави" — the
operator can insert as many systems as needed; added rows dim to
"Добавено ✓" (disabled, prevents duplicates), a footer counter shows the
count, and "Готово" closes. `tplAdded` resets each time the picker opens.
Frontend-only change; `npm run build` pass, public bundle
`index-CjTEEJ_3.js` verified served. Not measured: browser click-through.

## 2026-11-15 — Offer .xlsx export embeds catalogue images

The earlier "xlsx has no images" limitation is removed: `offerWorkbook`
now embeds section and line images into the "Оферта" sheet. Catalog images
are stored as webp (99% of refs) which Excel cannot render, so each image
is re-encoded to PNG via `sharp` at export time (rotate() normalizes EXIF
orientation), fitted into a bounded box preserving aspect (section ≤350×115px
on the title row's right side; line ≤280×105px right-aligned inside the
description column via fractional-col anchor), `editAs:'oneCell'`, and the
row height grows to fit image-or-text, whichever is taller. Logo anchor
unchanged; "Калкулация" sheet stays image-free (internal).

**Proof** — catalog test extended: export.xlsx round-trips through ExcelJS
and `getImages()` on "Оферта" ≥ 2 (logo + line image). Full suite **42/42**.
Live :4800 restarted; `GET /api/offers/5/export.xlsx` → 200, 1.05 MB, 13
media parts (logo + 12 section photos the operator attached via the picker).
Sample written to `~/Downloads/Oferta_5_v1_images.xlsx` for visual check.
Smoke session removed (4 real sessions untouched). Not measured: opening
the file in Excel itself.

## Excel replica tab in offer editor

- New **"Excel реплика"** tab in OfferEditor renders the offer literally like
  the company's workbook: 23-column grid in source order (№, merged Описание,
  Изображение, Ед.мярка … Ед.цена към клиента), merged section banner rows
  with floated section photo, per-section total rows (без ДДС / ДДС / с ДДС)
  and a grand-total footer.
- Fully editable through the SAME state/handlers as the Оферта tab
  (`setL`/`pickL`/`delL`/`setS`/`addLine`) — replica edits save identically;
  no second pricing model (`calcLine` is the single source).
- Image column per line + 🖼 picker on section banner and line cells reuses
  `CatalogPicker`; internal calc columns gated to `money` exactly like
  SheetGrid; read-only for locked versions.
- Styles: `.xr*` block in styles.css (Excel-like gray grid, sticky header).
- Verified: `npm run build` clean, `npm test` 42/42, :4800 restarted,
  local + public serve `index-DGj_BnEX.js` → 200. Not measured: clicking
  through the tab in a browser.

## Offer picker — full catalogue insert

- The "Готови системи" modal is now "Готови системи и каталог" with two tabs:
  Системи (шаблони, unchanged) and Цял каталог — searchable/faceted browse of
  all ~2,600 active `catalog_items` (thumb grid, cat+brand filters, 120-result
  cap noted in UI).
- Picking a catalogue item attaches its first image (idempotent `attach`,
  image-less items insert without one) and appends a section titled with the
  item name + specs summary, containing one line pre-filled with name/unit
  `бр.` — same shape as template inserts, same PUT save path.
- Multi-select preserved across both tabs: per-source added-sets, footer
  counter sums them, modal stays open until "Готово".
- Verified: `npm run build` clean (`index-D0fQjFel.js`), `npm test` 42/42,
  :4800 restarted, local + public serve new bundle → 200. Not measured:
  clicking through the catalog tab in a browser.

## Repo sync + catalogue data exclusion

- Merged full local tree to `xellunexx/infraerp` main (f433cfa): all modules,
  tests, design docs, cloudflared quick-tunnel config.
- `tools/catalog-import/` (Excel-extracted catalogue staging, ~4.9 MB images
  + items JSON) added to `.gitignore` — catalogue DATA stays local; only the
  importer code (`tools/import_catalog.mjs`) ships.
- `requirements.txt` added for `tools/import_offer_template.py`
  (`openpyxl==3.1.5`, the only Python dep in the repo).
