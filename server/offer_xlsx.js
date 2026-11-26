// Офертата като файла на фирмата: шаблонът server/assets/offer_template.xlsx (листът „КСС"), попълнен с офертата.
// Пише се направо в XML на листа със стиловете на шаблона (offer_template.map.json), така че шрифтове, рамки,
// лого, долен колонтитул и настройки за печат остават на фирмата.
//   • за клиента: колони A–H, листът се казва „Оферта"; няма разходи, коментари, лист „Труд" и формули след колона H;
//   • вътрешен: и колоните I–W с формулите на шаблона, и листът „Труд".
// Всяка формула носи стойността, сметната от приложението (priceLine / offerTotals), за да показва същите суми и преди преизчисляване.
import fs from 'node:fs';
import JSZip from 'jszip';
import sharp from 'sharp';
import { offerDocument } from './print.js';
import { offerTotals } from './domain.js';
import { priceLine } from './pricing.js';
import { labourFill } from './offer_xlsx_labour.js';

const TEMPLATE = new URL('./assets/offer_template.xlsx', import.meta.url);
const MAP = JSON.parse(fs.readFileSync(new URL('./assets/offer_template.map.json', import.meta.url), 'utf8'));
let templateBuf = null;
const template = () => (templateBuf ??= fs.readFileSync(TEMPLATE));

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const esc = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => { const x = Number(n); return Number.isFinite(x) ? String(Math.round(x * 1e6) / 1e6) : '0'; };
const COLS = 'ABCDEFGHIJKLMNOPQRSTUVW'.split('');
const colIdx = c => COLS.indexOf(c);
const serial = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
const today = () => new Date().toISOString().slice(0, 10);

// column widths of the template in characters → px (Excel: width*7+5)
const PX = w => Math.round(w * 7 + 5);
function colWidths(sheet) {
  const w = {};
  for (const m of sheet.matchAll(/<col min="(\d+)" max="(\d+)"[^>]* width="([\d.]+)"/g)) for (let i = +m[1]; i <= +m[2]; i++) w[COLS[i - 1]] = +m[3];
  return w;
}
/** Rows of wrapped text a cell of `chars` width needs (rough: Arial 10 ≈ 1 char per width unit). */
const textLines = (s, chars) => String(s || '').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / Math.max(8, chars))), 0);

class Sheet {
  constructor(internal) { this.internal = internal; this.rows = []; this.merges = []; this.pictures = []; }
  row(r, ht, cells) { this.rows.push({ r, ht, cells: cells.filter(c => this.internal || colIdx(c.col) <= 7) }); }
}
const str = (col, s, text) => ({ col, s, xml: text === '' || text == null ? '' : `<is><t xml:space="preserve">${esc(text)}</t></is>`, t: 'inlineStr' });
const val = (col, s, v) => ({ col, s, xml: v == null ? '' : `<v>${num(v)}</v>` });
const fx = (col, s, f, v) => ({ col, s, xml: `<f>${esc(f)}</f><v>${num(v)}</v>` });
const blank = (col, s) => ({ col, s, xml: '' });
const cellXml = (c, r) => c.xml ? `<c r="${c.col}${r}" s="${c.s}"${c.t && c.xml ? ` t="${c.t}"` : ''}>${c.xml}</c>` : `<c r="${c.col}${r}" s="${c.s}"/>`;
const styled = (styles, cols, make) => cols.map(c => make(c, styles[c]));

