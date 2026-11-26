// Оферти: inquiries, offers, versions/revisions, confirmation.
import { tx, nextCode } from './db.js';
import { HttpError, bad, need, audit, updateRow, reindex, setting } from './core.js';
import { offerTotals, confirmOffer } from './domain.js';
import { h, pick, reqStr, num } from './app.js';
import { priceLine } from './pricing.js';
import { cleanMaterials, parseMaterials } from './materials.js';

const BREAKDOWN = ['material_cost', 'delivery_cost', 'labour_days', 'day_rate', 'install_cost'];
const optNum = (v, label) => v === undefined || v === null || v === '' ? null : num(v, label);

export default function mountOffers(app, db) {
  app.get('/api/offer-templates', h(req => { need(req.user, 'offers');
    return db.prepare('SELECT * FROM offer_templates WHERE active = 1 ORDER BY family, code').all().map(t => ({ ...t, lines: JSON.parse(t.lines) })); }));
  app.put('/api/offer-templates/:id', h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const id = Number(req.params.id), before = db.prepare('SELECT * FROM offer_templates WHERE id = ?').get(id);
    if (!before) throw new HttpError(404, 'Няма такъв шаблон');
    const b = req.body || {}, f = pick(b, ['family', 'title', 'description', 'footer']);
    if (b.alternative !== undefined) f.alternative = b.alternative ? 1 : 0;
    if (b.active !== undefined) f.active = b.active ? 1 : 0;
    if (Array.isArray(b.lines)) f.lines = JSON.stringify(b.lines.map(l => ({ ...l, description: reqStr(l.description, 'Описание'), unit: reqStr(l.unit, 'Мярка') })));
    updateRow(db, 'offer_templates', id, f, b.row_version);
    audit(db, req.user, { entity_type: 'offer_template', entity_id: id, action: 'update', before, after: f, module: 'offers' });
    return { ok: true };
  })));
  /** Save the current section of an offer as a new reusable template. */
  app.post('/api/offer-templates', h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const b = req.body || {};
    db.prepare("INSERT INTO counters(name, value) VALUES ('TPL', (SELECT COUNT(*) FROM offer_templates)) ON CONFLICT(name) DO NOTHING").run();
    db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'TPL'").run();
    const code = 'T' + String(db.prepare("SELECT value FROM counters WHERE name = 'TPL'").get().value).padStart(3, '0');
    const lines = (b.lines || []).map(l => ({ ...l, description: reqStr(l.description, 'Описание'), unit: reqStr(l.unit, 'Мярка') }));
    const id = Number(db.prepare('INSERT INTO offer_templates(code, family, title, description, footer, alternative, lines) VALUES (?,?,?,?,?,?,?)')
      .run(code, reqStr(b.family || 'Други', 'Група'), reqStr(b.title, 'Заглавие'), b.description || null, b.footer || null, b.alternative ? 1 : 0, JSON.stringify(lines)).lastInsertRowid);
    audit(db, req.user, { entity_type: 'offer_template', entity_id: id, action: 'create', after: { code, title: b.title }, module: 'offers' });
    return { id, code };
  })));

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
    const imgUrls = ids => {
      const m = new Map();
      if (!ids.length) return m;
      const ph = ids.map(() => '?').join(',');
      for (const r of db.prepare(`SELECT d.id AS doc_id, v.id AS vid FROM documents d
        JOIN document_versions v ON v.document_id = d.id AND v.version = (SELECT MAX(version) FROM document_versions WHERE document_id = d.id)
        WHERE d.id IN (${ph})`).all(...ids)) m.set(r.doc_id, `/api/documents/${r.vid}/file`);
      return m;
    };
    o.versions = db.prepare('SELECT v.*, u.full_name AS created_by_name FROM offer_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.offer_id = ? ORDER BY v.version').all(id)
      .map(v => {
        const sections = db.prepare('SELECT * FROM offer_sections WHERE version_id = ? ORDER BY sort, id').all(v.id);
        const lines = db.prepare('SELECT * FROM offer_lines WHERE version_id = ? ORDER BY sort, id').all(v.id).map(l => ({ ...l, materials: parseMaterials(l.materials), calc: priceLine(l) }));
        const urls = imgUrls([...sections, ...lines].map(x => x.image_document_id).filter(Boolean));
        const withImg = x => x.image_document_id && urls.has(x.image_document_id) ? { ...x, image_url: urls.get(x.image_document_id) } : x;
        return { ...v, labour_calc: v.labour_calc ? JSON.parse(v.labour_calc) : null, totals: offerTotals(db, v.id), sections: sections.map(withImg), lines: lines.map(withImg) };
      });
    o.owner = o.owner_id ? db.prepare('SELECT id, full_name, phone, offer_letter, office FROM users WHERE id = ?').get(o.owner_id) : null;
    return o;
  };
  app.get('/api/offers', h(req => { need(req.user, 'offers'); return db.prepare(`SELECT o.*, c.name AS customer_name, p.code AS project_code,
    (SELECT COALESCE(SUM(l.qty * l.unit_price), 0) * (1 - v.discount_pct / 100.0) FROM offer_versions v LEFT JOIN offer_lines l ON l.version_id = v.id
      WHERE v.offer_id = o.id AND v.version = o.current_version) AS total
    FROM offers o JOIN customers c ON c.id = o.customer_id LEFT JOIN projects p ON p.id = o.project_id ORDER BY o.id DESC`).all(); }));
  app.get('/api/offers/:id', h(req => { need(req.user, 'offers'); return offerView(Number(req.params.id)); }));
  app.post('/api/offers', h(req => tx(db, () => {
    need(req.user, 'offers', 'write');
    const b = req.body || {};
    // company rule from the Excel template: running offer number + the preparer's letter, e.g. "39G"
    const letter = db.prepare('SELECT offer_letter FROM users WHERE id = ?').get(req.user.id)?.offer_letter || '';
    db.prepare("INSERT INTO counters(name, value) VALUES ('OFFER', 0) ON CONFLICT(name) DO NOTHING").run();
    db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'OFFER'").run();
    const code = `${db.prepare("SELECT value FROM counters WHERE name = 'OFFER'").get().value}${letter}`;
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(num(b.customer_id, 'Клиент', { min: 1 }))) throw bad('Няма такъв клиент');
    const id = Number(db.prepare('INSERT INTO offers(code, inquiry_id, customer_id, title, site_address, owner_id) VALUES (?,?,?,?,?,?)')
      .run(code, b.inquiry_id || null, Number(b.customer_id), reqStr(b.title, 'Заглавие'), b.site_address || null, req.user.id).lastInsertRowid);
    db.prepare('INSERT INTO offer_versions(offer_id, version, created_by, attention_to, offer_date, validity_months) VALUES (?, 1, ?, ?, ?, ?)')
      .run(id, req.user.id, b.attention_to || null, new Date().toISOString().slice(0, 10), Math.max(1, Math.round(Number(b.validity_months) || 1)));
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
    const touchesVersion = Array.isArray(b.lines) || Array.isArray(b.sections) || b.labour_calc !== undefined || ['notes', 'execution_logic', 'prelim_days', 'discount_pct', 'attention_to', 'offer_date', 'validity_months'].some(k => b[k] !== undefined);
    if (v.locked && touchesVersion) throw bad('Тази версия е заключена. Създайте нова ревизия.');
    updateRow(db, 'offers', id, { ...head, title: head.title ?? o.title }, b.row_version);
    const vf = pick(b, ['notes', 'execution_logic', 'prelim_days', 'attention_to', 'offer_date']);
    if (b.labour_calc !== undefined) vf.labour_calc = b.labour_calc ? JSON.stringify(b.labour_calc) : null;
    if (b.validity_months !== undefined) vf.validity_months = Math.round(num(b.validity_months, 'Валидност (месеци)', { min: 1 }));
    if (b.discount_pct !== undefined) { vf.discount_pct = num(b.discount_pct, 'Отстъпка'); if (vf.discount_pct > 100) throw bad('Отстъпката не може да е над 100%'); }
    if (Object.keys(vf).length) db.prepare(`UPDATE offer_versions SET ${Object.keys(vf).map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(vf), v.id);
    if (Array.isArray(b.lines)) {
      const before = db.prepare('SELECT COUNT(*) AS n FROM offer_lines WHERE version_id = ?').get(v.id).n;
      db.prepare('DELETE FROM offer_lines WHERE version_id = ?').run(v.id);
      // sections are replaced together with the lines; a line points to its section by position (section_index) or by a client key
      const sectionIds = new Map();
      if (Array.isArray(b.sections)) {
        db.prepare('DELETE FROM offer_sections WHERE version_id = ?').run(v.id);
        const insS = db.prepare('INSERT INTO offer_sections(version_id, sort, title, description, footer, alternative, image_document_id) VALUES (?,?,?,?,?,?,?)');
        b.sections.forEach((s, i) => sectionIds.set(String(s.key ?? s.id ?? i), Number(insS.run(v.id, i + 1, reqStr(s.title, 'Заглавие на раздел'), s.description || null, s.footer || null, s.alternative ? 1 : 0, s.image_document_id || null).lastInsertRowid)));
      } else for (const s of db.prepare('SELECT id FROM offer_sections WHERE version_id = ?').all(v.id)) sectionIds.set(String(s.id), s.id);
      const ins = db.prepare(`INSERT INTO offer_lines(version_id, sort, section_id, smr_type_id, product_id, code, description, unit, qty, unit_price, unit_cost, tech_note, planned_days,
        material_cost, delivery_cost, labour_days, day_rate, install_cost, overhead_pct, profit_pct, tax_pct, manual_price, image_document_id, materials) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      b.lines.forEach((l, i) => {
        const sec = l.section === undefined || l.section === null || l.section === '' ? null : sectionIds.get(String(l.section));
        if (l.section !== undefined && l.section !== null && l.section !== '' && !sec) throw bad(`Ред ${i + 1}: няма такъв раздел`);
        const hasBreakdown = BREAKDOWN.some(k => l[k] !== undefined && l[k] !== null && l[k] !== '' && Number(l[k]) !== 0);
        const row = { qty: num(l.qty, 'Количество', { min: 0 }), material_cost: optNum(l.material_cost, 'Материал') ?? 0, delivery_cost: optNum(l.delivery_cost, 'Доставка') ?? 0,
          labour_days: optNum(l.labour_days, 'Надници') ?? 0, day_rate: optNum(l.day_rate, 'Стойност на надник') ?? 0, install_cost: optNum(l.install_cost, 'Монтаж'),
          overhead_pct: optNum(l.overhead_pct, 'Режийни %') ?? Number(setting(db, 'overhead_pct', '3.5')), profit_pct: optNum(l.profit_pct, 'Печалба %') ?? Number(setting(db, 'profit_pct', '30')),
          tax_pct: optNum(l.tax_pct, 'Корпоративен данък %') ?? Number(setting(db, 'corporate_tax_pct', '10')),
          // a line without a cost breakdown is a plain priced line: the typed unit price is kept as a manual price
          manual_price: optNum(l.manual_price, 'Ед. цена') ?? (hasBreakdown ? null : num(l.unit_price ?? 0, 'Ед. цена')) };
        const c = priceLine(row);
        const unitCost = hasBreakdown ? c.unit_cost : num(l.unit_cost ?? 0, 'Себестойност');
        ins.run(v.id, i + 1, sec, l.smr_type_id || null, l.product_id || null, l.code || null, reqStr(l.description, 'Описание'), reqStr(l.unit, 'Мярка'), row.qty, c.unit_price, unitCost,
          l.tech_note || null, l.planned_days ? Math.round(num(l.planned_days, 'Дни')) : null, row.material_cost, row.delivery_cost, row.labour_days, row.day_rate, row.install_cost,
          row.overhead_pct, row.profit_pct, row.tax_pct, row.manual_price, l.image_document_id || null, JSON.stringify(cleanMaterials(db, l.materials, `Ред ${i + 1}: `)));
      });
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
    db.prepare('UPDATE offer_versions SET attention_to = ?, offer_date = ?, validity_months = ?, labour_calc = ? WHERE id = ?').run(prev.attention_to, new Date().toISOString().slice(0, 10), prev.validity_months, prev.labour_calc, vid);
    const secMap = new Map();
    for (const s of db.prepare('SELECT * FROM offer_sections WHERE version_id = ? ORDER BY sort, id').all(prev.id))
      secMap.set(s.id, Number(db.prepare('INSERT INTO offer_sections(version_id, sort, title, description, footer, alternative, image_document_id) VALUES (?,?,?,?,?,?,?)')
        .run(vid, s.sort, s.title, s.description, s.footer, s.alternative, s.image_document_id).lastInsertRowid));
    const cols = 'sort, smr_type_id, product_id, code, description, unit, qty, unit_price, unit_cost, tech_note, planned_days, material_cost, delivery_cost, labour_days, day_rate, install_cost, overhead_pct, profit_pct, tax_pct, manual_price, image_document_id, materials';
    for (const l of db.prepare(`SELECT section_id, ${cols} FROM offer_lines WHERE version_id = ? ORDER BY sort, id`).all(prev.id)) {
      const { section_id, ...rest } = l;
      db.prepare(`INSERT INTO offer_lines(version_id, section_id, ${cols}) VALUES (?,?,${Object.keys(rest).map(() => '?').join(',')})`).run(vid, section_id ? secMap.get(section_id) : null, ...Object.values(rest));
    }
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
  app.post('/api/offers/:id/confirm', h(req => { need(req.user, 'offers', 'write'); return confirmOffer(db, req.user, Number(req.params.id), req.body?.sections); }));
}