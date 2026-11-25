# Accounting as in „Таблица ексел": Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project and person figures equal the company workbook, from the app's single ledger.

**Architecture:**
- Every ledger row gets one **role**: cost, payment, income document, income payment, advance to a person, return, or stock. The role comes from its kind and links, in one function.
- `projectMoney`, the new `projectResult` and `personCard` all read roles instead of status guesses.
- A fixture made from the real workbook rows, anonymised, proves the numbers.

**Tech Stack:** Node ESM, `node:sqlite`, React + TS, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-excel-parity-design.md`, part A (approved 2026-11-26). Evidence: `C:\lab\infraerp\excel-compare\REPORT.md`.

## Global Constraints
- **Cost comes from documents.** A bank transfer is never a cost; an unlinked one changes no result.
- **„Складова разписка"** is a project cost, never a payable, never money paid.
- **ЕВРОВАГ fuel** is a project cost and never changes a person's balance.
- **Person balance** = (money given + money received by the person) − (labour + documents paid by the person).
- **What clients owe** = client documents with VAT − money received; an invoice that settles a proforma counts once.
- **Indirect cost** = actual man-days × Settings `indirect_per_manday` (default **150**).
- **Excel numbers to reproduce:** Нестум **14 548.82**, Карандила **10 887.29**, Хюсеин **118.80**.
- **Fixtures carry no real names:** people, partners and clients are replaced with codes. Amounts, dates and kinds are kept.
- **Kind vocabulary added:** `store` (exists), method `eurowag`, kind `card` direction `in` = return of an advance.

## Review Focus
1. Rows written before this change have no kind (`tx_kind` NULL). They must keep today's meaning (an out row paid = cost) and be listed for review, not silently dropped. Owner: Task 1.
2. A supplier-order payment made yesterday under the new payment screens is now a payment, not a cost. The order screen must show „чака фактура" rather than the project losing the cost without a word. Owner: Task 4.
3. A client invoice linked to a proforma, paid by a transfer linked to the invoice, must close the milestone and the proforma exactly once. Owner: Task 2.
4. A labour row without `labour_days` must not make man-days NaN; it counts 0 days and is listed. Owner: Task 3.
5. A person with no rows shows balance 0, not an error. Owner: Task 3.

---

### Task 1: Row roles and the cost rule

**Files:** Create `server/roles.js`. Modify `server/payments.js` (`projectMoney`), `server/routes_accounting.js` (`TX_METHODS`, `/api/ledger` totals, new `GET /api/payments/unallocated`). Test `test/roles.test.mjs`.

**Interfaces — Produces:**
- `roleOf(tx): 'cost' | 'payment' | 'income_doc' | 'income_payment' | 'advance' | 'return' | 'stock' | 'legacy'`
  - out + kind `supplier_doc | fiscal | no_doc | labour | other`, not a child → `cost`
  - out + `store` → `stock`
  - out + `bank_out`, or any out child (`document_id` set) → `payment`
  - out + `card` → `advance`
  - in + `client | proforma`, not a child → `income_doc`
  - in + `bank_in`, any in child, or any row with `proforma_id` / `contract_payment_id` that is not an `income_doc` → `income_payment`
  - in + `card` → `return`
  - NULL kind → `legacy`, keeping today's meaning: out paid root = cost, in = income payment
- `projectMoney` keeps its keys. Expense comes from `cost`, `stock` and `legacy` cost rows only; `payment` rows count as paid_out and never as expense; payables = open of `cost` documents only.
- `GET /api/payments/unallocated?project_id=` → out `payment` roots without `document_id`, plus `legacy` rows, for Accounting.

- [ ] **Step 1: failing tests** (`test/roles.test.mjs`)
  - `roleOf` truth table for every kind and direction in the list above, with and without `document_id`
  - Project: invoice 1200 committed with VAT 200, plus an unlinked `bank_out` 5000 → expense_net 1000, paid_out 5000, payables 1200, the 5000 in `/api/payments/unallocated`
  - `store` 865.12 → expense +865.12, payables +0, paid_out +0
  - A legacy row (kind NULL, out, paid 100) is still cost and appears in unallocated
- [ ] **Step 2:** `node --test test/roles.test.mjs` → FAIL (module missing)
- [ ] **Step 3:** implement; `similarPayments` and `settleRow` stay unchanged
- [ ] **Step 4:** `npm test` → all pass. Update the assertions that counted unlinked payments as cost; record each old → new value
- [ ] **Step 5:** commit `feat: ledger rows have one role; payments are not costs`

### Task 2: What clients owe

**Files:** Modify `server/calc.js` (`finance`), `server/ledger_rules.js`. Test `test/roles.test.mjs`.

**Interfaces — Produces:** `finance().receivables` = Σ gross of `income_doc` rows plus proformas not linked by an invoice, minus received. `finance().invoiced` = the same documents, gross.

**Rule:** a client invoice may carry `proforma_id`. Its payments (children) inherit that link in `settleRow`, so the milestone and the proforma close through them.

- [ ] **Step 1: failing tests**
  - Client invoice 10 000 (with VAT), received 6 000 → receivables 4 000
  - Proforma 3720 paid, then the invoice for the same advance linked to it → invoiced 3720, receivables 0, milestone paid once
  - Invoice linked to a proforma, then a transfer on the invoice → milestone and proforma paid, received 3720 (not 7440)
- [ ] **Step 2–4:** FAIL → implement → `npm test` green
- [ ] **Step 5:** commit `feat: receivables come from client documents`

### Task 3: Project result block and person card

**Files:** Modify `server/calc.js` (new `projectResult`, `personCard`), `server/core.js` (setting `indirect_per_manday` = '150'), `server/routes_accounting.js` (include `result` in `/api/projects/:pid/finance`; `TX_METHODS` += `eurowag`). Create `test/fixtures/excel_ledger.json`. Test `test/excel_parity.test.mjs`.

**Interfaces — Produces:**
- `projectResult(db, projectId)` → `{ income_net, materials_net, labour, total_cost, result_before, man_days, indirect_rate, indirect, result_after, unknown_days }`
  - `materials_net` = net of `cost` (except labour) + `stock` + legacy costs
  - `man_days` = Σ `labour_days` of labour rows; a labour row without days adds 0 to `unknown_days`
- `personCard(db, id)` → keeps its keys, with:
  - `given` = out `card` + in rows except `return`
  - `spent` = person's `cost` rows whose `method` ≠ `eurowag`
  - `returned` = in `return`
  - `balance` = given − spent − returned

- [ ] **Step 1: fixture**
  - From the three workbook tabs, store `[date, kind, direction, amount, vat, labour_days, method, link]` per row, with names replaced by `P1…`, `C1…`, `W1…`
  - Linking: each payment (M, P) is linked to the document with the same partner code and document number. Rows with no match stay unlinked
- [ ] **Step 2: failing tests** (`test/excel_parity.test.mjs`): load each tab into a fresh project or person
  - Нестум: income_net 64 897.40, materials_net 36 600.45, labour 5 648.13, man_days 54, indirect 8 100, result_after **14 548.82**
  - Карандила: man_days 15, result_after **10 887.29**
  - Хюсеин: balance **118.80**
  - Every value to the cent
- [ ] **Step 3:** run → FAIL (today: 47 248.56 costs; −1 044.67 balance)
- [ ] **Step 4:** implement → pass; `npm test` green
- [ ] **Step 5:** commit `feat: project result and person card as in the company workbook`

### Task 4: Screens

**Files:** Modify `web/src/pages/ProjectCard.tsx` (FinanceTab), `web/src/pages/Accounting.tsx` (tab „Неразпределени", method „ЕВРОВАГ", kind „Складова разписка", „Връщане" on person card), `web/src/pages/Logistics.tsx` and the Accounting order tab („чака фактура" when an order's payments have no supplier invoice).

- [ ] **Step 1:** FinanceTab shows the result block in Excel's order and words: Приход без ДДС / Разходи материали и услуги без ДДС / Труд / Общо / Резултат преди непреки / Непреки (N надника × 150) / Резултат след непреки
- [ ] **Step 2:** `npx tsc -p web/tsconfig.json` → 0. On a test server, in a browser, enter the Нестум fixture and see 14 548,82 on screen
- [ ] **Step 3:** CHANGELOG entry; `design.md` §14.1–14.2 note; commit `feat: accounting screens follow the company workbook`

## Self-review
- **Spec coverage:** A1 → Task 1; A2 → Task 1; A3 → Task 3; A4 → Task 2; A5 → Task 3 and 4; A6 → Task 3.
- **Review Focus:** lines 1–5 are pinned in Tasks 1, 4, 2, 3, 3.
- **Not in this plan:** parts B (offer files) and C (wiring) get their own plans after this one.
