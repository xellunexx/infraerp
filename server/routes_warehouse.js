// Склад: непокътнат складов регистър (stock_movements), материални заявки → резерв → изписване,
// и заявка-помощник, който сравнява потребността от КС/рецепти с наличното и резервираното.
import crypto from 'node:crypto';
import { need, audit, emit, HttpError, bad, setting as getSetting } from './core.js';
import { h, num } from './app.js';
import { tx, nextCode } from './db.js';
import { stock, consumption } from './calc.js';

const KINDS = ['receipt', 'issue', 'return', 'adjust'];
const signedQty = (v, label) => { const n = Number(v); if (!Number.isFinite(n) || n === 0) throw bad(`Невалидно количество за „${label}“`); return n; };

export default function mountWarehouse(app, db) {
  const needWh = (req, a = 'read') => need(req.user, 'warehouse', a);
  const prod = id => db.prepare('SELECT * FROM products WHERE id = ?').get(id);

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
    const unitCost = b.unit_cost != null ? num(b.unit_cost, 'Ед. цена') : p.unit_cost;
    const uid = crypto.randomUUID();
    const id = Number(db.prepare(`INSERT INTO stock_movements(uid, product_id, kind, qty, project_id, unit_cost, document_ref, note, responsible_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(uid, p.id, kind, qty, pid, unitCost, b.document_ref || null, b.note || null, req.user.id).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'stock_movement', entity_id: id, action: kind, after: { product: p.code, qty, kind }, module: 'warehouse' });
    emit(db, req.user, { type: 'warehouse.movement', origin: 'warehouse', project_id: pid, entity_type: 'product', entity_id: p.id,
      dedupe_key: `whmove:${uid}`, next: { product: p.code, kind, qty }, affected: ['warehouse', 'logistics'].concat(pid ? ['projects'] : []) });
    return db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id);
  })));

  app.get('/api/warehouse/movements', h(req => {
    needWh(req);
    const pid = req.query.product_id ? Number(req.query.product_id) : null;
    const proj = req.query.project_id ? Number(req.query.project_id) : null;
    return db.prepare(`SELECT m.*, p.code AS product_code, p.name AS product_name, pr.code AS project_code, u.full_name AS responsible_name
      FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN projects pr ON pr.id = m.project_id
      LEFT JOIN users u ON u.id = m.responsible_id
      WHERE (? IS NULL OR m.product_id = ?) AND (? IS NULL OR m.project_id = ?)
      ORDER BY m.id DESC LIMIT 300`).all(pid, pid, proj, proj);
  }));

  // ---- потребност vs наличност vs резерви за един обект → предложени количества за заявка
  app.get('/api/warehouse/demand', h(req => {
    needWh(req);
    const pid = Number(req.query.project_id);
    if (!pid) throw bad('project_id е задължителен');
    const cons = consumption(db, pid, Number(getSetting(db, 'overconsumption_tolerance_pct', '5')));
    const resByProd = new Map(db.prepare(`SELECT product_id, SUM(qty) q FROM reservations WHERE project_id = ? AND status = 'active' GROUP BY product_id`).all(pid).map(r => [r.product_id, r.q]));
    const st = new Map(stock(db).map(s => [s.id, s]));
    return cons.filter(c => c.required > 0 || c.consumed > 0 || c.expected > 0).map(c => {
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
    const rows = db.prepare(`SELECT m.*, p.code AS project_code, u.full_name AS requester_name FROM material_requests m
      JOIN projects p ON p.id = m.project_id LEFT JOIN users u ON u.id = m.requested_by
      ${pid ? 'WHERE m.project_id = ?' : ''} ORDER BY m.id DESC LIMIT 200`).all(...(pid ? [pid] : []));
    const items = db.prepare(`SELECT i.*, pr.code AS product_code, pr.name AS product_name, pr.unit FROM request_items i JOIN products pr ON pr.id = i.product_id WHERE i.request_id = ?`);
    return rows.map(m => ({ ...m, items: items.all(m.id) }));
  }));

  app.post('/api/material-requests', h(req => tx(db, () => {
    needWh(req, 'write');
    const b = req.body || {};
    const pid = Number(b.project_id);
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(pid)) throw new HttpError(404, 'Няма такъв обект');
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw bad('Заявката трябва да има поне един материал');
    const code = nextCode(db, 'MRQ');
    const id = Number(db.prepare(`INSERT INTO material_requests(code, project_id, origin, needed_by, status, note, requested_by, needs_approval)
      VALUES (?,?,?,?, 'submitted', ?,?,1)`).run(code, pid, String(b.origin || 'manual'), b.needed_by || null, b.note || null, req.user.id).lastInsertRowid);
    const ins = db.prepare('INSERT INTO request_items(request_id, product_id, qty, project_line_id) VALUES (?,?,?,?)');
    for (const it of items) {
      const p = prod(Number(it.product_id));
      if (!p) throw bad('Невалиден продукт в заявката');
      ins.run(id, p.id, num(it.qty, 'Количество', { min: 0.000001 }), it.project_line_id ?? null);
    }
    audit(db, req.user, { project_id: pid, entity_type: 'material_request', entity_id: id, action: 'create', after: { code, items: items.length }, module: 'warehouse' });
    emit(db, req.user, { type: 'material_request.submitted', origin: 'warehouse', project_id: pid, entity_type: 'material_request', entity_id: id,
      dedupe_key: `mrq:${id}`, next: { code, items: items.length }, affected: ['warehouse'] });
    return db.prepare('SELECT * FROM material_requests WHERE id = ?').get(id);
  })));

  app.post('/api/material-requests/:id/:action', h(req => tx(db, () => {
    needWh(req, 'write');
    const id = Number(req.params.id), action = req.params.action;
    const m = db.prepare('SELECT * FROM material_requests WHERE id = ?').get(id);
    if (!m) throw new HttpError(404, 'Няма такава заявка');
    const items = db.prepare('SELECT i.*, p.unit_cost, p.code AS pcode, p.name AS pname FROM request_items i JOIN products p ON p.id = i.product_id WHERE i.request_id = ?').all(id);
    if (action === 'approve') {
      if (m.status !== 'submitted') throw bad('Заявката не е в статус „подадена“');
      // резервира цялото количество по всяка позиция — наличността е съвет, не блокира (закупуване съществува)
      const ins = db.prepare(`INSERT INTO reservations(product_id, project_id, request_item_id, qty, status) VALUES (?,?,?,?,'active')`);
      for (const it of items) ins.run(it.product_id, m.project_id, it.id, it.qty);
      db.prepare("UPDATE request_items SET reserved_qty = qty WHERE request_id = ?").run(id);
      db.prepare("UPDATE material_requests SET status = 'approved' WHERE id = ?").run(id);
      audit(db, req.user, { project_id: m.project_id, entity_type: 'material_request', entity_id: id, action: 'approve', module: 'warehouse' });
    } else if (action === 'fulfil') {
      if (m.status !== 'approved') throw bad('Заявката трябва първо да бъде одобрена');
      // изписва от склада: складов записа на продукт + освобождава резервацията
      const ins = db.prepare(`INSERT INTO stock_movements(uid, product_id, kind, qty, project_id, request_id, unit_cost, responsible_id) VALUES (?,?,'issue',?,?,?,?,?)`);
      const rel = db.prepare(`UPDATE reservations SET status = 'fulfilled' WHERE request_item_id = ? AND status = 'active'`);
      for (const it of items) {
        ins.run(crypto.randomUUID(), it.product_id, it.qty, m.project_id, id, it.unit_cost, req.user.id);
        rel.run(it.id);
      }
      db.prepare("UPDATE material_requests SET status = 'fulfilled' WHERE id = ?").run(id);
      audit(db, req.user, { project_id: m.project_id, entity_type: 'material_request', entity_id: id, action: 'fulfil', after: { items: items.length }, module: 'warehouse' });
      emit(db, req.user, { type: 'material_request.fulfilled', origin: 'warehouse', project_id: m.project_id, entity_type: 'material_request', entity_id: id,
        dedupe_key: `mrqf:${id}`, next: { code: m.code }, affected: ['warehouse', 'logistics'] });
    } else if (action === 'cancel') {
      if (!['submitted', 'approved'].includes(m.status)) throw bad('Заявката не може да бъде отменена');
      db.prepare("UPDATE reservations SET status = 'cancelled' WHERE request_item_id IN (SELECT id FROM request_items WHERE request_id = ?) AND status = 'active'").run(id);
      db.prepare("UPDATE request_items SET reserved_qty = 0 WHERE request_id = ?").run(id);
      db.prepare("UPDATE material_requests SET status = 'cancelled' WHERE id = ?").run(id);
      audit(db, req.user, { project_id: m.project_id, entity_type: 'material_request', entity_id: id, action: 'cancel', module: 'warehouse' });
    } else throw bad('Непозната операция');
    return db.prepare('SELECT * FROM material_requests WHERE id = ?').get(id);
  })));

  app.get('/api/warehouse/reservations', h(req => {
    needWh(req);
    return db.prepare(`SELECT r.*, p.code AS product_code, p.name AS product_name, pr.code AS project_code, u.full_name AS requester_name
      FROM reservations r JOIN products p ON p.id = r.product_id JOIN projects pr ON pr.id = r.project_id
      LEFT JOIN request_items ri ON ri.id = r.request_item_id LEFT JOIN material_requests m ON m.id = ri.request_id
      LEFT JOIN users u ON u.id = m.requested_by
      WHERE r.status = ? ORDER BY r.id DESC LIMIT 300`).all(String(req.query.status || 'active'));
  }));
}
