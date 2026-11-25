# Offers and accounting as in the company's Excel: design

Status: **awaiting operator approval**. Baseline `c80e401`. Evidence: `../../../../excel-compare/REPORT.md`.

## Intent
The offer download is the company's own Excel file. Project accounting gives the same numbers as „Таблица ексел", while keeping the app's single ledger.

## Operator answers (2026-11-26)
1. The customer never sees costs.
2. The errors in the offer template are fixed.
3. ЕВРОВАГ is a separate company, a discount system at Lukoil. Fuel is always a cost.
4. Unpaid client invoices: the system shows what is still owed.
5. Indirect cost: **one man-day (надник) = the company's running costs, everything included**. 150 € per day today.

## Approaches
| | Trade-off | Chosen |
|---|---|---|
| Fill the company's .xlsx file | Literal: fonts, logo, footer and pictures are kept | **Yes** |
| Rebuild the look in code (today) | Never literal; the defects shown in REPORT.md | No |
| Copy the Excel accounting tabs into the app | Brings back free-text names and hard-coded VAT | No: keep the ledger, add Excel's view |

## A. Accounting rules (first: money is wrong today)
**A1. Cost comes from documents.**
- Supplier invoices, fiscal receipts, documents without VAT, labour and stock receipts are costs.
- A bank transfer is **not** a cost. It pays a document.
- A transfer that isn't linked to a document goes to a „Неразпределени плащания" list for Accounting, and changes no result.
- Consequence: a supplier payment counts as cost only through its supplier invoice. The ДДС % on supplier payments added yesterday then matters only for unlinked payments.

**A2. Stock receipts („складова разписка").**
- A new type: cost of the project only, never a bill to pay, never money paid out.

**A3. Person card = Excel's formula.**
- Balance = (money given + money received by the person) − (labour + documents the person paid).
- Fuel paid through ЕВРОВАГ is marked with its own payment method („ЕВРОВАГ"). It is a cost of the project, not the person's money, and doesn't change the person's balance.

**A4. What clients still owe.**
- Owed = client documents with VAT − money received.
- An invoice that settles a proforma is linked to it and counted once (my call).

**A5. Project result block, line by line as Excel.**
| Line | Rule |
|---|---|
| Приход без ДДС | client documents without VAT |
| Разходи материали и услуги без ДДС | cost documents without VAT, excluding labour |
| Труд | labour rows |
| Резултат преди непреки | |
| Непреки разходи | **actual man-days × rate**, from labour rows; rate in Settings, 150 |
| Резултат след непреки | |

„Резултат след данък" is typed by hand in Excel today, so it's left out until you give the rule.

**A6. Proof.** Tests built from the real Нестум, Карандила and Хюсеин rows must give Excel's numbers to the cent: 14 548.82 / 10 887.29 / 118.80.

## B. Offer file = the company template
**B1. The template.**
- A cleaned copy of the company workbook ships with the app.
- Its errors are fixed: `#REF!` in Sport and Play, the one-row totals, and G = ROUND(W,2) everywhere. You check them in Excel before use.

**B2. Customer file.**
- The template's offer sheet with columns A–H only. No cost, profit or calculation sheets; nothing hidden that could be revealed.
- It keeps the header block, logo, footer strip, section photos, totals and clauses.

**B3. Internal file.**
- The same sheet with columns I–W (calculation) plus the Труд sheet.
- Only for users who may see finance.

**B4. On screen.**
- The „Excel реплика" tab shows the same header block and layout as the file.

**B5. Sheet choice.**
- All offers use one cleaned layout (КСС-style), because the sheets share it.
- Product photos come from the app's catalogue (my call).

## C. Offer → contract → accounting
- Each contract line keeps material, delivery, labour and planned man-days from its offer line.
- The project shows planned against actual for materials, labour, man-days and indirect cost, and the result next to the offer's planned profit.

## Order
1. **A** (accounting rules and result block).
2. **B** (offer files).
3. **C** (wiring).

Each part ends with all tests green and a check in a browser. Deploy only when you ask.

## Not in scope
- The material calculator sheets (Multi1CS, Melos EPDM, Corkeen, One DNA).
- Bank statement import.
- Corporate tax rules.
