# Offer files as the company template: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The offer download is the company's own Excel file. A customer file shows prices only; an internal file also carries the calculation and the Труд sheet.

**Architecture:**
- A one-off builder trims the company workbook to a clean template, `server/assets/offer_template.xlsx`, and fixes its errors.
- At download time, `server/offer_xlsx.js` opens that file as a zip and writes rows into the sheet XML. It reuses the template's own style numbers, so fonts, borders, logo, footer and print setup stay the company's.
- ExcelJS is no longer used for offers, because it drops grouped pictures and the page-footer image.

**Tech Stack:** Node ESM, `jszip` 3.10 (already installed through exceljs), `sharp` (installed) to turn webp into png, React + TS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-excel-parity-design.md`, part B (approved 2026-11-26). Evidence: `C:\lab\infraerp\excel-compare\`.

## Global Constraints
- **Source of the layout:** sheet „КСС" of `Offer Template_+ правно административни допълнения.xlsx`. Its section row style comes from sheet „Sport" row 10.
- **Customer file:** columns A–H only. No hidden columns, no cost numbers anywhere in the file, no comments, no Труд sheet, no formula pointing past column H.
- **Internal file:** columns A–W with the template's formulas (G = ROUND(W,2), O = I+J+L·M, P = O·overhead %, T = O·profit %, V = T·tax %, W = O+P+T+V), plus the Труд sheet. Only for users who may see costs, the same rule as today (`finance` read or `offers` write).
- **Numbers:** every formula carries its value as computed by the app (`priceLine`), so the file shows the same totals even before Excel recalculates. These are the same numbers shown on screen.
- **Template errors fixed once:** the one-row total (U22 = SUM(U21:U21) → whole range), G = ROUND(W,2) on every line, no `#REF!`, no links to other workbooks, no staff comments.
- **Text:**
  - header: На вниманието на / Обект / Оферта № `<code>` / date / Валидна до / Съставил / Тел. за връзка, from the offer and its owner
  - clauses: from Settings `offer_clauses`, as today
