// Изрязва шаблона на офертата от работната книга на фирмата: листовете „КСС" и „Труд", логото, долния колонтитул.
// Маха всичко останало (другите листове, коментарите, връзките към други файлове, принтерските настройки)
// и поправя грешките в шаблона по клас, не по клетка:
//   • сума само по един ред (SUM(U21:U21)) в ред с общи суми → същия обхват като другите суми в този ред;
//   • клетка с грешка (#DIV/0!) → IFERROR(формула, 0);
//   • стойностите в полетата от заглавката (име на съставил, телефон) се изчистват — попълват се от офертата.
// Стиловете на всеки вид клетка се четат от самия шаблон и се записват в offer_template.map.json.
// Пуска се веднъж: node tools/build_offer_template.mjs "<път до Offer Template….xlsx>"
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = `${ROOT}/server/assets/offer_template.xlsx`;
const OUT_MAP = `${ROOT}/server/assets/offer_template.map.json`;
const KEEP = ['КСС', 'Труд'];              // in this order; the first is the offer sheet
const SECTION_SHEET = 'Sport';             // its row 11 is a line with a picture
const BANNER_SHEET = 'Padel';             // its row 10 is a section title (plain bold, not the hyperlink style Sport uses)
const HEADER_FIELDS = { attention_to: 'C1', object: 'C2', offer_no: 'A3', date: 'C3', valid_until: 'C4', made_by: 'C6', phone: 'C7' };
const COLS = 'ABCDEFGHIJKLMNOPQRSTUVW'.split('');
const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const T = n => `${NS}/${n}`;

const src = process.argv[2];
if (!src) { console.error('usage: node tools/build_offer_template.mjs <company template .xlsx>'); process.exit(2); }
const zin = await JSZip.loadAsync(readFileSync(src));
const read = p => zin.file(p).async('string');
const relsOf = async part => {
  const p = posix.join(posix.dirname(part), '_rels', posix.basename(part) + '.rels');
  if (!zin.file(p)) return [];
  return [...(await read(p)).matchAll(/<Relationship ([^>]*)\/>/g)].map(m => {
    const a = k => (m[1].match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
    return { id: a('Id'), type: a('Type').split('/').pop(), target: posix.normalize(posix.join(posix.dirname(part), a('Target'))), external: a('TargetMode') === 'External' };
  });
};
const relsXml = rs => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rs.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('')}</Relationships>`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wbXml = await read('xl/workbook.xml');
const wbRels = await relsOf('xl/workbook.xml');
const sheetPart = name => {
  const m = wbXml.match(new RegExp(`<sheet [^>]*name="${esc(name)}"[^>]*r:id="([^"]+)"`));
  if (!m) throw new Error(`sheet ${name} not in workbook`);
  return wbRels.find(r => r.id === m[1]).target;
};

// ---- styles of every cell kind, read from the template itself ----
const cellStyle = (xml, ref) => {
  const m = xml.match(new RegExp(`<c r="${ref}"(?: [^>]*)? s="(\\d+)"`)) || xml.match(new RegExp(`<c r="${ref}" s="(\\d+)"`));
  if (!m) throw new Error(`no style on ${ref}`);
  return Number(m[1]);
};
const rowHeight = (xml, r) => Number(xml.match(new RegExp(`<row r="${r}"[^>]* ht="([\\d.]+)"`))[1]);
const kssXml = await read(sheetPart('КСС'));
const secXml = await read(sheetPart(SECTION_SHEET));
const banXml = await read(sheetPart(BANNER_SHEET));
const rowStyles = (xml, r, cols = COLS) => Object.fromEntries(cols.map(c => [c, cellStyle(xml, `${c}${r}`)]));
const map = {
  source: posix.basename(src.replace(/\\/g, '/')),
  sheets: { offer: 'КСС', customer: 'Оферта', labour: 'Труд' },
  header_fields: HEADER_FIELDS,
  styles: {
    header: Object.fromEntries(['A1', 'C1', 'D1', 'A2', 'C2', 'D2', 'A3', 'B3', 'C3', 'A4', 'C4', 'A6', 'B6', 'C6', 'A7', 'B7', 'C7'].map(r => [r, cellStyle(kssXml, r)])),
    column_header: rowStyles(kssXml, 8),
    line: rowStyles(kssXml, 10),
    line_with_picture: { ...rowStyles(kssXml, 10), ...rowStyles(secXml, 11, 'BCD'.split('')) }, // numbers keep the КСС formats
    section_banner: { ...rowStyles(banXml, 10, 'ABC'.split('')), D: cellStyle(banXml, 'C10'), ...rowStyles(secXml, 10, 'EFGH'.split('')) },
    total_net: { ...rowStyles(kssXml, 22, 'ABCDEFGH'.split('')), K: cellStyle(kssXml, 'K22'), N: cellStyle(kssXml, 'N22'), R: cellStyle(kssXml, 'R22'), U: cellStyle(kssXml, 'U22') },
    total_vat: rowStyles(kssXml, 23, 'ABCDEFGH'.split('')),
    total_gross: rowStyles(kssXml, 24, 'ABCDEFGH'.split('')),
    clause: { A: cellStyle(kssXml, 'A75') },
  },
  heights: {
    header: rowHeight(kssXml, 1), column_header: rowHeight(kssXml, 8), line: rowHeight(kssXml, 10),
    line_with_picture: rowHeight(secXml, 11), section_banner: rowHeight(secXml, 10),
    total_net: rowHeight(kssXml, 22), total_vat: rowHeight(kssXml, 23), clause: rowHeight(kssXml, 75),
  },
  rows: { column_header: 8, first_line: 10, header_last: 7 },
  merges: { column_header: ['B8:D8', 'S8:T8'], line: 'B:D', line_with_picture: 'B:C', section_banner: 'A:D', totals: 'A:G' },
};

