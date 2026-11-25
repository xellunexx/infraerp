# One payment record: design

Status: **awaiting operator approval**. Baseline `9d1b6f1`. No code written.

## Intent

One true answer to "has this been paid, when, and what is still owed?" Today the contract schedule, the proforma and the ledger each hold their own answer and drift apart. `design.md` §14.1 already requires it: one `transactions` book, no row entered twice.

**Goals:** a payment is recorded once; milestone, proforma, deadline and finance are read from it; cancelling it undoes all of them; Contracts and Accounting can both record, without double counting.

**Non-goals:** annexes (own design), bank statement import, currency conversion, tax accounting.

**Anti-goals:** inventing payments for old data; stored copies of "paid"; a Contracts entry moving money figures before Accounting has seen the bank.

## Decided by the operator

- Contracts may record client payments too (2026-11-25).
- Earlier, `design.md` §14: `amount` is gross; open amounts are computed, never stored; signed but unpaid projects stay under „Предстоящи" with „чака аванс".

## Approaches

| | Trade-off | Outcome |
|---|---|---|
| A. Ledger is the source | Largest change; screens cannot disagree | Proposed; the operator answered within it |
| B. Keep three copies, sync | Smaller; is what fails today | Rejected |
| C. Contract schedule is the source | No suppliers, no partial payments | Rejected |

## Design (D = the builder's-side calls made here, open to correction)

### 1. Two steps for a client payment

```
Contracts:   reported ──(Accounting confirms)──> paid ──(void)──> voided
                └──────(Accounting rejects, with reason)────────> voided
Accounting:  paid directly
```

- New ledger status `reported`. **Only `paid` counts (D)**: a reported payment changes no total, no milestone, no proforma and starts no deadline. It shows as „докладвано, чака потвърждение".
- On confirmation the **bank date** is used, so the deadline is right even if confirmed days later. Accounting may correct date and amount; the audit log keeps both.
- `POST /api/projects/:pid/payments` requires `contracts` write or `finance` write, plus project scope. The server sets the status: `paid` with finance write, otherwise `reported`. A client-sent status is ignored.
- `POST /api/payments/:id/confirm` and `/reject` require `finance` write. Rejecting needs a reason and notifies the reporter. Reporting notifies Accounting and a reminder repeats daily while it waits.
- The existing `PUT …/contract/payments` keeps only plan fields (%, net). `paid_at` sent to it is refused with a message naming the new action.
- Only rows created here (client payment, `direction = 'in'`, linked to a milestone or proforma) are reachable by Contracts; it gets no other ledger access.

### 2. Double entry

- A client `uid` makes a repeated submit one row.
- Before confirm, and before a direct entry, the server lists other `reported` or `paid` payments of the same project with the same amount within 5 days (D). Accounting chooses „същото плащане" (the report is merged into the existing row and voided) or „отделно плащане". Nothing is merged automatically.

### 3. Links

- `transactions.contract_payment_id`, `transactions.supplier_order_id`, `transactions.order_stage` (`advance`/`final`): new nullable columns, added by the existing additive migration.
- A payment linked to a proforma inherits its milestone by `kind`. Both links must belong to the same project. Kind `other` has no milestone.
- One transfer covering two milestones is entered as two rows sharing `document_ref`. Surplus stays on its milestone and shows as overpaid; it is not spread automatically (D).

### 4. Derived values (one module, `server/payments.js`)

| Value | Rule |
|---|---|
| Milestone paid amount | sum of `paid` rows linked directly or through its proformas, each row once |
| Milestone paid date | `tx_date` of the row at which the running sum, by date then id, reaches gross − 0.005; null before that |
| Proforma paid | the same rule on its own rows against its gross. Stored status stays only `issued`/`cancelled` |
| Advance date, final deadline, delivery due | from the advance milestone's paid date |
| Received | sum of `paid` income rows |
| Open on a document | no children: `paid` gives 0, otherwise the amount. With children: max(0, amount − paid children) |
| Payables | sum of open on `committed` outgoing documents |
| Expense | each document once: the larger of its amount and its paid children. `planned` without payments does not count |

Everything now reading `paid_at` or proforma `status` moves here: `contractView`, `/api/dashboard`, `finance`, `txView`/`withOpen`, the `proforma_due` reminder, the proforma rows in `routes_reports.js`, the contract timeline, the proforma list. A test fails if `contract_payments.paid_at` is read outside migration code.

### 5. ДДС