export async function offerXlsx(db, offerId, versionNo, { internal = false } = {}) {
  const d = offerDocument(db, offerId, versionNo);
  const { offer: o, version: v } = d;
  const totals = offerTotals(db, v.id);
  const zip = await JSZip.loadAsync(template());
  const S = MAP.styles, H = MAP.heights;
  let sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const widths = colWidths(sheet);
  const sh = new Sheet(internal);
  const vat = Number(d.vat), vatF = vat / 100;

  // ---- header block (rows 1–9 from the template, values filled in) ----
  const head = sheet.slice(sheet.indexOf('<sheetData>') + 11, sheet.indexOf('</sheetData>'));
  const fields = {
    attention_to: v.attention_to || o.customer_name,
    object: [o.title, o.site_address].filter(Boolean).join(', '),
    offer_no: `Оферта:            №   ${o.code}`,
    date: serial(v.offer_date || today()),
    valid_until: serial(totals.valid_until || v.offer_date || today()),
    made_by: d.owner?.full_name || '',
    phone: d.owner?.phone || '',
  };
  const byRef = Object.fromEntries(Object.entries(MAP.header_fields).map(([k, ref]) => [ref, fields[k]]));
  let headXml = '';
  for (const m of head.matchAll(/<row r="(\d+)"([^>]*)>(.*?)<\/row>|<row r="(\d+)"([^>]*)\/>/gs)) {
    const r = Number(m[1] ?? m[4]);
    if (r >= MAP.rows.first_line) break;
    let body = m[3] ?? '';
    if (!internal) body = body.replace(/<c r="(?:[I-Z]|[A-Z]{2})\d+"[^>]*?(?:\/>|>.*?<\/c>)/gs, '');
    body = body.replace(/<c r="([A-H]\d+)"( s="\d+")?(?: t="\w+")?(?:\/>|>.*?<\/c>)/gs, (cell, ref, s) => {
      if (!(ref in byRef)) return cell;
      const x = byRef[ref];
      return typeof x === 'number' ? `<c r="${ref}"${s || ''}><v>${x}</v></c>` : x ? `<c r="${ref}"${s || ''} t="inlineStr"><is><t xml:space="preserve">${esc(x)}</t></is></c>` : `<c r="${ref}"${s || ''}/>`;
    });
    const attrs = (m[2] ?? m[5]).replace(/ spans="[^"]*"/, '');
    headXml += `<row r="${r}"${attrs}>${body}</row>`;
  }
  // a header field longer than its cell grows the row instead of being cut off
  const headerCols = ['C', 'D'].reduce((s, c) => s + (widths[c] || 10), 0);
  headXml = headXml.replace(/<row r="([12])"([^>]*) ht="([\d.]+)"/g, (all, r, a, ht) => {
    const n = textLines(r === '1' ? fields.attention_to : fields.object, headerCols);
    return n > 1 ? `<row r="${r}"${a} ht="${Math.max(+ht, n * 13)}"` : all;
  });

  // ---- pictures: each distinct picture once, as png ----
  const media = new Map();
  const picture = async dataUri => {
    if (!dataUri) return null;
    if (!media.has(dataUri)) {
      const m = /^data:image\/[\w.+-]+;base64,(.+)$/.exec(dataUri);
      let im = null;
      if (m) try { const { data, info } = await sharp(Buffer.from(m[1], 'base64')).rotate().png().toBuffer({ resolveWithObject: true }); im = { buffer: data, width: info.width, height: info.height, name: `offer_${media.size + 1}.png` }; } catch { im = null; }
      media.set(dataUri, im);
    }
    return media.get(dataUri);
  };
  const place = (im, r, cols, heightPt) => {
    const boxW = cols.reduce((s, c) => s + PX(widths[c] || 10), 0) - 10, boxH = heightPt * 4 / 3 - 8;
    const k = Math.min(boxW / im.width, boxH / im.height, 1), w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
    sh.pictures.push({ im, col: colIdx(cols[0]), row: r - 1, offX: Math.round((boxW + 10 - w) / 2), offY: Math.round((heightPt * 4 / 3 - h) / 2), w, h });
  };

  // ---- body ----
  let r = MAP.rows.first_line;
  const descChars = ['B', 'C', 'D'].reduce((s, c) => s + (widths[c] || 10), 0) * 0.95;
  const descCharsPic = ['B', 'C'].reduce((s, c) => s + (widths[c] || 10), 0) * 0.95;
  const bannerChars = ['A', 'B', 'C', 'D'].reduce((s, c) => s + (widths[c] || 10), 0) * 0.85;
  const sectionTotals = [];   // net-row numbers of blocks that count in the grand total

  async function block(title, description, lines, { alternative, counted, image, footer }) {
    if (title) {
      const note = alternative && !counted ? 'Вариант — не се сумира с останалите варианти.' : '';
      const text = [title, description, note].filter(Boolean).join('\n');
      const im = await picture(image);
      const ht = Math.max(im ? H.section_banner : 0, textLines(text, bannerChars) * 14 + 8, 24);
      sh.row(r, ht, [str('A', S.section_banner.A, text), ...styled(S.section_banner, ['B', 'C', 'D', 'E', 'F', 'G', 'H'], (c, s) => blank(c, s))]);
      sh.merges.push(`A${r}:D${r}`);
      if (im) place(im, r, ['E', 'F', 'G', 'H'], ht);
      r++;
    }
    const first = r;
    for (const [i, l] of lines.entries()) {
      const im = await picture(l.image);
      const st = im ? S.line_with_picture : S.line;
      const ht = Math.max(im ? H.line_with_picture : H.line, textLines(l.description, im ? descCharsPic : descChars) * 13 + 10);
      const p = priceLine(l), q = Number(l.qty) || 0, price = Number(l.unit_price) || 0;
      const cells = [val('A', st.A, i + 1), str('B', st.B, l.description), blank('C', st.C), im ? blank('D', st.D) : blank('D', st.D), str('E', st.E, l.unit), val('F', st.F, q),
        internal && !p.manual ? fx('G', st.G, `ROUND(W${r},2)`, price) : val('G', st.G, price), fx('H', st.H, `F${r}*G${r}`, r2(q * price))];
      if (internal) cells.push(...calcCells(l, p, q, r, st));
      sh.row(r, ht, cells);
      sh.merges.push(im ? `B${r}:C${r}` : `B${r}:D${r}`);
      if (im) place(im, r, ['D'], ht);
      r++;
    }
    const last = r - 1, net = r2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0));
    const sum = c => lines.length ? `SUM(${c}${first}:${c}${last})` : '0';
    const T = S.total_net, fill = (st, cols) => styled(st, cols, (c, s) => blank(c, s));
    const netRow = r;
    const extra = internal ? ['K', 'N', 'Q', 'R', 'U'].map(c => fx(c, T[c] ?? T.K, sum(c), r2(lines.reduce((s, l) => s + calcValue(c, l), 0)))) : [];
    sh.row(r, H.total_net, [str('A', T.A, `Общо, € без ДДС:`), ...fill(T, ['B', 'C', 'D', 'E', 'F', 'G']), fx('H', T.H, sum('H'), net), ...extra]); sh.merges.push(`A${r}:G${r}`); r++;
    sh.row(r, H.total_vat, [str('A', S.total_vat.A, `ДДС ${vat}%:`), ...fill(S.total_vat, ['B', 'C', 'D', 'E', 'F', 'G']), fx('H', S.total_vat.H, `H${netRow}*${vatF}`, r2(net * vatF))]); sh.merges.push(`A${r}:G${r}`); r++;
    sh.row(r, H.total_vat, [str('A', S.total_gross.A, `Общо, € с ДДС:`), ...fill(S.total_gross, ['B', 'C', 'D', 'E', 'F', 'G']), fx('H', S.total_gross.H, `H${netRow}+H${netRow + 1}`, r2(net * (1 + vatF)))]); sh.merges.push(`A${r}:G${r}`); r++;
    if (counted) sectionTotals.push(netRow);
    if (footer) { sh.row(r, textLines(footer, descChars * 1.3) * 12.75 + 4, [str('A', S.clause.A, footer)]); sh.merges.push(`A${r}:H${r}`); r++; }
    r++; // a blank row between blocks
  }

  const countedIds = new Set(totals.sections.filter(s => !s.alternative || s.selected).map(s => s.section_id));
  for (const s of d.sections) await block(s.title, s.description, s.lines, { alternative: !!s.alternative, counted: countedIds.has(s.id), image: s.image, footer: s.footer });
  if (d.loose.length || !d.sections.length) await block(d.sections.length ? 'Други' : '', '', d.loose, { counted: true });

  // grand total: when there is more than one block to add up, or a discount
  const disc = Number(v.discount_pct) || 0, hasAlt = d.sections.some(s => s.alternative);
  if (sectionTotals.length > 1 || disc > 0 || (hasAlt && sectionTotals.length)) {
    const base = sectionTotals.length ? sectionTotals.map(n => `H${n}`).join('+') : '0';
    const T = S.total_net, fill = st => styled(st, ['B', 'C', 'D', 'E', 'F', 'G'], (c, s) => blank(c, s));
    if (disc > 0) { sh.row(r, H.total_net, [str('A', T.A, `Отстъпка ${disc}%:`), ...fill(T), fx('H', T.H, `-ROUND((${base})*${disc / 100},2)`, -r2(totals.gross - totals.net))]); sh.merges.push(`A${r}:G${r}`); r++; }
    const g = r;
    sh.row(r, H.total_net, [str('A', T.A, `Общо${hasAlt ? ' (без вариантите)' : ''}, € без ДДС:`), ...fill(T), fx('H', T.H, disc > 0 ? `${base}+H${r - 1}` : base, totals.net)]); sh.merges.push(`A${r}:G${r}`); r++;
    sh.row(r, H.total_vat, [str('A', S.total_vat.A, `ДДС ${vat}%:`), ...fill(S.total_vat), fx('H', S.total_vat.H, `H${g}*${vatF}`, totals.vat)]); sh.merges.push(`A${r}:G${r}`); r++;
    sh.row(r, H.total_vat, [str('A', S.total_gross.A, `Общо, € с ДДС:`), ...fill(S.total_gross), fx('H', S.total_gross.H, `H${g}+H${g + 1}`, totals.total_with_vat)]); sh.merges.push(`A${r}:G${r}`); r++;
    r++;
  }
  for (const [i, c] of d.clauses.entries()) {
    const t = `${i + 1}. ${c}`;
    sh.row(r, Math.max(H.clause, textLines(t, descChars * 1.25) * 12 + 3), [str('A', S.clause.A, t), ...['B', 'C', 'D', 'E', 'F', 'G', 'H'].map(c2 => blank(c2, S.clause.A))]);
    sh.merges.push(`A${r}:H${r}`); r++;
  }
  const lastRow = Math.max(r - 1, MAP.rows.column_header);

  // ---- write the sheet ----
  const lastCol = internal ? 'W' : 'H';
  const body = sh.rows.map(x => `<row r="${x.r}" ht="${Math.round(x.ht * 4) / 4}" customHeight="1">${x.cells.map(c => cellXml(c, x.r)).join('')}</row>`).join('');
  const headerMerges = [...sheet.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)]
    .filter(m => +m[4] < MAP.rows.first_line && (internal || colIdx(m[3]) <= 7)).map(m => `${m[1]}${m[2]}:${m[3]}${m[4]}`);
  const merges = [...headerMerges, ...sh.merges];
  sheet = sheet.slice(0, sheet.indexOf('<sheetData>')) + `<sheetData>${headXml}${body}</sheetData>` + sheet.slice(sheet.indexOf('</sheetData>') + 12);
  sheet = sheet.replace(/<mergeCells count="\d+">.*?<\/mergeCells>/s, `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastCol}${lastRow}"/>`)
    .replace(/<selection [^>]*\/>/, `<selection pane="bottomLeft" activeCell="A${MAP.rows.first_line}" sqref="A${MAP.rows.first_line}"/>`)
    .replace(/ xr:uid="\{[^}]*\}"/, '');
  if (!internal) {
    sheet = sheet.replace(/<cols>(.*?)<\/cols>/s, (_, cols) => `<cols>${[...cols.matchAll(/<col min="(\d+)" max="(\d+)"([^>]*)\/>/g)]
      .filter(m => +m[1] <= 8).map(m => `<col min="${m[1]}" max="${Math.min(8, +m[2])}"${m[3]}/>`).join('')}</cols>`);
  }

  // ---- pictures into the drawing ----
  if (sh.pictures.length) {
    const relsPath = 'xl/drawings/_rels/drawing1.xml.rels';
    let rels = await zip.file(relsPath).async('string'), drawing = await zip.file('xl/drawings/drawing1.xml').async('string');
    const ids = new Map();
    let nextId = 100;
    for (const im of media.values()) if (im) {
      const id = `rIdOffer${ids.size + 1}`; ids.set(im.name, id);
      zip.file(`xl/media/${im.name}`, im.buffer);
      rels = rels.replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${im.name}"/></Relationships>`);
    }
    const E = px => Math.round(px * 9525);
    const anchors = sh.pictures.map(p => `<xdr:oneCellAnchor><xdr:from><xdr:col>${p.col}</xdr:col><xdr:colOff>${E(p.offX)}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${E(p.offY)}</xdr:rowOff></xdr:from><xdr:ext cx="${E(p.w)}" cy="${E(p.h)}"/>`
      + `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${nextId++}" name="Picture ${nextId}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
      + `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${ids.get(p.im.name)}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
      + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${E(p.w)}" cy="${E(p.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('');
    drawing = drawing.replace('</xdr:wsDr>', `${anchors}</xdr:wsDr>`);
    zip.file(relsPath, rels); zip.file('xl/drawings/drawing1.xml', drawing);
  }
  zip.file('xl/worksheets/sheet1.xml', sheet);

  // ---- workbook: sheet name, print area, header row repeated; Труд only inside ----
  const name = internal ? MAP.sheets.offer : MAP.sheets.customer;
  let wb = await zip.file('xl/workbook.xml').async('string');
  wb = wb.replace(`name="${MAP.sheets.offer}"`, `name="${name}"`)
    .replace(/<definedNames>.*<\/definedNames>/s, `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">${name}!$A$1:$H$${lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">${name}!$${MAP.rows.column_header}:$${MAP.rows.column_header}</definedName></definedNames>`);
  if (internal) {
    zip.file('xl/worksheets/sheet2.xml', labourFill(await zip.file('xl/worksheets/sheet2.xml').async('string'), v.labour_calc));
  } else {
    wb = wb.replace(/<sheet name="[^"]*" sheetId="2" r:id="rId2"\/>/, '');
    zip.remove('xl/worksheets/sheet2.xml');
    const wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    zip.file('xl/_rels/workbook.xml.rels', wr.replace(/<Relationship Id="rId2" [^>]*\/>/, ''));
    const ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace(/<Override PartName="\/xl\/worksheets\/sheet2\.xml"[^>]*\/>/, ''));
  }
  zip.file('xl/workbook.xml', wb);

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, filename: `Oferta_${o.code}_v${v.version}${internal ? '_vatreshna' : ''}.xlsx` };
}

