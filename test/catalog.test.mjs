// Каталог с изображения: търсене, стрийм, прикачване към оферта (идемпотентно), права, печат.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { start, seedOffer } from './helpers.mjs';
import { FILES_DIR } from '../server/db.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TEST_IMG = 'cat-test-1.png';

function seedCatalogItem(t) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILES_DIR, TEST_IMG), PNG);
  t.db.prepare("INSERT INTO catalog_items(slug, name, brand, cat, specs, images, source, active) VALUES (?,?,?,?,?,?,?,1)")
    .run('test-turf', 'Тест настилка Pro', 'TestBrand', ' настилки ', '{"thickness":"8mm"}', JSON.stringify([TEST_IMG]), 'excel');
  return t.db.prepare("SELECT * FROM catalog_items WHERE slug = 'test-turf'").get();
}

test('catalog: search, image stream, attach idempotent, permission gates', async () => {
  const t = await start();
  const imgPath = path.join(FILES_DIR, TEST_IMG);
  try {
    const it = seedCatalogItem(t);
    const list = (await t.admin.get('/api/catalog/items?q=' + encodeURIComponent('настилка'))).data;
    const hit = list.find(x => x.slug === 'test-turf');
    assert.ok(hit, 'search finds the item');
    assert.equal(hit.image_count, 1);
    assert.match(hit.img_url, /\/api\/catalog\/items\/\d+\/img\/0/);
    assert.equal((await t.admin.get('/api/catalog/items?q=няма-такова-xyz')).data.length, 0, 'no-match query is empty');

    const detail = (await t.admin.get(`/api/catalog/items/${it.id}`)).data;
    assert.equal(detail.images.length, 1);
    assert.equal((await t.admin.get(`/api/catalog/items/${it.id}/img/0`)).status, 200, 'image streams');
    assert.equal((await t.admin.get(`/api/catalog/items/${it.id}/img/9`)).status, 404, 'bad index 404');

    const anon = t.client();
    assert.equal((await anon.get('/api/catalog/items')).status, 401, 'anonymous cannot browse');
    const acct = await t.mkUser('acct1', 'accounting');
    assert.equal((await acct.get('/api/catalog/items')).status, 200, 'accounting reads catalog');
    assert.equal((await acct.post(`/api/catalog/items/${it.id}/attach`, { img: 0 })).status, 403, 'no offers-write -> cannot attach');

    const a1 = (await t.admin.post(`/api/catalog/items/${it.id}/attach`, { img: 0 })).data;
    assert.ok(a1.document_id > 0);
    assert.match(a1.image_url, /\/api\/documents\/\d+\/file/);
    const a2 = (await t.admin.post('/api/catalog/items/test-turf/attach', { img: 0 })).data;
    assert.equal(a2.document_id, a1.document_id, 'attach by slug reuses the same document');
    assert.equal(a2.reused, true, 'second attach is idempotent');
    assert.equal((await acct.get(a1.image_url)).status, 200, 'attached image serves through documents route');
    const doc = t.db.prepare('SELECT * FROM documents WHERE id = ?').get(a1.document_id);
    assert.equal(doc.entity_type, 'catalog');
    assert.equal(doc.project_id, null);
  } finally {
    try { fs.rmSync(imgPath, { force: true }); } catch {}
    await t.stop();
  }
});

test('offer: image_document_id round-trips and print renders fitted image', async () => {
  const t = await start();
  const imgPath = path.join(FILES_DIR, TEST_IMG);
  try {
    seedCatalogItem(t);
    const s = await seedOffer(t);
    const att = (await t.admin.post('/api/catalog/items/test-turf/attach', { img: 0 })).data;

    const offer = (await t.admin.get(`/api/offers/${s.offer.id}`)).data;
    const v = offer.versions.find(x => x.version === offer.current_version);
    const lines = v.lines.map(l => ({ ...l, section: l.section_id ? String(l.section_id) : '' }));
    lines[0].image_document_id = att.document_id;
    const put = await t.admin.put(`/api/offers/${s.offer.id}`, { lines });
    assert.equal(put.status, 200, 'PUT with image_document_id accepted');

    const after = (await t.admin.get(`/api/offers/${s.offer.id}`)).data;
    const lv = after.versions.find(x => x.version === after.current_version);
    const l0 = lv.lines.find(l => l.sort === 1);
    assert.equal(l0.image_document_id, att.document_id, 'image id persisted');
    assert.match(l0.image_url, /\/api\/documents\/\d+\/file/, 'image_url resolved');

    const login = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const pr = await fetch(`${t.base}/api/offers/${s.offer.id}/print`, { headers: { cookie } });
    const html = await pr.text();
    assert.equal(pr.status, 200);
    assert.ok(html.includes('class="pimg"'), 'print renders the fitted image box');
    assert.ok(html.includes('data:image/png;base64,'), 'image embedded as data URI');

    const ex = await fetch(`${t.base}/api/offers/${s.offer.id}/export.xlsx`, { headers: { cookie } });
    assert.equal(ex.status, 200);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(Buffer.from(await ex.arrayBuffer()));
    const imgs = wb2.getWorksheet('Оферта').getImages();
    assert.ok(imgs.length >= 2, `xlsx embeds logo + offer image (got ${imgs.length})`);
  } finally {
    try { fs.rmSync(imgPath, { force: true }); } catch {}
    await t.stop();
  }
});
