// Excel export of an offer: sheet "Оферта" with the customer-facing layout; sheet "Калкулация" (only for users who may see finance)
// with the internal cost breakdown in the same columns as the company's Excel template.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { need, can } from './core.js';
import { offerDocument } from './print.js';
import { priceLine } from './pricing.js';

const money = '#,##0.00';
export async function offerWorkbook(db, offerId, versionNo, withCosts) {
  const d = offerDocument(db, offerId, versionNo);
  const { offer: o, version: v } = d;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SYNCHRO';
  const ws = wb.addWorksheet('Оферта', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 6 }, { width: 62 }, { width: 10 }, { width: 12 }, { width: 13 }, { width: 15 }];
  const logo = new URL('./assets/offer_logo.png', import.meta.url);
  if (fs.existsSync(logo)) { ws.addImage(wb.addImage({ buffer: fs.readFileSync(logo), extension: 'png' }), { tl: { col: 0, row: 0 }, ext: { width: 220, height: 38 } }); }
  ws.addRow([]); ws.addRow([]); ws.addRow([]);
  const date = s => s ? s.slice(0, 10).split('-').reverse().join('.') : '';
  for (const [k, val] of [['На вниманието на:', v.attention_to || o.customer_name], ['Обект:', o.title + (o.site_address ? ', ' + o.site_address : '')], ['Оферта:', `№ ${o.code} / ${date(v.offer_date)}`],
    ['Валидна до:', date(d.totals.valid_until)], ['Съставил:', d.owner?.full_name || ''], ['Тел. за връзка:', d.owner?.phone || '']]) {
    const r = ws.addRow([k, '', val]); ws.mergeCells(r.number, 1, r.number, 2); ws.mergeCells(r.number, 3, r.number, 6); r.getCell(1).font = { bold: true };
  }
  const block = (title, description, rows, t, alt, footer) => {
    ws.addRow([]);
    if (title) { const r = ws.addRow([title]); ws.mergeCells(r.number, 1, r.number, 6); r.getCell(1).font = { bold: true, size: 12 }; }
    if (description) { const r = ws.addRow([description]); ws.mergeCells(r.number, 1, r.number, 6); r.getCell(1).alignment = { wrapText: true, vertical: 'top' }; r.height = Math.min(90, 15 * Math.ceil(description.length / 95)); }
    if (alt) ws.addRow(['Вариант — не се сумира с останалите варианти.']).getCell(1).font = { italic: true, color: { argb: 'FF666666' } };
    const hr = ws.addRow(['No', 'Описание на СМР', 'Ед. мярка', 'Количество', 'Ед. цена €', 'Обща стойност']);
    hr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } }; });
    const first = hr.number + 1;
    rows.forEach((l, i) => { const r = ws.addRow([i + 1, l.description, l.unit, l.qty, l.unit_price, null]); r.getCell(6).value = { formula: `D${r.number}*E${r.number}`, result: Math.round(l.qty * l.unit_price * 100) / 100 };
      r.getCell(2).alignment = { wrapText: true, vertical: 'top' }; [5, 6].forEach(c => r.getCell(c).numFmt = money); });
    const last = first + rows.length - 1;
    const tot = (label, formula, result, bold) => { const r = ws.addRow(['', '', '', '', label, null]); r.getCell(6).value = { formula, result }; r.getCell(6).numFmt = money; r.getCell(5).alignment = { horizontal: 'right' }; if (bold) r.font = { bold: true }; return r.number; };
    const n = tot('Общо, € без ДДС:', rows.length ? `SUM(F${first}:F${last})` : '0', t.net, true);
    const vr = tot(`ДДС ${d.vat}%:`, `F${n}*${d.vat / 100}`, t.vat);
    tot('Общо, € с ДДС:', `F${n}+F${vr}`, t.gross, true);
    if (footer) { const r = ws.addRow([footer]); ws.mergeCells(r.number, 1, r.number, 6); r.getCell(1).alignment = { wrapText: true }; }
  };
  for (const s of d.sections) block(s.title, s.description, s.lines, s.totals, !!s.alternative, s.footer);
  if (d.loose.length) block(d.sections.length ? 'Други' : '', '', d.loose, d.loose_totals, false);
  ws.addRow([]);
  const g = ws.addRow(['', '', '', '', `Общо${d.sections.some(s => s.alternative) ? ' (без вариантите)' : ''}, € без ДДС:`, d.totals.net]); g.font = { bold: true }; g.getCell(6).numFmt = money;
  if (v.discount_pct) ws.addRow(['', '', '', '', `в т.ч. отстъпка ${v.discount_pct}%`, '']);
  const gg = ws.addRow(['', '', '', '', 'Общо, € с ДДС:', d.totals.total_with_vat]); gg.font = { bold: true }; gg.getCell(6).numFmt = money;
  ws.addRow([]);
  d.clauses.forEach((c, i) => { const r = ws.addRow([`${i + 1}. ${c}`]); ws.mergeCells(r.number, 1, r.number, 6); r.getCell(1).alignment = { wrapText: true }; r.height = 15 * Math.ceil(c.length / 100); r.getCell(1).font = { size: 9 }; });

  if (withCosts) {
    const cs = wb.addWorksheet('Калкулация');
    const head = ['Раздел', 'Описание', 'Мярка', 'Количество', 'Материал франко доставчик', 'Доставка', 'Надници', 'Стойност надник', 'Монтаж/ед.', 'Сума (O)', 'Режийни %', 'Режийни', 'Печалба %', 'Печалба', 'Корп. данък %', 'Корп. данък', 'Изчислена цена', 'Ръчна цена', 'Ед. цена към клиента', 'Себестойност общо', 'Обща стойност'];
    cs.addRow(head).font = { bold: true };
    cs.columns = head.map((_, i) => ({ width: i === 1 ? 48 : 13 }));
    const secName = id => d.sections.find(s => s.id === id)?.title || '';
    for (const l of [...d.sections.flatMap(s => s.lines), ...d.loose]) {
      const c = priceLine(l);
      cs.addRow([secName(l.section_id), l.description, l.unit, l.qty, l.material_cost, l.delivery_cost, l.labour_days, l.day_rate, l.install_cost, c.direct, l.overhead_pct, c.overhead, l.profit_pct, c.profit, l.tax_pct, c.tax,
        c.calculated_price, l.manual_price, l.unit_price, Math.round(l.qty * l.unit_cost * 100) / 100, Math.round(l.qty * l.unit_price * 100) / 100]);
    }
    cs.addRow([]); cs.addRow(['', 'Себестойност (без вариантите)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', d.totals.cost, d.totals.net]).font = { bold: true };
    cs.addRow(['', 'Марж', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', d.totals.margin]).font = { bold: true };
  }
  return { wb, filename: `Oferta_${o.code}_v${v.version}.xlsx` };
}

export default function mountExport(app, db) {
  app.get('/api/offers/:id/export.xlsx', async (req, res, next) => {
    try {
      need(req.user, 'offers');
      const withCosts = can(req.user, 'finance') || can(req.user, 'offers', 'write');
      const { wb, filename } = await offerWorkbook(db, Number(req.params.id), Number(req.query.version) || null, withCosts && req.query.costs !== '0');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    } catch (e) { next(e); }
  });
}