// ---- internal calculation columns I–W, the template's own formulas ----
function calcCells(l, p, q, r, st) {
  const hasInstall = l.install_cost !== null && l.install_cost !== undefined && l.install_cost !== '';
  const labour = hasInstall ? `${num(l.install_cost)}` : `(L${r}*M${r})`;
  const ov = Number(l.overhead_pct) / 100, pr = Number(l.profit_pct) / 100, tx = Number(l.tax_pct) / 100;
  return [
    val('I', st.I, l.material_cost), val('J', st.J, l.delivery_cost), fx('K', st.K, `J${r}*F${r}`, p.delivery_total),
    hasInstall ? blank('L', st.L) : val('L', st.L, l.labour_days), hasInstall ? blank('M', st.M) : val('M', st.M, l.day_rate),
    fx('N', st.N, `${labour}*F${r}`, p.labour_total), fx('O', st.O, `J${r}+I${r}+${labour}`, p.direct),
    fx('P', st.P, `O${r}*${num(ov)}`, p.overhead), fx('Q', st.Q, `P${r}*F${r}`, p.overhead_total), fx('R', st.R, `(O${r}*F${r})+Q${r}`, p.cost_total),
    val('S', st.S, pr), fx('T', st.T, `O${r}*S${r}`, p.profit), fx('U', st.U, `T${r}*F${r}`, p.profit_total),
    fx('V', st.V, `T${r}*${num(tx)}`, p.tax), fx('W', st.W, `V${r}+T${r}+O${r}+P${r}`, p.direct + p.overhead + p.profit + p.tax),
  ];
}
function calcValue(col, l) {
  const p = priceLine(l);
  return { K: p.delivery_total, N: p.labour_total, Q: p.overhead_total, R: p.cost_total, U: p.profit_total }[col] ?? 0;
}
