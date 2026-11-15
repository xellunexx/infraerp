// Printable offer in the company layout (logo, header block, sections with their own totals, legal clauses, footer strip).
// Only customer-facing columns are printed: the cost breakdown never leaves the system.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, need, setting } from './core.js';
import { offerTotals } from './domain.js';
import { FILES_DIR } from './db.js';
import { h } from './app.js';

export const DEFAULT_CLAUSES = [
  'Настоящата оферта има информативен характер и не представлява обвързващ договор.',
  'Ангажиментите на страните стават окончателни само след подписването на писмен договор или изрично писмено потвърждение на поръчката от страна на Изпълнителя.',
  'Изпълнителят си запазва правото да коригира предложените цени в случай на настъпване на обстоятелства извън неговия контрол (напр. рязка промяна в цените на енергоносителите, суровините или законови промени), за което Клиентът ще бъде уведомен своевременно.',
  'Всички концепции, графични материали, изчисления и технически решения, съдържащи се в офертата, са собственост на Изпълнителя. Те не могат да бъдат предоставяни на трети лица без изрично писмено съгласие.',
].join('\n');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
const qty = n => new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 3 }).format(n ?? 0);
const date = s => s ? s.slice(0, 10).split('-').reverse().join('.') : '';
const asset = name => { const f = new URL(`./assets/${name}`, import.meta.url); return fs.existsSync(f) ? `data:image/png;base64,${fs.readFileSync(f).toString('base64')}` : null; };
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const mimeOf = f => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
/** image_document_id -> latest version file as a data URI (fitted into the print box by CSS). */
const imgData = (db, docId) => {
  if (!docId) return null;
  const v = db.prepare('SELECT stored_name, mime FROM document_versions WHERE document_id = ? ORDER BY version DESC LIMIT 1').get(docId);
  if (!v) return null;
  const f = path.join(FILES_DIR, v.stored_name);
  return fs.existsSync(f) ? `data:${v.mime || mimeOf(v.stored_name)};base64,${fs.readFileSync(f).toString('base64')}` : null;
};

