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
