// Склад: непокътнат складов регистър (stock_movements), материални заявки → резерв → изписване,
// и заявка-помощник, който сравнява потребността от КС/рецепти с наличното и резервираното.
import crypto from 'node:crypto';
import { need, can, canSeeProject, needProject, scopeRows, hideForeignProject, audit, emit, HttpError, bad, setting as getSetting } from './core.js';
import { h, num } from './app.js';
import { tx, nextCode } from './db.js';
import { stock, consumption } from './calc.js';

const KINDS = ['receipt', 'issue', 'return', 'adjust', 'transfer_out'];
const signedQty = (v, label) => { const n = Number(v); if (!Number.isFinite(n) || n === 0) throw bad(`Невалидно количество за „${label}“`); return n; };

/** Issue an approved request to its project: one write path, used by the warehouse and by a delivered delivery. */
export function fulfilRequest(db, user, id) {
  const m = db.prepare('SELECT * FROM material_requests WHERE id = ?').get(id);
  if (!m) throw new HttpError(404, 'Няма такава заявка');
  if (m.status !== 'approved') throw bad('Заявката трябва първо да бъде одобрена');
  const items = db.prepare('SELECT i.*, p.unit_cost FROM request_items i JOIN products p ON p.id = i.product_id WHERE i.request_id = ?').all(id);
  const ins = db.prepare(`INSERT INTO stock_movements(uid, product_id, kind, qty, project_id, project_line_id, request_id, unit_cost, responsible_id) VALUES (?,?,'issue',?,?,?,?,?,?)`);
  const rel = db.prepare(`UPDATE reservations SET status = 'fulfilled' WHERE request_item_id = ? AND status = 'active'`);
  for (const it of items) { ins.run(crypto.randomUUID(), it.product_id, it.qty, m.project_id, it.project_line_id ?? null, id, it.unit_cost, user.id); rel.run(it.id); }
  db.prepare("UPDATE material_requests SET status = 'fulfilled' WHERE id = ?").run(id);
  audit(db, user, { project_id: m.project_id, entity_type: 'material_request', entity_id: id, action: 'fulfil', after: { items: items.length }, module: 'warehouse' });
  emit(db, user, { type: 'material_request.fulfilled', origin: 'warehouse', project_id: m.project_id, entity_type: 'material_request', entity_id: id,
    dedupe_key: `mrqf:${id}`, next: { code: m.code, requester_id: m.requested_by }, affected: ['warehouse', 'logistics'] });
  return m;
}

