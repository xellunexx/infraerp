# SYNCHRO — architecture and implementation plan

In-house construction operations platform. One rule: **enter information once, synchronize everywhere.**
The app starts empty: no seeded business records. Only reference configuration is created on first run
(departments, roles, default permissions, default lifecycle stages), all editable in Settings.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 | already on the machine, one process to serve |
| Database | SQLite (built-in `node:sqlite`, WAL mode, foreign keys ON) | relational, transactional, single file, easy backup/restore |
| API | Express, JSON over HTTP, cookie session | simple, well known |
| UI | React + TypeScript + Vite, own CSS (light/dark) | production build served by the same Node process |
| Files | disk folder outside the build (`synchro-data/files`), SHA-256 per version | updates and rollbacks never wipe data |
| Background | in-process worker loop over the event outbox | no extra service to keep alive |

Data lives in `C:\Users\Administrator\synchro-data` (database, uploaded files, backups) — outside the code folder.

## 2. Central model: Картон на обекта (КО)

`projects` is the master record. Every other table points to it by `project_id`; nothing is copied per department.

```
customers ─┬─ inquiries ── offers ── offer_versions ── offer_lines ── offer_line_recipe
           │                               │ (confirmed version = commercial baseline, locked)
           └─ projects (КО) ◄──────────────┘
                 ├─ contracts ── contract_appendices (№1 №2 №3)
                 │      └─ contract_versions (immutable snapshots) ◄── amendments (annex / change / force majeure)
                 ├─ project_lines (КС: contractual quantities and prices) ── project_line_recipe (norms + technical adjustments)
                 ├─ project_stages (configurable lifecycle)       ├─ questionnaires (customer, site/logistics)
                 ├─ schedule_items (linear schedule, baseline + current)
                 ├─ progress_entries (daily, per КС line)  ├─ attendance  ├─ issues
                 ├─ material_requests ── request_items ── reservations ── stock_movements
                 ├─ deliveries ── delivery_items            ├─ asset_allocations (machinery, tools, vehicles)
                 ├─ proformas  ├─ transactions (real money)  ├─ payment_requests  ├─ accommodations
                 ├─ documents ── document_versions (photos, drawings, contract files)
                 ├─ approvals  ├─ tasks  ├─ messages (threads bound to a project and an object)
                 └─ events ── event_effects ── notifications          audit_log (everything)
catalogues: products (materials, products, consumables), smr_types (СМР operations), recipe_items (norm per СМР unit), assets
access: departments, users, role_permissions, project_members, sessions
```

Identifiers: `CUS-0001`, `INQ-…`, `OFR-…`, `CTR-…`, `PRJ-2026-001`, `REQ-…`, `DLV-…`, `PF-…`, `TX-…`, `PAY-…`, product codes entered by the user.

Derived, never stored twice:
- progress % = Σ(done qty × unit price) / Σ(contract qty × unit price) over `project_lines`
- theoretical consumption = done qty × recipe norm × (1 + waste %) from `project_line_recipe`
- actual consumption = warehouse `consume` movements for the project (kept separate from theoretical)
- finance: contract value, approved offer value, cost price, planned / actual expenses, paid, received,
  receivables, payables, remaining budget, result — computed from `project_lines`, `transactions`, `proformas`.
- earned value / allocated cost from progress are **calculated views**, never inserted as transactions,
  so recorded money is not counted twice.

## 3. Synchronization engine (transactional outbox)

1. A command (e.g. "confirm offer") runs in one DB transaction: business change + `audit_log` row + `events` row.
2. `events` row: `uid, dedupe_key (UNIQUE), project_id, type, origin_module, user_id, ts, prev_value, new_value,
   approval_status, affected_modules, status (pending → processing → processed | failed), attempts, last_error`.
3. The worker takes pending events in order and runs every registered handler. Each handler result is stored in
   `event_effects (event_id, handler) UNIQUE`, so a retry never repeats a handler that already succeeded.
4. A failed handler rolls back its own transaction, the event is retried with backoff (5 attempts), then marked
   `failed` and shown to administrators with a Retry button. Events stuck in `processing` after a crash are recovered on start.
5. Duplicate protection: `dedupe_key` per logical operation plus optional `Idempotency-Key` header from the client
   (field phone double-taps, repeated submits).
6. Notifications are only one kind of handler output. Business operations (create contract draft, initialise КО,
   reserve stock, create approval) are separate handlers with their own recorded result.

| Event | Handlers (business operations) | Notified |
|---|---|---|
| `offer.confirmed` | lock version as baseline; create contract draft + Appendices 1–3; initialise КО + КС lines + recipes + stages | Contracts, Technical, Management |
| `contract.signed` | activate baseline v1; activate deadlines; preliminary schedule → schedule; open procurement requirements | Technical, Warehouse, Logistics, Accounting |
| `request.created` | availability check; reserve what is in stock; mark shortages to purchase; delivery requirement; approval if extra spend | Warehouse, Logistics, Technical, Management (if approval) |
| `progress.recorded` | recalc completion; recalc theoretical consumption + over-consumption alerts; completed quantities to Accounting; schedule deviation check | Accounting, Management, Technical (alerts) |
| `amendment.approved` | new contract version; update КС lines; shift schedule; mark affected requests/deliveries | all affected departments |
| `delivery.changed`, `stock.shortage`, `payment_request.created/decided`, `issue.reported`, `stage.changed`, `task.assigned`, `message.mention` | corresponding approvals / tasks / alerts | affected departments |

## 4. Permissions and approvals

- Every user has one department and one role (`admin`, `manager`, `commercial`, `contracts`, `technical`, `accounting`,
  `warehouse`, `logistics`, `brigadier`).
- `role_permissions (role, resource, read, write, approve)` — enforced on the server for every request, editable in Settings.
- Financial figures are hidden from roles without `finance.read` (brigadier, warehouse, logistics by default).
- Brigadiers see only projects they are assigned to (`project_members`).
- Approvals (Управител): payment requests, exceptional expenses, contract deviations/amendments, additional СМР.
  Nothing with an approval requirement changes the baseline until approved; the previous version is never overwritten.
- Concurrent edits: every editable row has `row_version`; a stale save is rejected (HTTP 409) instead of overwriting.

## 5. Operations

- Backup: Settings → Backup creates a consistent copy (`VACUUM INTO`) under `synchro-data/backups`; automatic daily copy, 14 kept.
  Restore = stop the server, replace `synchro.db` with a backup file, start again (documented in README).
- Search: SQLite FTS5 index over projects, customers, contracts, offers, products.
- Audit: every write goes through one helper that records who, when, before and after.

## 6. Phases and checklist

Status is kept honest in `CHECKLIST.md`: a module is ticked only when its operations, persistence, permissions and
integrations are tested, not when the screen exists.

1. Foundation — users, departments, permissions, customers, offers, contracts, Project Card, sync engine
2. Execution — Technical, Brigadier (mobile), linear schedule, daily progress, photos, recipes and consumption
3. Resources — Warehouse, requests, Logistics, machinery and vehicles, transfers and returns
4. Financial control — Accounting, proformas, income/expenses, payment requests and approvals, reconciliation
5. Management intelligence — global dashboard, profitability, schedule deviations, utilisation, workload, reports