// Шаблонът на офертата е файлът на фирмата, изчистен: два листа, без външни връзки, коментари и грешки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import JSZip from 'jszip';

const FILE = new URL('../server/assets/offer_template.xlsx', import.meta.url);
const MAP = new URL('../server/assets/offer_template.map.json', import.meta.url);

test('clean offer template: two sheets, nothing foreign, footer and logo kept, map points at real styles', async () => {
  assert.ok(statSync(FILE).size < 2 * 1024 * 1024, 'under 2 MB');
  const zip = await JSZip.loadAsync(readFileSync(FILE));
  const names = Object.keys(zip.files);
  const wb = await zip.file('xl/workbook.xml').async('string');
  assert.deepEqual([...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1]), ['КСС', 'Труд']);
  for (const bad of [/externalLink/, /comments/, /calcChain/, /printerSettings/])
    assert.ok(!names.some(n => bad.test(n)), `no ${bad} part`);
  assert.ok(!/externalReference/.test(wb), 'no link to other workbooks');
  for (const n of names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    const s = await zip.file(n).async('string');
    assert.ok(!/#REF!/.test(s), `${n}: no #REF!`);
    assert.ok(!/ t="e"/.test(s), `${n}: no cell holding an error`);
    for (const m of s.matchAll(/r:id="([^"]+)"/g)) {
      const rels = await zip.file(n.replace('worksheets/', 'worksheets/_rels/') + '.rels')?.async('string');
      assert.ok(rels && rels.includes(`Id="${m[1]}"`), `${n}: ${m[1]} resolves`);
    }
  }
  const kss = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(kss, /<legacyDrawingHF r:id=/, 'page footer kept');
  assert.match(kss, /<drawing r:id=/, 'logo kept');
  assert.ok(!/<legacyDrawing r:id=/.test(kss), 'comment boxes gone');
  assert.match(kss, /<f>SUM\(U10:U21\)<\/f>/, 'one-row total covers every line');
  const vml = await zip.file('xl/drawings/vmlDrawing1.vml').async('string');
  assert.match(vml, /o:title="Footer 2026"/);
  const ct = await zip.file('[Content_Types].xml').async('string');
  for (const m of ct.matchAll(/PartName="\/([^"]+)"/g)) assert.ok(zip.file(m[1]), `content type for missing part ${m[1]}`);
  for (const n of names.filter(n => n.endsWith('.rels'))) {
    const base = n.replace(/_rels\/[^/]*\.rels$/, '');
    for (const m of (await zip.file(n).async('string')).matchAll(/Target="([^"]+)"/g)) {
      const p = new URL(m[1], 'file:///' + base).pathname.slice(1);
      assert.ok(zip.file(p), `${n} → ${p} exists`);
    }
  }

  const map = JSON.parse(readFileSync(MAP, 'utf8'));
  const styles = await zip.file('xl/styles.xml').async('string');
  const xfCount = Number(styles.match(/<cellXfs count="(\d+)"/)[1]);
  const ids = [];
  (function walk(o) { for (const [k, v] of Object.entries(o)) { if (k === 'height' || k === 'heights') continue; if (typeof v === 'number' && /^[A-Z]{1,2}\d*$/.test(k)) ids.push(v); else if (v && typeof v === 'object') walk(v); } })(map.styles);
  assert.ok(ids.length > 40, 'map names the styles');
  for (const id of ids) assert.ok(Number.isInteger(id) && id >= 0 && id < xfCount, `style ${id} exists`);
  assert.deepEqual([map.sheets.offer, map.sheets.customer, map.sheets.labour], ['КСС', 'Оферта', 'Труд']);
});