/** Data for the customer-facing document (shared by the print view and the Excel export). */
export function offerDocument(db, offerId, versionNo) {
  const o = db.prepare('SELECT o.*, c.name AS customer_name FROM offers o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(offerId);
  if (!o) throw new HttpError(404, 'Офертата не е намерена');
  const v = db.prepare('SELECT * FROM offer_versions WHERE offer_id = ? AND version = ?').get(offerId, versionNo || o.current_version);
  if (!v) throw new HttpError(404, 'Няма такава версия');
  const owner = o.owner_id ? db.prepare('SELECT full_name, phone FROM users WHERE id = ?').get(o.owner_id) : null;
  const totals = offerTotals(db, v.id);
  const lines = db.prepare('SELECT * FROM offer_lines WHERE version_id = ? ORDER BY sort, id').all(v.id);
  const vat = totals.vat_pct, f = 1 - (v.discount_pct || 0) / 100;
  const block = rows => { const net = rows.reduce((s, l) => s + Math.round(l.qty * l.unit_price * 100) / 100, 0); return { net, vat: net * vat / 100, gross: net * (1 + vat / 100) }; };
  const sections = db.prepare('SELECT * FROM offer_sections WHERE version_id = ? ORDER BY sort, id').all(v.id).map(s => {
    const rows = lines.filter(l => l.section_id === s.id).map(l => ({ ...l, image: imgData(db, l.image_document_id) }));
    return { ...s, image: imgData(db, s.image_document_id), lines: rows, totals: block(rows) };
  });
  const loose = lines.filter(l => !l.section_id).map(l => ({ ...l, image: imgData(db, l.image_document_id) }));
  return { offer: o, version: v, owner, totals, vat, discount_factor: f, sections, loose, loose_totals: block(loose),
    clauses: String(setting(db, 'offer_clauses', DEFAULT_CLAUSES)).split('\n').map(x => x.trim()).filter(Boolean), currency: setting(db, 'currency', 'EUR') };
}

export function renderOfferHtml(d) {
  const { offer: o, version: v } = d, cur = d.currency === 'EUR' ? '€' : esc(d.currency);
  const table = (rows, t, showTotals) => `<table class="lines"><thead><tr><th class="no">No</th><th>Описание на СМР</th><th class="u">Ед. мярка</th><th class="n">Количество</th><th class="n">Ед. цена ${cur}</th><th class="n">Обща стойност</th></tr></thead>
    <tbody>${rows.map((l, i) => `<tr><td class="no">${i + 1}</td><td>${esc(l.description)}${l.image ? `<img class="pimg" src="${l.image}" alt="">` : ''}</td><td class="u">${esc(l.unit)}</td><td class="n">${qty(l.qty)}</td><td class="n">${money(l.unit_price)}</td><td class="n">${money(Math.round(l.qty * l.unit_price * 100) / 100)}</td></tr>`).join('')}</tbody>
    ${showTotals ? `<tfoot><tr><td colspan="5">Общо, ${cur} без ДДС:</td><td class="n">${money(t.net)}</td></tr><tr><td colspan="5">ДДС ${qty(d.vat)}%:</td><td class="n">${money(t.vat)}</td></tr><tr class="grand"><td colspan="5">Общо, ${cur} с ДДС:</td><td class="n">${money(t.gross)}</td></tr></tfoot>` : ''}</table>`;
  const logo = asset('offer_logo.png'), footer = asset('offer_footer.png');
  const hasAlt = d.sections.some(s => s.alternative), summed = d.sections.filter(s => !s.alternative).length + (d.loose.length ? 1 : 0);
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Оферта № ${esc(o.code)}</title><style>
    @page { size: A4; margin: 12mm 12mm 6mm; } * { box-sizing: border-box; } body { font: 10.5pt/1.35 "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
    .page { max-width: 190mm; margin: 0 auto; padding: 8mm 0 4mm; } .logo { height: 11mm; margin-bottom: 6mm; } .head { display: grid; grid-template-columns: 42mm 1fr; gap: 1.2mm 4mm; margin-bottom: 6mm; } .head b { font-weight: 600; }
    h2 { font-size: 10.5pt; font-weight: 400; margin: 6mm 0 2mm; padding: 2mm 3mm; background: #f1f3f5; border-left: 3px solid #111; } h2 b { display: block; font-size: 11pt; }
    table.lines { width: 100%; border-collapse: collapse; margin-bottom: 2mm; } .lines th { background: #111; color: #fff; font-weight: 600; font-size: 9pt; padding: 1.6mm 2mm; text-align: left; } .lines td { border-bottom: 0.2mm solid #cfd4da; padding: 1.6mm 2mm; vertical-align: top; }
    .lines .n { text-align: right; white-space: nowrap; } .lines .no { width: 9mm; } .lines .u { width: 18mm; } .lines tfoot td { border: 0; text-align: right; font-weight: 600; padding: 1mm 2mm; } .lines tfoot .grand td { font-size: 11.5pt; border-top: 0.4mm solid #111; }
    .pimg { display: inline-block; float: right; max-height: 26mm; max-width: 52mm; object-fit: contain; background: #fff; border: 0.2mm solid #c9ced4; margin: 0 0 1mm 4mm; vertical-align: middle; } h2 .pimg { margin-top: -1mm; }
    .alt { font-size: 9pt; color: #555; margin: -1mm 0 3mm; } .foot-note { margin-top: 3mm; white-space: pre-wrap; } ol.clauses { margin: 8mm 0 0; padding-left: 5mm; font-size: 8.8pt; color: #333; } ol.clauses li { margin-bottom: 1.2mm; }
    .grandtotal { margin-top: 6mm; margin-left: auto; width: 80mm; } .grandtotal td { padding: 1mm 2mm; text-align: right; font-weight: 600; } .grandtotal tr:last-child td { font-size: 12pt; border-top: 0.4mm solid #111; }
    .footer { position: fixed; left: 0; right: 0; bottom: 0; text-align: center; background: #fff; } .footer img { width: 190mm; max-width: 100%; }
    .bar { position: sticky; top: 0; background: #111; color: #fff; padding: 8px 14px; display: flex; gap: 10px; align-items: center; font-size: 13px; } .bar button { font: inherit; padding: 5px 12px; cursor: pointer; }
    table.sheet { width: 100%; border-collapse: collapse; } table.sheet > tbody > tr > td, table.sheet td.spacer { padding: 0; border: 0; } td.spacer { height: 30mm; }
    section { break-inside: avoid; } @media print { .bar { display: none; } .page { padding-top: 0; } }
  </style></head><body>
  <div class="bar"><span>Оферта № ${esc(o.code)} · версия ${v.version}</span><button onclick="window.print()">Печат / Запис като PDF</button></div>
  <table class="sheet"><tfoot><tr><td class="spacer"></td></tr></tfoot><tbody><tr><td><div class="page">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <div class="head">
      <b>На вниманието на:</b><span>${esc(v.attention_to || o.customer_name)}</span>
      <b>Обект:</b><span>${esc(o.title)}${o.site_address ? ', ' + esc(o.site_address) : ''}</span>
      <b>Оферта:</b><span>№ ${esc(o.code)} / ${date(v.offer_date)}</span>
      <b>Валидна до:</b><span>${date(d.totals.valid_until)}</span>
      <b>Съставил:</b><span>${esc(d.owner?.full_name || '')}</span>
      <b>Тел. за връзка:</b><span>${esc(d.owner?.phone || '')}</span>
    </div>
    ${d.sections.map(s => `<section><h2><b>${esc(s.title)}</b>${s.image ? `<img class="pimg" src="${s.image}" alt="">` : ''}${esc(s.description || '')}</h2>${s.alternative ? '<div class="alt">Вариант — не се сумира с останалите варианти.</div>' : ''}${table(s.lines, s.totals, true)}${s.footer ? `<div class="foot-note">${esc(s.footer)}</div>` : ''}</section>`).join('')}
    ${d.loose.length ? `<section>${d.sections.length ? '<h2><b>Други</b></h2>' : ''}${table(d.loose, d.loose_totals, true)}</section>` : ''}
    ${summed > 1 || (v.discount_pct || 0) > 0 ? `<table class="grandtotal">${(v.discount_pct || 0) > 0 ? `<tr><td>Отстъпка ${qty(v.discount_pct)}%:</td><td>−${money(d.totals.gross - d.totals.net)}</td></tr>` : ''}
      <tr><td>Общо${hasAlt ? ' (без вариантите)' : ''}, ${cur} без ДДС:</td><td>${money(d.totals.net)}</td></tr><tr><td>ДДС ${qty(d.vat)}%:</td><td>${money(d.totals.vat)}</td></tr><tr><td>Общо, ${cur} с ДДС:</td><td>${money(d.totals.total_with_vat)}</td></tr></table>` : ''}
    <ol class="clauses">${d.clauses.map(c => `<li>${esc(c)}</li>`).join('')}</ol>
  </div></td></tr></tbody></table>
  ${footer ? `<div class="footer"><img src="${footer}" alt=""></div>` : ''}
  </body></html>`;
}

export default function mountPrint(app, db) {
  app.get('/api/offers/:id/print', h((req, res) => {
    need(req.user, 'offers');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(renderOfferHtml(offerDocument(db, Number(req.params.id), Number(req.query.version) || null)));
  }));
}