// One-off catalogue import: isport product catalogue (crawl/catalog.norm.json + images.map.json + img/p/)
// and the offer Excel's embedded product images (tools/catalog-import/excel-items.json + excel-img/).
// Images are copied into DATA_DIR/files as cat-*; catalog_items rows are upserted by slug (idempotent).
// File copying runs BEFORE the DB transaction so the live app's write lock is not held during ~5k copies.
// Run: node tools/import_catalog.mjs [--isport-dir C:\lab\isport]
import fs from 'node:fs';
import path from 'node:path';
import { openDb, DATA_DIR, FILES_DIR } from '../server/db.js';

const ISPORT = process.argv.includes('--isport-dir') ? process.argv[process.argv.indexOf('--isport-dir') + 1] : 'C:\\lab\\isport';
const STAGE = path.resolve(import.meta.dirname, 'catalog-import');

const db = openDb(path.join(DATA_DIR, 'synchro.db'));
fs.mkdirSync(FILES_DIR, { recursive: true });

const upsert = db.prepare(`INSERT INTO catalog_items(slug, name, brand, cat, specs, images, source) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(slug) DO UPDATE SET name=excluded.name, brand=excluded.brand, cat=excluded.cat, specs=excluded.specs, images=excluded.images, source=excluded.source, active=1`);

let copied = 0, skipped = 0;
const copyIn = (src, stored) => {
  const dst = path.join(FILES_DIR, stored);
  if (fs.existsSync(dst)) { skipped++; return stored; }
  fs.copyFileSync(src, dst); copied++; return stored;
};

// ---- pass 1: copy image files and build rows (no transaction — file I/O must not hold the write lock)
const cat = JSON.parse(fs.readFileSync(path.join(ISPORT, 'crawl', 'catalog.norm.json'), 'utf8'));
const imgMap = JSON.parse(fs.readFileSync(path.join(ISPORT, 'crawl', 'images.map.json'), 'utf8'));
const rows = [];
for (const p of cat) {
  const images = [];
  for (const rel of imgMap[p.id] || []) {
    const src = path.join(ISPORT, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(src)) continue;
    images.push(copyIn(src, 'cat-' + path.basename(rel).replace(/\s+/g, '_')));
  }
  rows.push([p.id, p.n || p.id, p.brand || null, p.cat || null, p.specs ? JSON.stringify(p.specs) : null, JSON.stringify(images), 'isport']);
}
const xitems = JSON.parse(fs.readFileSync(path.join(STAGE, 'excel-items.json'), 'utf8'));
for (const it of xitems) {
  const images = [];
  for (const f of it.images || []) {
    const src = path.join(STAGE, 'excel-img', f);
    if (fs.existsSync(src)) images.push(copyIn(src, f));
  }
  rows.push([it.slug, it.name, null, it.cat, null, JSON.stringify(images), 'excel']);
}

// ---- pass 2: upsert rows in one short transaction
db.exec('BEGIN');
try {
  for (const r of rows) upsert.run(...r);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

// ---- prefer real isport product photos over the Excel's shared banner strip (cat-image5.jpeg)
// where a confident system-name match exists. Applied AFTER upsert so re-runs stay consistent.
// No match -> the Excel image stays (InfraSPORT 1CS/2CS/Insito, MultiPLAY/InfraSPORT 1Е have no isport photos).
const IMG_REMAP = {
  'xls-play-r9-63a9b': 'multiplay-2e',            // MultiPLAY 2Е   -> MultiPLAY 2E
  'xls-play-r27-5d35d': 'multiplay-1cs',          // MultiPLAY 1CS  -> InfraPLAY 1CS
  'xls-play-r36-f366d': 'multiplay-2cs',          // MultiPLAY 2CS  -> InfraPLAY 2CS
  'xls-sport-r9-93d35': 'infrasport-2e',          // InfraSPORT 2Е  -> InfraSPORT 2E
  'xls-sport-r41-684f0': 'infrasport-pu-top-coat',// InfraSPORT PU Top coat -> InfraSPORT PU Top Coat
};
let remapped = 0;
for (const [xslug, islug] of Object.entries(IMG_REMAP)) {
  const src = db.prepare('SELECT images FROM catalog_items WHERE slug = ?').get(islug);
  if (src && JSON.parse(src.images).length) { db.prepare('UPDATE catalog_items SET images = ? WHERE slug = ?').run(src.images, xslug); remapped++; }
}

// ---- offer_templates -> catalog image (the Excel's own system photos)
// (template code, catalog cat, row) — rows verified against the workbook's product blocks
const TPL = {
  T001: ['Equipment', 17],
  T002: ['Play', 9], T003: ['Play', 18], T004: ['Play', 27], T005: ['Play', 36], T006: ['Play', 45], T007: ['Play', 53],
  T008: ['Sport', 9], T009: ['Sport', 17], T010: ['Sport', 25], T011: ['Sport', 33], T012: ['Sport', 41], T013: ['Sport', 49], T014: ['Sport', 56],
  T015: ['Padel', 9], T016: ['Padel', 20], T017: ['Padel', 31], T018: ['Padel', 42],
  T019: ['SBR Tiles', 9], T020: ['SBR Tiles', 18],
  T021: ['GreenSet', 9], T022: ['GreenSet', 19], T023: ['Grass', 9],
};
// rows are embedded in the slug as -r<row>-<hash>
const tplUpd = db.prepare('UPDATE offer_templates SET catalog_slug=? WHERE code=?');
let mapped = 0; const unmapped = [];
for (const [code, [catName, row]] of Object.entries(TPL)) {
  const slug = db.prepare("SELECT slug FROM catalog_items WHERE source='excel' AND cat=?").all(catName)
    .map(r => r.slug).find(s => s.includes(`-r${row}-`));
  if (slug) { tplUpd.run(slug, code); mapped++; } else unmapped.push(`${code}:${catName}#${row}`);
}

console.log(`catalog_items upserted: ${rows.length} rows (isport ${cat.length} src + excel ${xitems.length})`);
console.log(`images: ${copied} copied, ${skipped} already present`);
console.log(`offer_templates mapped: ${mapped}/23`, unmapped.length ? 'UNMAPPED: ' + unmapped.join(', ') : '');
console.log(`excel items remapped to isport photos: ${remapped}/${Object.keys(IMG_REMAP).length}`);
db.close();