- Ledger amounts are gross. Net = amount − `vat_amount` (if `has_vat` and no amount is given: amount × rate / (100 + rate)).
- Milestones store net and `vat_pct`; gross is computed. Rounding: advance and interim are rounded, final is the remainder, in net and in gross separately, so the parts always sum to the contract.
- Receivables, payables, received, paid: gross. Contract value, expense, result, remaining budget: net. Every figure's label says „с ДДС" or „без ДДС".
- Result to date (D): received net − paid net.
- A VAT rate is fixed on the milestone at signing; changing the setting later does not move signed contracts.

### 6. Guards

- Editing a document below what is already paid on it, or voiding a document with paid children: refused.
- Cancelling a proforma with reported or paid payments: refused.
- Voiding a payment needs `finance` write; milestone, proforma and deadline fall back by themselves.
- Bank date: valid, required, not in the future.
- `advance_pct`: 0–100, required to submit a contract (0 is allowed and then no advance proforma is issued). Appendix 3 and the schedule both use it; the silent 50% default is removed. With no advance, the deadline starts at `signed_on` (D).
- Change requests may not edit amount, direction, status or date of a payment, proforma `status`, or quantity and price of a line on a signed contract.

### 7. Supplier orders

Advance and final payments are ledger rows (`out`) linked by `supplier_order_id` + `order_stage`. Dates are derived as in section 4, so production and delivery countdowns follow real transfers. Logistics writers without finance use the same report step. Amounts are as invoiced by the supplier (D). Advance above total is refused.

### 8. Screens

```
Договор → Разплащателен график
 Плащане      %   Без ДДС   С ДДС    Получено   Дата        Състояние
 Аванс        50  3 100,00  3 720,00 3 720,00   10.11.2026  платено
 Междинно     30  1 860,00  2 232,00 1 000,00   —           частично
 Окончателно  20  1 240,00  1 488,00 0,00       —           докладвано 1 488,00
                                             [Запиши плащане]

Счетоводство → „За потвърждение (1)"
 Обект  Етап  Сума  Дата  Докладвал  ⚠ подобно плащане   [Потвърди] [Отхвърли]
```

Contracts sees the button as „Докладвай плащане". Amounts follow the existing `canSeeMoney` mask.

## Existing data

Measured on the VM, 2026-11-25: 1 proforma (issued), 0 ledger rows, 0 supplier orders, 2 signed contracts, 1 with a schedule, 1 milestone marked paid with no ledger row. Re-measure at deploy.

- No payment is created. A milestone with a stored `paid_at` and no linked row appears in „За потвърждение" as „стара дата без плащане". Accounting enters the payment or clears the date.
- Until then that project's deadline shows „непотвърден", which may move it between dashboard flags. Operator is told which project before deploy.
- A signed contract without a schedule is listed for a person; it is not filled in.
- Its contract has `advance_pct` 0 with a 50% schedule: shown as a conflict, not changed.

Rollback: columns are additive, so the previous code starts on the migrated database. It would ignore `reported` rows and show the old figures, and stored `paid_at` values are kept.

## Tests that must exist first (failing)

1. The measured table: 500; invoice 1,200; pay 400; pay 800 → expense net 1,500, open 0 at the end.
2. Proforma 3,100 + 20%: 3,720 recorded with the bank date; milestone and deadline follow.
3. Void: milestone, proforma and deadline all revert.
4. Contracts reports: no figure moves; confirm moves all; reject notifies; Contracts cannot set `paid`, confirm or void.
5. The same transfer reported and entered directly: flagged; merge leaves one counted row.
6. Two partial payments; overpayment; two proformas on one milestone; a row linked both ways counts once.
7. Rounding: 100.01 split 50/30/20 with 20% sums exactly, net and gross.
8. Every guard in section 6; project scope and money mask on all new routes.
9. Migration on a copy: no rows created; list contains exactly the unmatched milestone.
10. Accountable-person cards unchanged.

Existing assertions expecting net proforma figures (`accounting.test.mjs` lines 115–146 and 248–264) will change; each change is listed in the report.

## Build order

1. `payments.js` + tests (no route uses it). 2. Finance and ledger totals. 3. Milestone, proforma, deadline. 4. Report and confirm. 5. Supplier orders. 6. Guards. 7. Screens. 8. Migration rehearsal on a copy of the live database. Each step ends with the full suite green. Deploy only on request.

## Left to the builder

Names inside modules, exact wording of messages, layout within the sketched screens.