- **Pictures:** webp images become png (Excel can't show webp). Each different picture is stored once.

## Review Focus
1. **An offer with 60+ lines** should print on several A4 pages with the header row repeated and the footer on every page. Owner: Task 2.
2. **A very long description** should wrap, with the row tall enough to read and nothing cut off, the defect seen today. Owner: Task 2.
3. **Alternative sections** keep their own totals, marked „Вариант — не се сумира", and are left out of the grand total; with a discount the grand total shows the discount line. Owner: Task 2.
4. **A user without cost rights** asking for the internal file gets 403, and the customer file never contains a cost column even for an admin. Owner: Task 4.
5. **No prices yet** (0 lines, or a line with quantity 0) still produces a valid file that opens in Excel. Owner: Task 2.

---

### Task 1: Clean template and its map
**Files:** Create `tools/build_offer_template.mjs`, `server/assets/offer_template.xlsx`, `server/assets/offer_template.map.json`. Test `test/offer_template_file.test.mjs`.

**Interfaces — Produces:** `offer_template.map.json` with the style id of every cell kind:
- header label and value cells (rows 1–7)
- the column header row (row 8)
- a line row, columns A–W
- section banner and description
- the three totals rows
- the clause block
- the row heights
- the sheet names `КСС` (renamed `Оферта` for the customer) and `Труд`

- [ ] **Step 1:** write the test
  - Template has exactly 2 sheets.
  - Workbook has no `externalLink`, `comments` or `calcChain` part, and no `#REF!` in any formula.
  - The page footer (`legacyDrawingHF`, image „Footer 2026") and the logo drawing are present.
  - The file is under 2 MB.
  - Every style id named in the map exists in `styles.xml`.
- [ ] **Step 2:** run → FAIL (no file)
- [ ] **Step 3:** the builder copies the workbook zip, keeps `КСС` and `Труд` and the parts they use, drops the rest, applies the fixes from Global Constraints, and writes the map.
  - Run it once: `node tools/build_offer_template.mjs "<path to company xlsx>"`.
  - The company workbook stays outside the repo; only the trimmed template is committed.
- [ ] **Step 4:** test → PASS. Render the template to PDF in Excel on this PC and save the PNG to `excel-compare/template-clean.png` for you to look at.
- [ ] **Step 5:** commit `feat: clean offer template from the company workbook`

### Task 2: Filling the customer file
**Files:** Create `server/offer_xlsx.js`. Test `test/offer_xlsx.test.mjs`.

**Interfaces — Consumes:** `offerDocument(db, offerId, version)` from `server/print.js` (sections, lines, totals, clauses, owner, images as data URIs). **Produces:** `offerXlsx(db, offerId, versionNo, { internal: boolean }) → Promise<{ buffer: Buffer, filename: string }>`. Filename `Oferta_<code>_v<version>[_vatreshna].xlsx`.

- [ ] **Step 1:** tests (unzip the result with jszip and read the sheet XML)
  - Header cells hold the offer's values: attention_to, title + address, `№ <code>`, date, valid until, owner name, phone.
  - Per section: a banner row with title and description, then line rows with No, description, unit, quantity, unit price, total. Section totals H = SUM over that section; ДДС; с ДДС. Grand totals at the end, with the discount line when there is one.
  - Values equal `offerTotals` to the cent. The 100 m² and 33.3 m² lines give 6 732.98 / 1 346.60 / 8 079.58, as in today's render.
  - Customer file: no `<c r="I…">` or later cell in any row, `<cols>` ends at H, the print area is `A1:H<last row>`, the header row repeats on each page.
  - Review Focus 1, 2, 3 and 5: 65 lines; a 400-character description (row height ≥ 3 text lines); an alternative section left out of the grand total; an empty offer. All give valid XML that `jszip` reopens.
  - Section and line pictures: one `xl/media` file per distinct picture, anchored in column D of its row.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** implement. Rows are written as XML strings with inline text (`t="inlineStr"`), so the shared string table is untouched. Merges, row heights, the drawing and its rels, content types and the print area are updated. `fullCalcOnLoad="1"` is set.
- [ ] **Step 4:** test → PASS
- [ ] **Step 5:** commit `feat: customer offer file filled into the company template`

### Task 3: The internal file
**Files:** Modify `server/offer_xlsx.js`. Test `test/offer_xlsx.test.mjs`.

- [ ] **Step 1:** tests
  - Internal file: columns I–W on every line with the template formulas and cached values equal to `priceLine` (material, delivery, man-days, day rate, overhead %, profit %, tax %).
  - Section totals for K, N, Q, R, U.
  - The Труд sheet is filled from the offer's `labour_calc`:
    - activities in rows 4–12, columns C, D, F, G
    - vehicles in J/K of rows 6, 10 and 14
    - wage E24, price per night E26, mechanisation F27, other СМР F28, other F29
    - total F30 and day rate F31 equal to `labourCalc`
- [ ] **Step 2–4:** FAIL → implement → PASS
- [ ] **Step 5:** commit `feat: internal offer file with calculation and Труд`

### Task 4: Download routes and buttons
**Files:** Modify `server/export.js` (route), `web/src/pages/OfferEditor.tsx` (buttons). Test `test/export.test.mjs`.

- [ ] **Step 1:** tests
  - `GET /api/offers/:id/export.xlsx` gives the customer file to anyone with offers read.
  - `?file=internal` gives the internal file only with finance read or offers write, otherwise 403.
  - The old `costs` parameter is gone.
  - The Content-Disposition name is correct.
- [ ] **Step 2–4:** FAIL → implement (replace ExcelJS use in `export.js`) → PASS
- [ ] **Step 5:** two buttons in the offer editor, „Excel за клиента" and „Excel вътрешен" (the second only for cost-rights users). `tsc` → 0. Commit `feat: customer and internal offer downloads`

### Task 5: „Excel реплика" on screen
**Files:** Modify `web/src/pages/OfferEditor.tsx` (`ExcelReplica`), `web/src/styles.css`.

- [ ] **Step 1:** above the grid, the template's header block (logo right, the seven header fields) and below it the footer strip image (from the template, served as `/offer-footer.png`). The column count matches when the cost columns are hidden (today 6 header cells against 8 cells per row).
- [ ] **Step 2:** `tsc` → 0. In a browser, the replica tab for the test offer shows the header, sections, totals and footer. A screenshot is saved to `excel-compare/replica-new.png`.
- [ ] **Step 3:** commit `feat: Excel replica tab shows the template's header and footer`

### Task 6: Proof against the template
- [ ] **Step 1:** generate the customer and internal files for a test offer (2 sections, an alternative, pictures, a discount). Render both in Excel on this PC to PNG in `excel-compare/`, next to `template-KSS.png`.
- [ ] **Step 2:** the full suite is green. CHANGELOG entry; `OFFER_TEMPLATE_NOTES.md` note on the new pipeline. Commit `docs: offer files follow the company template`.

## Self-review
- **Spec coverage:** B1 → Task 1; B2 → Task 2; B3 → Task 3; B4 → Task 5; B5 → Task 2 (one layout; catalogue pictures); the fixing of template errors → Task 1; the operator's check of the fixed template → Task 1, step 4, and Task 6.
- **Review Focus:** lines 1, 2, 3 and 5 → Task 2; line 4 → Task 4.
- **Not in this plan:** the product-system sheets (Sport, Play, …) as separate layouts. All offers use the КСС layout with sections, as decided in the design. Part C (wiring) has its own plan.