// ---- generic fixes ----
function fixOneRowTotals(xml) {
  return xml.replace(/<row ([^>]*)>(.*?)<\/row>/gs, (whole, attrs, body) => {
    const sums = [...body.matchAll(/<f>SUM\(([A-Z]+)(\d+):\1(\d+)\)<\/f>/g)].map(m => ({ col: m[1], a: +m[2], b: +m[3] }));
    if (sums.length < 3) return whole;
    const count = new Map();
    for (const s of sums) count.set(`${s.a}:${s.b}`, (count.get(`${s.a}:${s.b}`) || 0) + 1);
    const [[best]] = [...count].sort((x, y) => y[1] - x[1]);
    const [a, b] = best.split(':').map(Number);
    let out = body;
    for (const s of sums) if (s.a === s.b && s.b === b && s.a > a) { // a total over one row only
      console.log(`  total fixed: ${s.col} SUM(${s.col}${s.a}:${s.col}${s.b}) → SUM(${s.col}${a}:${s.col}${b})`);
      out = out.replace(`<f>SUM(${s.col}${s.a}:${s.col}${s.b})</f>`, `<f>SUM(${s.col}${a}:${s.col}${b})</f>`);
    }
    return `<row ${attrs}>${out}</row>`;
  });
}
function fixErrorCells(xml) {
  return xml.replace(/<c r="([A-Z]+\d+)"([^>]*?) t="e"([^>]*)><f>([^<]+)<\/f><v>[^<]*<\/v><\/c>/g, (_, ref, a, b, f) => {
    console.log(`  error fixed: ${ref} ${f} → IFERROR(${f},0)`);
    return `<c r="${ref}"${a}${b}><f>IFERROR(${f},0)</f><v>0</v></c>`;
  });
}
function clearValues(xml, refs) {
  for (const ref of refs) xml = xml.replace(new RegExp(`<c r="${ref}"( s="\\d+")?(?: t="\\w+")?>(?:(?!</c>).)*</c>`), (_, s) => `<c r="${ref}"${s || ''}/>`);
  return xml;
}

// ---- assemble ----
const zout = new JSZip();
const parts = [];          // [partName, contentType]
const media = new Map();   // old target → new target
let drawingN = 0, vmlN = 0;
async function copyDrawing(target, kind) {
  const n = kind === 'drawing' ? ++drawingN : ++vmlN;
  const name = kind === 'drawing' ? `xl/drawings/drawing${n}.xml` : `xl/drawings/vmlDrawing${n}.vml`;
  zout.file(name, await read(target));
  if (kind === 'drawing') parts.push([name, 'application/vnd.openxmlformats-officedocument.drawing+xml']);
  const out = [];
  for (const r of await relsOf(target)) {
    if (r.type !== 'image') throw new Error(`${target}: unexpected ${r.type}`);
    if (!media.has(r.target)) {
      const nm = `xl/media/${posix.basename(r.target)}`;
      zout.file(nm, await zin.file(r.target).async('nodebuffer')); media.set(r.target, nm);
    }
    out.push({ id: r.id, type: T('image'), target: posix.relative('xl/drawings', media.get(r.target)) });
  }
  if (out.length) zout.file(`xl/drawings/_rels/${posix.basename(name)}.rels`, relsXml(out));
  return name;
}

