// Оферти: inquiries, offers, versions/revisions, confirmation.
import { tx, nextCode } from './db.js';
import { HttpError, bad, need, audit, updateRow, reindex } from './core.js';
import { offerTotals, confirmOffer } from './domain.js';
import { h, pick, reqStr, num } from './app.js';

export default function mountOffers(app, db) {
  app.get('/api/inquiries', h(req => { need(req.user, 'offers');
    return db.prepare('SELECT i.*, c.name AS customer_name FROM inquiries i JOIN customers c ON c.id = i.customer_id ORDER BY i.id DESC').all(); }));
  app.post('/api/inquiries', h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const b = req.body || {}, code = nextCode(db, 'INQ');
    const id = Number(db.prepare('INSERT INTO inquiries(code, customer_id, title, site_address, description, received_on, owner_id) VALUES (?,?,?,?,?,?,?)')
      .run(code, num(b.customer_id, 'Клиент', { min: 1 }), reqStr(b.title, 'Заглавие'), b.site_address || null, b.description || null,
        b.received_on || new Date().toISOString().slice(0, 10), req.user.id).lastInsertRowid);
    audit(db, req.user, { entity_type: 'inquiry', entity_id: id, action: 'create', after: b, module: 'offers' });
    return { id, code };
  })));
  app.patch('/api/inquiries/:id', h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const id = Number(req.params.id), before = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
    if (!before) throw new HttpError(404, 'Запитването не е намерено');
    const f = pick(req.body || {}, ['title', 'site_address', 'description', 'status', 'received_on']);
    updateRow(db, 'inquiries', id, f, req.body?.row_version);
    audit(db, req.user, { entity_type: 'inquiry', entity_id: id, action: 'update', before, after: f, module: 'offers' });
    return { ok: true };
  })));

  const offerView = id => {
    const o = db.prepare('SELECT o.*, c.name AS customer_name, c.code AS customer_code, p.code AS project_code FROM offers o JOIN customers c ON c.id = o.customer_id LEFT JOIN projects p ON p.id = o.project_id WHERE o.id = ?').get(id);
    if (!o) throw new HttpError(404, 'Офертата не е намерена');
    o.questionnaire = JSON.parse(o.questionnaire || '{}');
    o.versions = db.prepare('SELECT v.*, u.full_name AS created_by_name FROM offer_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.offer_id = ? ORDER BY v.version').all(id)
      .map(v => ({ ...v, totals: offerTotals(db, v.id), lines: db.prepare('SELECT * FROM offer_lines WHERE version_id = ? ORDER BY sort, id').all(v.id) }));
    return o;
  };
  app.get('/api/offers', h(req => { need(req.user, 'offers'); return db.prepare(`SELECT o.*, c.name AS customer_name, p.code AS project_code,
    (SELECT COALESCE(SUM(l.qty * l.unit_price), 0) * (1 - v.discount_pct / 100.0) FROM offer_versions v LEFT JOIN offer_lines l ON l.version_id = v.id
      WHERE v.offer_id = o.id AND v.version = o.current_version) AS total
    FROM offers o JOIN customers c ON c.id = o.customer_id LEFT JOIN projects p ON p.id = o.project_id ORDER BY o.id DESC`).all(); }));
  app.get('/api/offers/:id', h(req => { need(req.user, 'offers'); return offerView(Number(req.params.id)); }));
  app.post('/api/offers', h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const b = req.body || {}, code = nextCode(db, 'OFR');
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(num(b.customer_id, 'Клиент', { min: 1 }))) throw bad('Няма такъв клиент');
    const id = Number(db.prepare('INSERT INTO offers(code, inquiry_id, customer_id, title, site_address, owner_id) VALUES (?,?,?,?,?,?)')
      .run(code, b.inquiry_id || null, Number(b.customer_id), reqStr(b.title, 'Заглавие'), b.site_address || null, req.user.id).lastInsertRowid);
    db.prepare('INSERT INTO offer_versions(offer_id, version, created_by) VALUES (?, 1, ?)').run(id, req.user.id);
    if (b.inquiry_id) db.prepare("UPDATE inquiries SET status = 'offered' WHERE id = ?").run(b.inquiry_id);
    reindex(db, 'offer', id, code, b.title, b.site_address || '');
    audit(db, req.user, { entity_type: 'offer', entity_id: id, action: 'create', after: b, module: 'offers' });
    return { id, code };
  })));

  /** Save header + current version. Sent/confirmed versions are locked: create a revision instead. */
  app.put('/api/offers/:id', h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const id = Number(req.params.id), b = req.body || {};
    const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Офертата не е намерена');
    const v = db.prepare('SELECT * FROM offer_versions WHERE offer_id = ? AND version = ?').get(id, o.current_version);
    const head = pick(b, ['title', 'site_address', 'readiness_note']);
    if (b.questionnaire) head.questionnaire = JSON.stringify(b.questionnaire);
    const touchesVersion = Array.isArray(b.lines) || ['valid_until', 'notes', 'execution_logic', 'prelim_days', 'discount_pct'].some(k => b[k] !== undefined);
    if (v.locked && touchesVersion) throw bad('Тази версия е заключена. Създайте нова ревизия.');
    updateRow(db, 'offers', id, { ...head, title: head.title ?? o.title }, b.row_version);
    const vf = pick(b, ['valid_until', 'notes', 'execution_logic', 'prelim_days']);
    if (b.discount_pct !== undefined) { vf.discount_pct = num(b.discount_pct, 'Отстъпка'); if (vf.discount_pct > 100) throw bad('Отстъпката не може да е над 100%'); }
    if (Object.keys(vf).length) db.prepare(`UPDATE offer_versions SET ${Object.keys(vf).map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(vf), v.id);
    if (Array.isArray(b.lines)) {
      const before = db.prepare('SELECT COUNT(*) AS n FROM offer_lines WHERE version_id = ?').get(v.id).n;
      db.prepare('DELETE FROM offer_lines WHERE version_id = ?').run(v.id);
      const ins = db.prepare('INSERT INTO offer_lines(version_id, sort, smr_type_id, product_id, code, description, unit, qty, unit_price, unit_cost, tech_note, planned_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      b.lines.forEach((l, i) => ins.run(v.id, i + 1, l.smr_type_id || null, l.product_id || null, l.code || null, reqStr(l.description, 'Описание'), reqStr(l.unit, 'Мярка'),
        num(l.qty, 'Количество', { min: 0.0001 }), num(l.unit_price, 'Ед. цена'), num(l.unit_cost ?? 0, 'Себестойност'), l.tech_note || null,
        l.planned_days ? Math.round(num(l.planned_days, 'Дни')) : null));
      audit(db, req.user, { entity_type: 'offer', entity_id: id, action: 'save_lines', before: { lines: before }, after: { version: v.version, lines: b.lines.length }, module: 'offers' });
    }
    const t = db.prepare('SELECT title, site_address FROM offers WHERE id = ?').get(id);
    reindex(db, 'offer', id, o.code, t.title, t.site_address || '');
    return offerView(id);
  })));

  /** Material requirement and cost of an offer version, from the recipes of its СМР lines. */
  app.get('/api/offers/:id/materials', h(req => {
    need(req.user, 'offers');
    const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    if (!o) throw new HttpError(404, 'Офертата не е намерена');
    const version = Number(req.query.version) || o.current_version;
    return db.prepare(`SELECT p.id AS product_id, p.code, p.name, p.unit, p.unit_cost, SUM(q.qty) AS qty, SUM(q.qty) * p.unit_cost AS cost FROM (
        SELECT r.product_id, l.qty * r.norm_per_unit * (1 + r.waste_pct / 100.0) AS qty FROM offer_lines l JOIN recipe_items r ON r.smr_type_id = l.smr_type_id
          JOIN offer_versions v ON v.id = l.version_id WHERE v.offer_id = ? AND v.version = ?
        UNION ALL SELECT l.product_id, l.qty FROM offer_lines l JOIN offer_versions v ON v.id = l.version_id
          WHERE v.offer_id = ? AND v.version = ? AND l.product_id IS NOT NULL AND l.smr_type_id IS NULL
      ) q JOIN products p ON p.id = q.product_id GROUP BY p.id ORDER BY p.code`).all(o.id, version, o.id, version);
  }));

  const transition = (name, fn) => app.post(`/api/offers/:id/${name}`, h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    if (!o) throw new HttpError(404, 'Офертата не е намерена');
    return fn(o, req);
  })));
  transition('send', (o, req) => {
    if (o.status === 'confirmed') throw bad('Офертата вече е потвърдена');
    if (!db.prepare('SELECT 1 FROM offer_lines l JOIN offer_versions v ON v.id = l.version_id WHERE v.offer_id = ? AND v.version = ?').get(o.id, o.current_version)) throw bad('Офертата няма редове');
    db.prepare("UPDATE offers SET status = 'sent', row_version = row_version + 1 WHERE id = ?").run(o.id);
    db.prepare("UPDATE offer_versions SET status = 'sent', locked = 1 WHERE offer_id = ? AND version = ?").run(o.id, o.current_version);
    audit(db, req.user, { entity_type: 'offer', entity_id: o.id, action: 'send', after: { version: o.current_version }, module: 'offers' });
    return offerView(o.id);
  });
  transition('revise', (o, req) => {
    if (o.status === 'confirmed') throw bad('Потвърдена оферта се променя само с анекс към договора');
    const prev = db.prepare('SELECT * FROM offer_versions WHERE offer_id = ? AND version = ?').get(o.id, o.current_version);
    db.prepare("UPDATE offer_versions SET locked = 1, status = CASE WHEN status = 'draft' THEN 'superseded' ELSE status END WHERE id = ?").run(prev.id);
    const nv = o.current_version + 1;
    const vid = Number(db.prepare('INSERT INTO offer_versions(offer_id, version, valid_until, discount_pct, notes, execution_logic, prelim_days, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(o.id, nv, prev.valid_until, prev.discount_pct, req.body?.reason || null, prev.execution_logic, prev.prelim_days, req.user.id).lastInsertRowid);
    db.prepare(`INSERT INTO offer_lines(version_id, sort, smr_type_id, product_id, code, description, unit, qty, unit_price, unit_cost, tech_note, planned_days)
      SELECT ?, sort, smr_type_id, product_id, code, description, unit, qty, unit_price, unit_cost, tech_note, planned_days FROM offer_lines WHERE version_id = ?`).run(vid, prev.id);
    db.prepare("UPDATE offers SET current_version = ?, status = 'draft', row_version = row_version + 1 WHERE id = ?").run(nv, o.id);
    audit(db, req.user, { entity_type: 'offer', entity_id: o.id, action: 'revise', before: { version: prev.version }, after: { version: nv, reason: req.body?.reason }, module: 'offers' });
    return offerView(o.id);
  });
  transition('reject', (o, req) => {
    if (o.status === 'confirmed') throw bad('Потвърдена оферта не може да бъде отказана');
    db.prepare("UPDATE offers SET status = 'rejected', row_version = row_version + 1 WHERE id = ?").run(o.id);
    audit(db, req.user, { entity_type: 'offer', entity_id: o.id, action: 'reject', after: { reason: req.body?.reason }, module: 'offers' });
    return offerView(o.id);
  });
  app.post('/api/offers/:id/confirm', h(req => { need(req.user, 'offers', 'write'); return confirmOffer(db, req.user, Number(req.params.id)); }));
}