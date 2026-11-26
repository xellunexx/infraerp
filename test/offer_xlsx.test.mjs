// Офертата се сваля като файла на фирмата: шаблонът „КСС", попълнен с редовете, сумите и условията на офертата.
// Файлът за клиента е само колони A–H; вътрешният добавя калкулацията (I–W) и листа „Труд".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { start } from './helpers.mjs';
import { FILES_DIR } from '../server/db.js';
import { offerXlsx } from '../server/offer_xlsx.js';
import { offerTotals } from '../server/domain.js';

const world = async fn => { const t = await start(); try { await fn(t, t.admin); } finally { await t.stop(); } };
const open = async buf => {
  const zip = await JSZip.loadAsync(buf);
  const wbx = new ExcelJS.Workbook(); await wbx.xlsx.load(buf); // a second reader parses it too
  const s = async p => zip.file(p)?.async('string');
  const sheet = await s('xl/worksheets/sheet1.xml');
  const cells = {};
  for (const m of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
    const [, col, row, attrs, body = ''] = m;
    const f = body.match(/<f>([^<]*)<\/f>/)?.[1], v = body.match(/<v>([^<]*)<\/v>/)?.[1], t = body.match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
    cells[col + row] = { f, v: v != null ? Number(v) : undefined, t: t?.replace(/&amp;/g, '&'), s: Number(attrs.match(/s="(\d+)"/)?.[1]) };
  }
  const rows = {};
  for (const m of sheet.matchAll(/<row r="(\d+)"([^>]*)>/g)) rows[m[1]] = Number(m[2].match(/ ht="([\d.]+)"/)?.[1]);
  return { zip, s, sheet, cells, rows, wb: await s('xl/workbook.xml'), names: Object.keys(zip.files), wbx };
};
const find = (cells, pred) => Object.entries(cells).filter(([, c]) => pred(c)).map(([r]) => r);
const rowOf = ref => Number(ref.match(/\d+/)[0]);

async function imageDoc(t, name) {
  const buf = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#3a7' } }).webp().toBuffer();
  fs.mkdirSync(FILES_DIR, { recursive: true }); fs.writeFileSync(path.join(FILES_DIR, name), buf);
  const d = t.db.prepare("INSERT INTO documents (category, title) VALUES ('catalog', 'img')").run().lastInsertRowid;
  t.db.prepare("INSERT INTO document_versions (document_id, version, filename, stored_name, mime, size, sha256) VALUES (?, 1, ?, ?, 'image/webp', ?, 'x')").run(d, name, name, buf.length);
  return Number(d);
}

