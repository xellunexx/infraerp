# Single Payment Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record each payment once in the ledger and read every "paid" answer from it.

**Architecture:** A new pure-read module `server/payments.js` derives milestone, proforma, document and order state from `transactions`. A new route file `server/routes_payments.js` is the only writer of linked payments. Existing screens and reports switch to the derived values; stored `contract_payments.paid_at` stays for migration only.

**Tech Stack:** Node ES modules, `node:sqlite`, Express, React + TypeScript + Vite, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-single-payment-record-design.md` (approved 2026-11-25)

## Global Constraints

- Only `status = 'paid'` counts. `reported` moves no figure.
- Ledger amounts are gross; result, cost and contract value are net; every label says „с ДДС" or „без ДДС".
- Milestone is paid at gross − 0.005. Duplicate window: same project, same amount, within 5 days.
- Bank date: valid ISO date, required, not in the future.
- `advance_pct` 0–100 and present at submit; no default of 50.
- No payment row is created by migration. Columns are additive.
- Every new route: permission, `needProject`, `canSeeMoney` mask, audit row, event.
- Full suite green at the end of each task; CHANGELOG entry in the last. No deploy.

## Review Focus

1. The same payment confirmed twice from two browsers: second call gets 409, one counted row (Task 4).
2. A payment whose date is edited after confirmation: deadline moves with it (Task 3).
3. A proforma issued before VAT changes: its own `vat_pct` is used, not the setting (Task 3).
4. An amount typed as `3 720,00` or negative: refused with a message, nothing written (Task 4).
5. An archived or closed project: an outstanding client payment can still be recorded (Task 4).

## Files

| File | Responsibility |
|---|---|
| `server/payments.js` (new) | Derivation only, no writes |
| `server/routes_payments.js` (new) | Record, report, confirm, reject, merge, queue |
| `server/db.js` | Three columns on `transactions`, two on `contract_payments` |
| `server/calc.js` | `finance()` uses `payments.js`; `supplierOrderView` takes derived dates |
| `server/domain.js`, `routes_projects.js`, `routes_accounting.js`, `routes_change_requests.js` | Switch readers, remove second writers, guards |
| `server/reminders.js`, `routes_reports.js` | Derived proforma state |
| `web/src/pages/{ProjectCard,Accounting,Logistics,Management}.tsx` | Screens and labels |
| `test/payments.test.mjs` (new) | All new behaviour |

---

### Task 1: Derivation module

**Files:** Create `server/payments.js`, `test/payments.test.mjs`. Modify `server/db.js` (`transactions`: `contract_payment_id INTEGER REFERENCES contract_payments(id)`, `supplier_order_id INTEGER REFERENCES supplier_orders(id)`, `order_stage TEXT`; `contract_payments`: `vat_pct REAL`, `gross REAL`).

**Interfaces — Produces:**
- `netOf(tx, vatPct): number`
- `splitSchedule(net, vatPct, advancePct): [{kind, pct, net, gross}]`, final is the remainder
- `paidState(rows, gross): { paid, paid_at, over }`, rows ordered by `tx_date`, then `id`
- `milestones(db, contractId): [{id, kind, pct, net, gross, paid, paid_at, over, reported}]`
- `proformaState(db, pf): { gross, paid, paid_at, status }` with status `issued|paid|cancelled`
- `documentState(doc, children): { settled, open }`
- `projectMoney(db, projectId): { received, paid_out, payables, received_net, paid_net, expense_net }`
- `orderDates(db, orderId): { advance_paid_at, final_paid_at }`

- [ ] **Step 1: failing tests**, in `test/payments.test.mjs`
  - `500; invoice 1200 (VAT 200); +400; +800` → `projectMoney` = `expense_net 1500` at every stage after the invoice; payables 1200, 800, 0; paid_out 500, 900, 1700
  - `splitSchedule(100.01, 20, 50)` → net sums to 100.01 and gross to 120.01; `splitSchedule(T, 20, 0)` has advance 0
  - `paidState` with 3000 then 720 against 3720 → `paid_at` is the second date; 4000 → `over 280`
  - a row linked to both a milestone and its proforma is counted once; two proformas on one milestone add up
  - `reported`, `planned`, `voided` rows never count
- [ ] **Step 2:** `node --test test/payments.test.mjs` → FAIL, module not found
- [ ] **Step 3:** implement. Milestone rows = `status='paid' AND (contract_payment_id = ? OR proforma_id IN (proformas of same project and kind))`, distinct by id
- [ ] **Step 4:** same command → PASS. `npm test` → all pass
- [ ] **Step 5:** commit `feat: derive payment state from the ledger`

### Task 2: Finance and ledger totals

**Files:** Modify `server/calc.js` (`finance`), `server/routes_accounting.js` (`withOpen`, `/api/ledger` totals), `routes_management.js`. Test `test/payments.test.mjs`, `test/accounting.test.mjs`.

**Interfaces — Consumes:** Task 1. **Produces:** `finance()` keeps its keys; `invoiced`, `receivables`, `payments_received`, `payments_made`, `payables` become gross; `actual_expenses`, `result_to_date`, `forecast_result`, `remaining_budget`, `cost_variance` net. `not_invoiced` and `work_not_invoiced` compare net with net.

- [ ] **Step 1: failing tests**
  - the 500/1200 table through `/api/projects/:id/finance` and `/api/ledger`: `open_out` 0, 1200, 800, 0
  - proforma 1000 + 20% unpaid: `invoiced 1200`, `receivables 1200`
  - accountable-person card totals identical before and after (fixed expected values from the current test)
- [ ] **Step 2:** run → FAIL with today's 2900 and 500
- [ ] **Step 3:** implement; update the net assertions in `accounting.test.mjs` 108–146 and 244–264, recording each old → new value for the report
- [ ] **Step 4:** `npm test` → all pass
- [ ] **Step 5:** commit `fix: each document counts once; figures state gross or net`

### Task 3: Milestones, proformas, deadlines

**Files:** Modify `server/domain.js` (`signContract`, `writeAppendices`), `routes_projects.js` (`contractView`, dashboard, plan-only `PUT`), `routes_accounting.js` (`proformas/:id/paid`), `reminders.js`, `routes_reports.js`.

**Interfaces — Produces:** `contractView().payments[]` = `milestones()` plus `note`; `advance_paid_at` from the advance milestone, or `signed_on` when its gross is 0; `contractView().unmatched_paid_at` lists stored dates with no rows.

- [ ] **Step 1: failing tests**
  - proforma 3100 + 20% paid with `paid_at 2026-11-10` → ledger row 3720, `has_vat 1`, `vat_amount 620`, date 2026-11-10; milestone paid; `final_deadline` = that date + production + install days
  - void the row → milestone, proforma and deadline revert; a later re-payment works
  - edit the row's date → deadline moves
  - `vat_pct` setting changed after issue → proforma and milestone keep theirs
  - partial 1000 of 3720 → not paid, no deadline
  - submit without `advance_pct` → 400; 150 → 400; 0 → signs with no advance proforma and deadline from `signed_on`
  - Appendix 3 shows the same percentage as the schedule
  - `PUT contract/payments` with `paid_at` → 400 naming „Запиши плащане"
  - overdue reminder and report skip a paid proforma
  - source scan: `contract_payments` `paid_at` is read only in `unmatched_paid_at`
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** implement. Remove the `contract_payments` upsert from the proforma route. Signing stores `vat_pct` and `gross`. Fixtures that signed without a percentage set `advance_pct` explicitly; tests that typed `paid_at` record a payment instead
- [ ] **Step 4:** `npm test` → all pass
- [ ] **Step 5:** commit `feat: milestones, proformas and deadlines read the ledger`

### Task 4: Report, confirm, reject, duplicates

**Files:** Create `server/routes_payments.js`; mount in `server/index.js`. Test `test/payments.test.mjs`.

**Interfaces — Produces:**
- `POST /api/projects/:pid/payments {uid, amount, tx_date, proforma_id?, contract_payment_id?, document_ref?, note?}` → `{payment, similar[]}`
- `POST /api/payments/:id/confirm {amount?, tx_date?, separate?, row_version}`; 409 `{similar}` unless `separate: true`
- `POST /api/payments/:id/merge {into, row_version}`
- `POST /api/payments/:id/reject {reason, row_version}`
- `GET /api/payments/queue` → reported rows with `similar`, and unmatched dates
- Direct entry by finance with `similar` found and no `separate` → 409 `{similar}`
- Events `payment.reported` (to accounting), `payment.confirmed`, `payment.rejected` (to the reporter), and the existing `contract.payment_recorded` on confirm

- [ ] **Step 1: failing tests**
  - contracts role: status `reported` even if `paid` is sent; finance, milestone, deadline and dashboard unchanged; cannot confirm, reject, merge or void (403); `PATCH /api/transactions/:id` 403
  - confirm moves all of them, using the bank date; corrected amount keeps both in audit
  - reject without reason 400; with reason notifies the reporter; row voided
  - report + direct entry of 3720 two days apart → 409 with the other row; merge leaves one counted row; `separate` keeps two
  - second confirm → 409; same `uid` twice → one row
  - amount `"3 720,00"`, `-1`, `0`; date `2026-13-01`, tomorrow → 400, no row
  - proforma or milestone of another project → 400; technical role → 403; brigadier with override on a foreign project → 403
  - closed and archived projects accept a payment
  - waiting report produces one reminder a day
- [ ] **Step 2:** run → FAIL (404)
- [ ] **Step 3:** implement
- [ ] **Step 4:** `npm test` → all pass
- [ ] **Step 5:** commit `feat: payments are reported by Contracts and confirmed by Accounting`

### Task 5: Supplier orders

**Files:** Modify `routes_accounting.js` (supplier orders), `calc.js`, `routes_payments.js`.

**Interfaces — Produces:** `POST /api/supplier-orders/:id/payments {uid, stage, amount, tx_date}` with the same report/confirm rule (logistics write → `reported`, finance write → `paid`); `supplierOrderView(o, dates, today?)`.

- [ ] **Step 1: failing tests**
  - advance 5000 of 10000 paid 2026-11-15, 30 days → ready 2026-12-15; final 5000 on 2026-12-16, 7 days → 2026-12-23 (the Тъмния_2 example); forecast before
  - logistics report does not start the countdown; confirm does
  - typed `advance_paid_at` → 400; advance above total → 400; line of another project → 400; empty total → 400 rather than 500
  - a stage is paid when its rows reach `advance_eur`, or total − advance
- [ ] **Step 2–4:** FAIL → implement → `npm test` passes (`finance_ledger`, `logistics`, `scope` fixtures record payments)
- [ ] **Step 5:** commit `feat: supplier payments come from the ledger`

### Task 6: Guards

**Files:** Modify `routes_accounting.js`, `routes_change_requests.js`.

- [ ] **Step 1: failing tests**: document below its paid children 400; void a document with paid children 400; cancel a proforma with a reported or paid payment 400; change request on `transaction` amount/direction/status/tx_date, `proforma` status, or `project_line` qty/unit_price of a signed contract → 400 at filing **and** at decision (one filed before signing)
- [ ] **Step 2–4:** FAIL → implement → `npm test` passes
- [ ] **Step 5:** commit `fix: paid amounts and signed values cannot be edited around`

### Task 7: Screens

**Files:** Modify the four pages. Reuse `Modal`, `Field`, `Table`, `useAction`; one shared `PaymentForm` in a new `web/src/pages/PaymentForm.tsx`.

- [ ] **Step 1:** schedule table as sketched in spec section 8; button „Запиши плащане" / „Докладвай плащане" by right
- [ ] **Step 2:** Accounting tab „За потвърждение (n)" with duplicate warning, confirm, merge, reject; „Платена" opens the form with date and gross prefilled
- [ ] **Step 3:** order forms lose typed payment dates and gain the payment action
- [ ] **Step 4:** „с ДДС"/„без ДДС" on every money label in the four pages
- [ ] **Step 5:** `npx tsc -p web/tsconfig.json` → 0 errors; `npm test`; browser run as contracts and accounting: report → figures still → confirm → figures move → void → figures back
- [ ] **Step 6:** commit `feat: payment screens`

### Task 8: Rehearsal

- [ ] **Step 1:** on a copy of the live database: start new code; row counts of all tables unchanged; unmatched list printed; contracts without a schedule and percentage conflicts printed
- [ ] **Step 2:** start `9d1b6f1` on that migrated copy → starts, `/api/auth/state` 200
- [ ] **Step 3:** CHANGELOG and `design.md` §14.3–14.4 updated; `npm test`; commit `docs: payment record`

## Self-review

Spec sections 1–8, existing data and the ten test groups map to Tasks 4; 4; 1; 1–3; 1–2; 3 and 6; 5; 7; 8; all. Review Focus lines 1, 4, 5 are in Task 4 and 2, 3 in Task 3.
