// Каталог с изображения: продуктови галерии (isport + офертния Excel), снимка към ред/раздел на оферта.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FILES_DIR } from './db.js';
import { HttpError, need, audit, record } from './core.js';
import { h } from './app.js';

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const mimeOf = f => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
const item = (db, ref) => /^\d+$/.test(String(ref))
  ? db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(Number(ref))
  : db.prepare('SELECT * FROM catalog_items WHERE slug = ?').get(String(ref));
const imagesOf = it => { try { return JSON.parse(it.images || '[]'); } catch { return []; } };
const view = it => it && { id: it.id, slug: it.slug, name: it.name, brand: it.brand, cat: it.cat, specs: it.specs ? JSON.parse(it.specs) : null,
  source: it.source, image_count: imagesOf(it).length, img_url: imagesOf(it).length ? `/api/catalog/items/${it.id}/img/0` : null };

export default function mountCatalog(app, db) {
  app.get('/api/catalog/items', h(req => {
    need(req.user, 'catalog');
    const q = String(req.query.q || '').trim();
    const cat = String(req.query.cat || '').trim(), brand = String(req.query.brand || '').trim();
    const like = '%' + q + '%';
    const rows = db.prepare(`SELECT * FROM catalog_items WHERE active = 1
      ${q ? 'AND (name LIKE ? OR brand LIKE ? OR cat LIKE ? OR slug LIKE ?)' : ''}
      ${cat ? 'AND cat = ?' : ''} ${brand ? 'AND brand = ?' : ''}
      ORDER BY source = 'excel' DESC, brand, name LIMIT 120`).all(
      ...(q ? [like, like, like, like] : []), ...(cat ? [cat] : []), ...(brand ? [brand] : []));
    return rows.map(view);
  }));

  app.get('/api/catalog/items/:ref', h(req => {
    need(req.user, 'catalog');
    const it = item(db, req.params.ref);
    if (!it) throw new HttpError(404, 'Няма такъв артикул');
    const images = imagesOf(it);
    return { ...view(it), images: images.map((_, i) => `/api/catalog/items/${it.id}/img/${i}`) };
  }));

  app.get('/api/catalog/items/:ref/img/:idx', h((req, res) => {
    need(req.user, 'catalog');
    const it = item(db, req.params.ref);
    const images = it ? imagesOf(it) : [];
    const stored = images[Number(req.params.idx)];
    if (!stored) throw new HttpError(404, 'Няма такава снимка');
    const file = path.join(FILES_DIR, stored);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Файлът липсва на диска');
    res.setHeader('Content-Type', mimeOf(stored));
    res.setHeader('Content-Length', fs.statSync(file).size);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(file).pipe(res);
  }));

  app.get('/api/catalog/facets', h(req => {
    need(req.user, 'catalog');
    return {
      cats: db.prepare("SELECT DISTINCT cat FROM catalog_items WHERE active = 1 AND cat IS NOT NULL ORDER BY cat").all().map(r => r.cat),
      brands: db.prepare("SELECT DISTINCT brand FROM catalog_items WHERE active = 1 AND brand IS NOT NULL ORDER BY brand").all().map(r => r.brand),
      sources: db.prepare("SELECT DISTINCT source FROM catalog_items WHERE active = 1").all().map(r => r.source) };
  }));

  /** Attach a catalogue image to an offer line/section: materializes a documents row (project_id NULL,
   *  entity catalog:<item>) pointing at the same stored file — idempotent per (item, image). */
  app.post('/api/catalog/items/:ref/attach', h(req => {
    need(req.user, 'offers', 'write');
    const it = item(db, req.params.ref);
    if (!it || !it.active) throw new HttpError(404, 'Няма такъв артикул');
    const images = imagesOf(it);
    const idx = Math.min(Math.max(0, Number(req.body?.img) || 0), images.length - 1);
    const stored = images[idx];
    if (!stored) throw new HttpError(404, 'Артикулът няма изображения');
    const file = path.join(FILES_DIR, stored);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Файлът липсва на диска');
    const existing = db.prepare(`SELECT d.id AS document_id, v.id AS version_id FROM document_versions v
      JOIN documents d ON d.id = v.document_id
      WHERE d.entity_type = 'catalog' AND d.entity_id = ? AND v.stored_name = ? ORDER BY v.version DESC LIMIT 1`).get(it.id, stored);
    if (existing) return { document_id: existing.document_id, version_id: existing.version_id, image_url: `/api/documents/${existing.version_id}/file`, reused: true };
    const buf = fs.readFileSync(file);
    const docId = Number(db.prepare("INSERT INTO documents(project_id, entity_type, entity_id, category, title, created_by) VALUES (NULL,'catalog',?,'catalog',?,?)")
      .run(it.id, it.name, req.user.id).lastInsertRowid);
    const verId = Number(db.prepare('INSERT INTO document_versions(document_id, version, filename, stored_name, mime, size, sha256, note, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(docId, 1, `${it.name}.${path.extname(stored).slice(1)}`, stored, mimeOf(stored), buf.length,
        crypto.createHash('sha256').update(buf).digest('hex'), `catalog:${it.slug}#${idx}`, req.user.id).lastInsertRowid);
    record(db, req.user, { type: 'catalog.attached', entity_type: 'catalog_item', entity_id: it.id, action: 'attach', after: { slug: it.slug, img: idx, document_id: docId }, module: 'offers' });
    return { document_id: docId, version_id: verId, image_url: `/api/documents/${verId}/file`, reused: false };
  }));
}