async function makeOffer(t, a, { discount = 0, lines, sections } = {}) {
  const cust = (await a.post('/api/customers', { name: 'Клуб' })).data;
  const o = (await a.post('/api/offers', { customer_id: cust.id, title: 'Тенис корт', site_address: 'Бургас', attention_to: 'г-н Петров' })).data;
  const r = await a.put(`/api/offers/${o.id}`, { discount_pct: discount, sections: sections ?? [{ key: 's', title: 'TOUR COURT', description: 'Трипластова акрилна система' }],
    lines: lines ?? [{ section: 's', description: 'Полагане на акрилна настилка', unit: 'м²', qty: 648, material_cost: 6.4, delivery_cost: 2, install_cost: 9.26 },
      { section: 's', description: 'Разчертаване', unit: 'бр', qty: 1, material_cost: 830 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return o;
}
const versionId = (t, o) => t.db.prepare('SELECT id FROM offer_versions WHERE offer_id = ? ORDER BY version DESC').get(o.id).id;

test('customer file: the company template with the offer in it, prices only', () => world(async (t, a) => {
  const o = await makeOffer(t, a);
  const { buffer, filename } = await offerXlsx(t.db, o.id, null, { internal: false });
  assert.equal(filename, `Oferta_${o.code}_v1.xlsx`);
  const x = await open(buffer);
  assert.deepEqual([...x.wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1]), ['Оферта']);
  assert.ok(!x.names.some(n => /sheet2|Труд/.test(n)), 'no Труд sheet');
  // header
  assert.equal(x.cells.C1.t, 'г-н Петров');
  assert.equal(x.cells.C2.t, 'Тенис корт, Бургас');
  assert.match(x.cells.A3.t, new RegExp(`№\\s*${o.code}$`));
  assert.ok(x.cells.C3.v > 46000 && !x.cells.C3.f, 'offer date as a date value');
  assert.ok(x.cells.C4.v >= x.cells.C3.v && !x.cells.C4.f, 'valid until, not a formula into column I');
  assert.equal(x.cells.C6.t, 'Админ');
  // nothing past column H, anywhere
  assert.deepEqual(find(x.cells, () => true).filter(r => !/^[A-H]\d+$/.test(r)), []);
  for (const m of x.sheet.matchAll(/<col [^>]*max="(\d+)"/g)) assert.ok(Number(m[1]) <= 8, 'columns end at H');
  assert.ok(!/<f>[^<]*\b[I-Z]\d/.test(x.sheet), 'no formula reaches past H');
  for (const bad of ['6.4', '9.26', '830<']) assert.ok(!x.sheet.includes(`<v>${bad}`), `no cost input ${bad}`);
  // section banner, lines, totals
  const banner = find(x.cells, c => c.t?.startsWith('TOUR COURT'))[0];
  assert.ok(banner && x.cells[banner].t.includes('Трипластова акрилна система'));
  const l1 = rowOf(find(x.cells, c => c.t === 'Полагане на акрилна настилка')[0]);
  assert.deepEqual([x.cells[`A${l1}`].v, x.cells[`E${l1}`].t, x.cells[`F${l1}`].v, x.cells[`G${l1}`].v], [1, 'м²', 648, 24.11]);
  assert.deepEqual([x.cells[`H${l1}`].f, x.cells[`H${l1}`].v], [`F${l1}*G${l1}`, 15623.28]);
  const tot = find(x.cells, c => c.f === `SUM(H${l1}:H${l1 + 1})`)[0];
  assert.ok(tot, 'section total sums its lines');
  const tv = offerTotals(t.db, versionId(t, o));
  assert.equal(x.cells[tot].v, tv.sections[0].gross);
  assert.equal(x.cells[`H${rowOf(tot) + 1}`].v, tv.vat);
  assert.equal(x.cells[`H${rowOf(tot) + 2}`].v, tv.total_with_vat);
  // print setup: area A–H, header row repeated; clauses after the totals; footer and logo kept
  const last = Math.max(...Object.keys(x.rows).map(Number));
  assert.match(x.wb, new RegExp(`_xlnm.Print_Area" localSheetId="0">Оферта!\\$A\\$1:\\$H\\$${last}<`));
  assert.match(x.wb, /_xlnm.Print_Titles" localSheetId="0">Оферта!\$8:\$8</);
  assert.ok(find(x.cells, c => c.t?.startsWith('1. Настоящата оферта')).length === 1, 'clauses');
  assert.match(x.sheet, /<legacyDrawingHF r:id=/); assert.match(x.sheet, /<drawing r:id=/);
  assert.ok(x.cells[`B${l1}`].s === 632 && x.cells[`H${l1}`].s === 356, 'template styles on the line');
}));

test('many lines, long text, alternatives, discount, empty offer: all valid', () => world(async (t, a) => {
  const many = Array.from({ length: 65 }, (_, i) => ({ section: i < 40 ? 'a' : 'b', description: i === 3 ? 'Дълъг текст '.repeat(34) : `Ред ${i + 1}`, unit: 'м²', qty: 10 + i, material_cost: 5 }));
  const o = await makeOffer(t, a, { discount: 5, sections: [{ key: 'a', title: 'Основно' }, { key: 'b', title: 'Вариант Б', alternative: true }], lines: many });
  const x = await open((await offerXlsx(t.db, o.id, null, {})).buffer);
  const long = rowOf(find(x.cells, c => c.t?.startsWith('Дълъг текст'))[0]);
  assert.ok(x.rows[long] >= 3 * 13, `long description row is tall enough (${x.rows[long]})`);
  assert.ok(find(x.cells, c => c.t?.startsWith('Вариант Б') && c.t.includes('не се сумира')).length === 1);
  const tv = offerTotals(t.db, versionId(t, o));
  const disc = find(x.cells, c => c.t?.startsWith('Отстъпка 5%'))[0];
  assert.ok(disc, 'discount line');
  assert.equal(x.cells[`H${rowOf(disc)}`].v, -Math.round((tv.gross - tv.net) * 100) / 100);
  const grand = find(x.cells, c => c.t?.startsWith('Общо (без вариантите)'))[0];
  assert.equal(x.cells[`H${rowOf(grand)}`].v, tv.net);
  assert.equal(x.cells[`H${rowOf(grand) + 2}`].v, tv.total_with_vat);
  assert.equal(find(x.cells, c => /^Ред \d+$/.test(c.t || '')).length, 64);

  const e = await makeOffer(t, a, { sections: [], lines: [] });
  const y = await open((await offerXlsx(t.db, e.id, null, {})).buffer);
  assert.ok(y.sheet.includes('</sheetData>'), 'empty offer opens');
}));

test('pictures: webp becomes png, one file per distinct picture, line picture in column D', () => world(async (t, a) => {
  const img = await imageDoc(t, `xlsx-test-${process.pid}.webp`);
  try {
    const o = await makeOffer(t, a, { sections: [{ key: 's', title: 'С картинка', image_document_id: img }],
      lines: [{ section: 's', description: 'Ред с картинка', unit: 'бр', qty: 1, material_cost: 10, image_document_id: img }, { section: 's', description: 'Без', unit: 'бр', qty: 1, material_cost: 1 }] });
    const x = await open((await offerXlsx(t.db, o.id, null, {})).buffer);
    const media = x.names.filter(n => n.startsWith('xl/media/offer_'));
    assert.equal(media.length, 1, 'same picture stored once');
    assert.ok(media[0].endsWith('.png'));
    const drawing = await x.s('xl/drawings/drawing1.xml');
    const row = rowOf(find(x.cells, c => c.t === 'Ред с картинка')[0]);
    assert.match(drawing, new RegExp(`<xdr:from><xdr:col>3</xdr:col><xdr:colOff>\\d+</xdr:colOff><xdr:row>${row - 1}</xdr:row>`));
    assert.equal((drawing.match(/<xdr:oneCellAnchor/g) || []).length, 2, 'section and line picture');
  } finally { fs.rmSync(path.join(FILES_DIR, `xlsx-test-${process.pid}.webp`), { force: true }); }
}));
