# Governance core — design (push 1)

Scope confirmed with operator: change requests = flag-only AND proposed-values; reports = curated
catalog + engine (push 2); build order = governance first. Reminders ship in push 1 because the
reports engine needs `reminders_log` history to answer "was a reminder sent?".

## 1. Universal change requests (`server/routes_change_requests.js`)

Any authenticated user files `POST /api/change-requests`:
`{ entity_type, entity_id, kind: 'edit'|'delete', payload?, reason }`.

- `payload` optional for `edit` (flag-only mode); when present every key must be in the entity's
  column whitelist and every value a scalar (string/number/boolean/null).
- `reason` required — it is what the admin decides on.
- Flow: `pending` → admin `POST /api/change-requests/:id/decide {decision, note}` →
  `approved` (applier runs inside the same tx; failure rolls back, request stays pending) or
  `rejected`. `applied_at` + `result` JSON record the outcome. All steps write `audit_log`.
- Only `role === 'admin'` may list the queue or decide (`needAdmin`). Requesters see their own
  requests (`scope=mine`); admins see all.
- `GET /api/change-requests/entities?type=` feeds the picker (id + label, capped).
- `GET /api/change-requests/meta` feeds the request form (entity types, editable cols, labels).
- On create, `notify()` pings `management` department.

### Entity registry

`ENTITY_TYPES` maps `entity_type → { table, cols, resource, label, picker, deletable, apply? }`.
Generic apply = `updateRow` + `audit` (+ `reindex` where the entity is searchable). Custom `apply`
exists for offers (header + current version fields, mirroring `PUT /api/offers/:id` minus
lines/sections — documented limitation). Delete = `DELETE` inside tx; `PRAGMA foreign_keys=ON`
makes referenced rows fail loudly instead of corrupting.

Coverage v1: customer, product, smr, inquiry, offer, project, project_line, contract,
transaction, proforma, payment_request, accommodation, delivery, asset, asset_allocation,
task, issue, schedule_item, project_stage, material_request, attendance, document.
Not covered (flow-owned or derived): offer lines/sections (edit via offer revision),
progress_entries (void flow), stock_movements (immutable ledger), catalog_items (imported),
users (admin form), sessions, events.

## 2. Admin-only settings

`needAdmin` in core.js. Applied to: `POST/PATCH /api/users`, `GET/PUT /api/permissions`,
`PUT /api/settings`. `GET /api/users` stays readable (directory used by pickers/ProjectCard).
Frontend: `/settings` nav item + route render only for `role==='admin'`; non-admins get an
access-denied card. API is the real gate — UI hiding is cosmetic.

## 3. Per-user visibility (`user_overrides`)

```sql
user_overrides(user_id, resource, can_read, can_write, can_approve,
               PRIMARY KEY(user_id, resource))  -- NULL flag = inherit role
```

- `userFromToken` merges overrides after role perms; skipped entirely for `role='admin'`
  (admin is superuser — self-lockout impossible).
- `PUT /api/users/:id/overrides` (admin only, target must not be admin) replaces the user's
  override set; audited.
- UI: UserForm gains "Ограничения по модули" — per-resource preset select
  (По подразбиране / Без достъп / Само четене / Четене+запис / Пълен достъп). Available when
  editing an existing user; after creating a user the modal reopens in edit mode so limits can
  be set immediately.

## 4. Reminder sweeper (`server/reminders.js`)

`startReminderWorker(db, 60s)` scans pending states older than 12h:

| Watchdog | Pending condition | Notified |
|---|---|---|
| approval events | `approval_status='pending'` >12h | management dept |
| approvals rows | `status='pending'` >12h | management dept |
| tasks | `open` and (overdue or >12h old) | assignee user or dept |
| project_stages | `pending` past `due_date` | stage department |
| deliveries | `planned` past `planned_date` | logistics dept |
| material_requests | `submitted` >12h | warehouse dept |
| payment_requests | `pending` >12h | management dept |
| proformas | `issued` past `due_on` | accounting dept |
| issues | `open` high/critical >12h | assigned dept |
| change_requests | `pending` >12h | management dept |
| amendments | `pending` >12h | management dept |
| projects | `contract_pending` >12h | contracts dept |

Dedupe: `reminders_log(entity_type, entity_id, kind, bucket)` UNIQUE — one reminder per
entity+kind per UTC day (`bucket = unix/86400`), so history persists for reports without spam.
Each send = `notifications` row (severity `warn`) + `reminders_log` row + `audit_log` row.
"Attended to" is measured by the entity leaving its pending state; "communication attempted"
is measured from `messages` — both queryable by the reports engine in push 2.

## 5. Push 2 (next): warehouse module + curated reports

Warehouse writers over existing `stock_movements`/`reservations`/`material_requests` tables
(receipt/issue/return/adjust, request→approve→reserve→deliver flow).
Reports: dwell-time analyzer over events/project_stages/tasks, planned-vs-actual variance
(offer labour days vs progress), exception digest; all reading `reminders_log` for the
"was it reminded / attended / ripple delay" questions.