export default function mountWarehouse(app, db) {
  const needWh = (req, a = 'read') => need(req.user, 'warehouse', a);
  const prod = id => db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  const project = id => id == null ? null : db.prepare('SELECT id, code FROM projects WHERE id = ?').get(id);

  /** One write path for requests — the warehouse page and the module entry points
   *  (Technical/Contracts file them from the project) both land here. */
  const createRequest = (req, pid, { items, origin, needed_by, note }) => {
    const code = nextCode(db, 'MRQ');
    const id = Number(db.prepare(`INSERT INTO material_requests(code, project_id, origin, needed_by, status, note, requested_by, needs_approval)
      VALUES (?,?,?,?, 'submitted', ?,?,1)`).run(code, pid, origin, needed_by || null, note || null, req.user.id).lastInsertRowid);
    const ins = db.prepare('INSERT INTO request_items(request_id, product_id, qty, project_line_id, outside_contract, reason) VALUES (?,?,?,?,?,?)');
    const lineOf = db.prepare('SELECT project_id FROM project_lines WHERE id = ?');
    // a material is "in the КС" when a line of this project needs it (its recipe); anything else is outside the contract
    const inKs = new Set(db.prepare(`SELECT DISTINCT r.product_id FROM project_line_recipe r JOIN project_lines l ON l.id = r.project_line_id WHERE l.project_id = ? AND l.removed = 0`).all(pid).map(x => x.product_id));
    for (const it of items) {
      const p = prod(Number(it.product_id));
      if (!p) throw bad('Невалиден продукт в заявката');
      const lid = it.project_line_id == null ? null : Number(it.project_line_id);
      if (lid != null) {
        const ln = lineOf.get(lid);
        if (!ln || ln.project_id !== pid) throw bad('КС редът не е от този обект');
      }
      const outside = inKs.has(p.id) ? 0 : 1;
      if (outside && !String(it.reason || '').trim()) throw bad(`„${p.name}“ не е по КС на обекта — напишете причината`);
      ins.run(id, p.id, num(it.qty, 'Количество', { min: 0.000001 }), lid, outside, outside ? String(it.reason).trim() : null);
    }
    audit(db, req.user, { project_id: pid, entity_type: 'material_request', entity_id: id, action: 'create', after: { code, items: items.length, origin }, module: 'warehouse' });
    emit(db, req.user, { type: 'material_request.submitted', origin: 'warehouse', project_id: pid, entity_type: 'material_request', entity_id: id,
      dedupe_key: `mrq:${id}`, next: { code, items: items.length, origin, requester_id: req.user.id }, affected: ['warehouse'] });
    return db.prepare('SELECT * FROM material_requests WHERE id = ?').get(id);
  };

  app.get('/api/warehouse/stock', h(req => { needWh(req); return stock(db); }));

  app.post('/api/warehouse/movements', h(req => tx(db, () => {
    needWh(req, 'write');
    const b = req.body || {};
    const p = prod(Number(b.product_id));
    if (!p) throw new HttpError(404, 'Няма такъв продукт');
    const kind = String(b.kind || '');
    if (!KINDS.includes(kind)) throw bad(`Видът трябва да е една от: ${KINDS.join(', ')}`);
    const qty = kind === 'adjust' ? signedQty(b.qty, 'Количество') : Math.abs(signedQty(b.qty, 'Количество'));
    if (kind !== 'adjust' && qty <= 0) throw bad('Количеството трябва да е положително');
    const pid = b.project_id == null ? null : Number(b.project_id);
    if (pid != null) needProject(db, req.user, pid);
    // Изписване без обект = необяснима липса; връщане без обект вдига склада,
    // а единиците остават „на обекта“ — материалът се оказва на две места едновременно.
    if ((kind === 'issue' || kind === 'return') && pid == null) throw bad('Изписването/връщането изисква обект');
    const unitCost = b.unit_cost != null ? num(b.unit_cost, 'Ед. цена') : p.unit_cost;
    const lineId = b.project_line_id == null ? null : Number(b.project_line_id);
    if (lineId != null) {
      const line = db.prepare('SELECT project_id FROM project_lines WHERE id = ?').get(lineId);
      if (!line || line.project_id !== pid) throw bad('КС редът не е от този обект');
    }
    const insMove = db.prepare(`INSERT INTO stock_movements(uid, product_id, kind, qty, project_id, to_project_id, project_line_id, request_id, unit_cost, document_ref, note, responsible_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const mkMove = (k2, proj, toProj) => Number(insMove.run(crypto.randomUUID(), p.id, k2, qty, proj, toProj ?? null,
      k2 === 'issue' ? lineId : null, null, unitCost, b.document_ref || null, b.note || null, req.user.id).lastInsertRowid);
    if (kind === 'transfer_out') {
      // A project-to-project transfer is ONE fact: it must always write both sides
      // atomically, or the two projects' on-site stock silently drifts apart.
      if (pid == null) throw bad('Преносът е от обект към обект — изберете обект-източник');
      const toPid = b.to_project_id == null ? null : Number(b.to_project_id);
      if (!toPid) throw bad('Изберете обект, към който се пренася');
      if (toPid === pid) throw bad('Обектът-източник и обектът-цел съвпадат');
      if (!project(toPid)) throw new HttpError(404, 'Няма такъв целеви обект');
      // Преносят се физически единици — не може да тръгне повече, отколкото реално е на обекта.
      const onSite = consumption(db, pid, Number(getSetting(db, 'overconsumption_tolerance_pct', '5')))
        .find(c => c.product_id === p.id)?.on_site || 0;
      if (qty > onSite) throw bad(`На обекта има ${onSite} ${p.unit || 'бр.'} — не може да се пренесат ${qty}`);
      const outId = mkMove('transfer_out', pid, toPid);
      mkMove('transfer_in', toPid, pid);
      audit(db, req.user, { project_id: pid, entity_type: 'stock_movement', entity_id: outId, action: 'transfer', after: { product: p.code, qty, to_project_id: toPid }, module: 'warehouse' });
      emit(db, req.user, { type: 'warehouse.transfer', origin: 'warehouse', project_id: pid, entity_type: 'product', entity_id: p.id,
        dedupe_key: `whtr:${outId}`, next: { product: p.code, kind, qty, to_project_id: toPid, to_project_code: project(toPid).code }, affected: ['warehouse', 'logistics', 'projects'] });
      return db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(outId);
    }
    const id = mkMove(kind, pid, null);
    audit(db, req.user, { project_id: pid, entity_type: 'stock_movement', entity_id: id, action: kind, after: { product: p.code, qty, kind }, module: 'warehouse' });
    emit(db, req.user, { type: 'warehouse.movement', origin: 'warehouse', project_id: pid, entity_type: 'product', entity_id: p.id,
      dedupe_key: `whmove:${crypto.randomUUID()}`, next: { product: p.code, kind, qty }, affected: ['warehouse', 'logistics'].concat(pid ? ['projects'] : []) });
    return db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id);
  })));

  app.get('/api/warehouse/movements', h(req => {
    needWh(req);
    const pid = req.query.product_id ? Number(req.query.product_id) : null;
    const proj = req.query.project_id ? Number(req.query.project_id) : null;
    return scopeRows(db, req.user, db.prepare(`SELECT m.*, p.code AS product_code, p.name AS product_name, pr.code AS project_code, tp.code AS to_project_code,
        pl.code AS project_line_code, u.full_name AS responsible_name
      FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN projects pr ON pr.id = m.project_id
      LEFT JOIN projects tp ON tp.id = m.to_project_id
      LEFT JOIN project_lines pl ON pl.id = m.project_line_id
      LEFT JOIN users u ON u.id = m.responsible_id
      WHERE (? IS NULL OR m.product_id = ?) AND (? IS NULL OR m.project_id = ?)
      ORDER BY m.id DESC LIMIT 300`).all(pid, pid, proj, proj))
      .map(m => m.to_project_id != null && !canSeeProject(db, req.user, m.to_project_id) ? { ...m, to_project_id: null, to_project_code: 'друг обект' } : m);
  }));

  // ---- потребност vs наличност vs резерви за един обект → предложени количества за заявка
  app.get('/api/warehouse/demand', h(req => {
    needWh(req);
    const pid = Number(req.query.project_id);
    if (!pid) throw bad('project_id е задължителен');
    needProject(db, req.user, pid);
    const cons = consumption(db, pid, Number(getSetting(db, 'overconsumption_tolerance_pct', '5')));
    const resByProd = new Map(db.prepare(`SELECT product_id, SUM(qty) q FROM reservations WHERE project_id = ? AND status = 'active' GROUP BY product_id`).all(pid).map(r => [r.product_id, r.q]));
    const st = new Map(stock(db).map(s => [s.id, s]));
    return cons.filter(c => c.required > 0 || c.consumed > 0 || c.expected > 0 || c.issued > 0).map(c => {
      const s = st.get(c.product_id) || { on_hand: 0, reserved: 0, free: 0 };
      const reservedHere = resByProd.get(c.product_id) || 0;
      const needQty = Math.max(0, c.required - c.issued - reservedHere);
      return { ...c, on_hand: s.on_hand, free: s.free, reserved_project: reservedHere, suggest_qty: Math.ceil(needQty * 1000) / 1000,
        covered: needQty <= 0, short: Math.max(0, needQty - s.free) };
    });
  }));

  // ---- материални заявки
  app.get('/api/material-requests', h(req => {
    needWh(req);
    const pid = req.query.project_id ? Number(req.query.project_id) : null;
    const rows = scopeRows(db, req.user, db.prepare(`SELECT m.*, p.code AS project_code, u.full_name AS requester_name FROM material_requests m
      JOIN projects p ON p.id = m.project_id LEFT JOIN users u ON u.id = m.requested_by
      ${pid ? 'WHERE m.project_id = ?' : ''} ORDER BY m.id DESC LIMIT 200`).all(...(pid ? [pid] : [])));
    const items = db.prepare(`SELECT i.*, pr.code AS product_code, pr.name AS product_name, pr.unit, pl.code AS project_line_code
      FROM request_items i JOIN products pr ON pr.id = i.product_id LEFT JOIN project_lines pl ON pl.id = i.project_line_id WHERE i.request_id = ?`);
    return rows.map(m => ({ ...m, items: items.all(m.id) }));
  }));

  app.post('/api/material-requests', h(req => tx(db, () => {
    needWh(req, 'write');
    const b = req.body || {};
    const pid = Number(b.project_id);
    if (!project(pid)) throw new HttpError(404, 'Няма такъв обект');
    needProject(db, req.user, pid);
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw bad('Заявката трябва да има поне един материал');
    return createRequest(req, pid, { items, origin: 'manual', needed_by: b.needed_by, note: b.note });
  })));

  /** Technical and Contracts file requests straight from the project — same write path,
   *  origin stamped from the filing department so the queue knows who needs it. */
  app.post('/api/projects/:pid/material-requests', h(req => tx(db, () => {
    const pid = Number(req.params.pid);
    if (!project(pid)) throw new HttpError(404, 'Няма такъв обект');
    const origin = can(req.user, 'technical', 'write') ? 'technical' : can(req.user, 'contracts', 'write') ? 'contracts' : null;
    if (!origin) need(req.user, 'warehouse', 'write');
    if (!canSeeProject(db, req.user, pid)) throw new HttpError(403, 'Нямате достъп до този обект');
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw bad('Заявката трябва да има поне един материал');
    return createRequest(req, pid, { items, origin: origin || 'manual', needed_by: b.needed_by, note: b.note });
  })));

  /** The filing modules also see their project's requests — pending quantities are
   *  what the request modal subtracts, so a technician doesn't file the same need twice. */
  app.get('/api/projects/:pid/material-requests', h(req => {
    const pid = Number(req.params.pid);
    if (!project(pid)) throw new HttpError(404, 'Няма такъв обект');
    if (!(can(req.user, 'technical', 'write') || can(req.user, 'contracts', 'write') || can(req.user, 'warehouse', 'read')))
      need(req.user, 'warehouse', 'read');
    if (!canSeeProject(db, req.user, pid)) throw new HttpError(403, 'Нямате достъп до този обект');
    const rows = db.prepare(`SELECT m.*, p.code AS project_code, u.full_name AS requester_name FROM material_requests m
      JOIN projects p ON p.id = m.project_id LEFT JOIN users u ON u.id = m.requested_by
      WHERE m.project_id = ? ORDER BY m.id DESC LIMIT 200`).all(pid);
    const items = db.prepare(`SELECT i.*, pr.code AS product_code, pr.name AS product_name, pr.unit, pl.code AS project_line_code
      FROM request_items i JOIN products pr ON pr.id = i.product_id LEFT JOIN project_lines pl ON pl.id = i.project_line_id WHERE i.request_id = ?`);
    return rows.map(m => ({ ...m, items: items.all(m.id) }));
  }));

  app.post('/api/material-requests/:id/:action', h(req => tx(db, () => {
    needWh(req, 'write');
    const id = Number(req.params.id), action = req.params.action;
    const m = db.prepare('SELECT * FROM material_requests WHERE id = ?').get(id);
    if (!m) throw new HttpError(404, 'Няма такава заявка');
    needProject(db, req.user, m.project_id);
    const items = db.prepare('SELECT i.*, p.unit_cost, p.code AS pcode, p.name AS pname FROM request_items i JOIN products p ON p.id = i.product_id WHERE i.request_id = ?').all(id);
    if (action === 'approve') {
      if (m.status !== 'submitted') throw bad('Заявката не е в статус „подадена“');
      // separation of duties: nobody approves their own request; material outside the КС is the Manager's decision
      if (m.requested_by === req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Не можете да одобрите собствената си заявка');
      if (items.some(i => i.outside_contract) && !can(req.user, 'approvals', 'approve')) throw new HttpError(403, 'Заявката има материали извън КС — одобрява Управител');
      // резервира цялото количество по всяка позиция — наличността е съвет, не блокира (закупуване съществува)
      // "за покупка" = колко не стига складът СЕГА, преди да резервираме — снимка за поръчителната служба.
      const freeNow = new Map(stock(db).map(s => [s.id, s.free]));
      const ins = db.prepare(`INSERT INTO reservations(product_id, project_id, request_item_id, qty, status) VALUES (?,?,?,?,'active')`);
      const upd = db.prepare('UPDATE request_items SET reserved_qty = qty, to_purchase_qty = ? WHERE id = ?');
      for (const it of items) {
        upd.run(Math.max(0, it.qty - (freeNow.get(it.product_id) || 0)), it.id);
        ins.run(it.product_id, m.project_id, it.id, it.qty);
      }
      db.prepare("UPDATE material_requests SET status = 'approved' WHERE id = ?").run(id);
      audit(db, req.user, { project_id: m.project_id, entity_type: 'material_request', entity_id: id, action: 'approve', module: 'warehouse' });
      emit(db, req.user, { type: 'material_request.approved', origin: 'warehouse', project_id: m.project_id, entity_type: 'material_request', entity_id: id,
        dedupe_key: `mrqa:${id}`, next: { code: m.code, requester_id: m.requested_by }, affected: ['warehouse'] });
    } else if (action === 'fulfil') {
      fulfilRequest(db, req.user, id);
    } else if (action === 'cancel') {
      if (!['submitted', 'approved'].includes(m.status)) throw bad('Заявката не може да бъде отменена');
      db.prepare("UPDATE reservations SET status = 'cancelled' WHERE request_item_id IN (SELECT id FROM request_items WHERE request_id = ?) AND status = 'active'").run(id);
      db.prepare("UPDATE request_items SET reserved_qty = 0 WHERE request_id = ?").run(id);
      db.prepare("UPDATE material_requests SET status = 'cancelled' WHERE id = ?").run(id);
      audit(db, req.user, { project_id: m.project_id, entity_type: 'material_request', entity_id: id, action: 'cancel', module: 'warehouse' });
      emit(db, req.user, { type: 'material_request.cancelled', origin: 'warehouse', project_id: m.project_id, entity_type: 'material_request', entity_id: id,
        dedupe_key: `mrqc:${id}`, next: { code: m.code, requester_id: m.requested_by }, affected: ['warehouse'] });
    } else throw bad('Непозната операция');
    return db.prepare('SELECT * FROM material_requests WHERE id = ?').get(id);
  })));

  app.get('/api/warehouse/reservations', h(req => {
    needWh(req);
    return scopeRows(db, req.user, db.prepare(`SELECT r.*, p.code AS product_code, p.name AS product_name, pr.code AS project_code, u.full_name AS requester_name
      FROM reservations r JOIN products p ON p.id = r.product_id JOIN projects pr ON pr.id = r.project_id
      LEFT JOIN request_items ri ON ri.id = r.request_item_id LEFT JOIN material_requests m ON m.id = ri.request_id
      LEFT JOIN users u ON u.id = m.requested_by
      WHERE r.status = ? AND (? IS NULL OR r.project_id = ?) ORDER BY r.id DESC LIMIT 300`).all(String(req.query.status || 'active'), req.query.project_id ? Number(req.query.project_id) : null, req.query.project_id ? Number(req.query.project_id) : null));
  }));

  /** Machinery/tools register — the warehouse's read-only view onto the same `assets`
   *  table Logistics allocates from. One registry, two windows (no copy). */
  app.get('/api/warehouse/fleet', h(req => {
    needWh(req);
    return hideForeignProject(db, req.user, db.prepare(`SELECT s.*,
        (SELECT p.code || ' — ' || p.name FROM asset_allocations a JOIN projects p ON p.id = a.project_id
          WHERE a.asset_id = s.id AND a.status IN ('planned', 'active') ORDER BY a.id DESC LIMIT 1) AS allocated_project,
      (SELECT a.project_id FROM asset_allocations a JOIN projects p ON p.id = a.project_id
        WHERE a.asset_id = s.id AND a.status IN ('planned', 'active') ORDER BY a.id DESC LIMIT 1) AS allocated_project_id
      FROM assets s ORDER BY s.kind, s.code`).all());
  }));
}