const sheetEntries = [];
for (const [i, name] of KEEP.entries()) {
  const part = sheetPart(name);
  let xml = await read(part);
  console.log(`${name} ← ${part}`);
  const keepRels = [];
  for (const r of await relsOf(part)) {
    const el = (xml.match(new RegExp(`<(\\w+)[^>]*? r:id="${r.id}"`)) || [])[1];
    if (r.type === 'drawing' && el === 'drawing') keepRels.push({ id: r.id, type: T('drawing'), target: posix.relative('xl/worksheets', await copyDrawing(r.target, 'drawing')) });
    else if (r.type === 'vmlDrawing' && el === 'legacyDrawingHF') keepRels.push({ id: r.id, type: T('vmlDrawing'), target: posix.relative('xl/worksheets', await copyDrawing(r.target, 'vml')) });
    else if (el === 'legacyDrawing') xml = xml.replace(new RegExp(`<legacyDrawing r:id="${r.id}"/>`), '');          // comment boxes
    else if (el === 'pageSetup') xml = xml.replace(` r:id="${r.id}"`, '');                                           // printer settings
    else if (r.type === 'comments' && !el) { /* comments part: dropped */ }
    else throw new Error(`${part}: don't know what to do with ${r.type} on <${el}>`);
  }
  xml = fixErrorCells(fixOneRowTotals(xml));
  if (i === 0) xml = clearValues(xml, Object.values(HEADER_FIELDS).filter(r => !['A3', 'C3', 'C4'].includes(r)));
  const out = `xl/worksheets/sheet${i + 1}.xml`;
  zout.file(out, xml);
  if (keepRels.length) zout.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, relsXml(keepRels));
  parts.push([out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']);
  sheetEntries.push({ name, id: i + 1, oldIndex: [...wbXml.matchAll(/<sheet [^>]*name="([^"]+)"/g)].findIndex(m => m[1] === name) });
}

for (const p of ['xl/styles.xml', 'xl/theme/theme1.xml', 'xl/sharedStrings.xml']) zout.file(p, await read(p));
parts.push(['xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
  ['xl/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
  ['xl/sharedStrings.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'],
  ['xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml']);

const names = [];
for (const s of sheetEntries) {
  const pa = [...wbXml.matchAll(/<definedName name="_xlnm\.Print_Area" localSheetId="(\d+)">([^<]+)<\/definedName>/g)].find(m => +m[1] === s.oldIndex);
  if (pa) names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${s.id - 1}">${pa[2]}</definedName>`);
}
names.push(`<definedName name="_xlnm.Print_Titles" localSheetId="0">${KEEP[0]}!$${map.rows.column_header}:$${map.rows.column_header}</definedName>`);
zout.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS}"><workbookPr defaultThemeVersion="166925"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="19420" windowHeight="11500" activeTab="0"/></bookViews><sheets>${sheetEntries.map(s => `<sheet name="${s.name}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('')}</sheets><definedNames>${names.join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
const n = sheetEntries.length;
zout.file('xl/_rels/workbook.xml.rels', relsXml([
  ...sheetEntries.map(s => ({ id: `rId${s.id}`, type: T('worksheet'), target: `worksheets/sheet${s.id}.xml` })),
  { id: `rId${n + 1}`, type: T('styles'), target: 'styles.xml' },
  { id: `rId${n + 2}`, type: T('theme'), target: 'theme/theme1.xml' },
  { id: `rId${n + 3}`, type: T('sharedStrings'), target: 'sharedStrings.xml' },
]));
zout.file('_rels/.rels', relsXml([{ id: 'rId1', type: T('officeDocument'), target: 'xl/workbook.xml' }]));
zout.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Default Extension="xml" ContentType="application/xml"/>${parts.map(([p, c]) => `<Override PartName="/${p}" ContentType="${c}"/>`).join('')}</Types>`);

for (const m of media.values()) if (!/\.(png|jpe?g)$/i.test(m)) throw new Error(`media type not declared: ${m}`);
mkdirSync(dirname(OUT), { recursive: true });
const buf = await zout.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUT, buf);
writeFileSync(OUT_MAP, JSON.stringify(map, null, 2) + '\n');
console.log(`wrote ${OUT} (${buf.length} bytes), media: ${[...media.values()].join(', ')}`);
