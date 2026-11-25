// Логистика: доставки до обект с артикели, техника (активи) и разпределението й по обекти, портфолио и обеден изглед.
import { tx, nextCode } from './db.js';
import { HttpError, bad, need, canSeeProject, hideForeignProject, audit, updateRow, emit, notify, on } from './core.js';
import { h, pick, num, reqStr } from './app.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const reqDate = (v, label, { required = true } = {}) => {
  if (v == null || v === '') { if (required) throw bad(`Полето „${label}“ е задължително`); return null; }
  const s = String(v);
  if (!DATE.test(s) || isNaN(Date.parse(s))) throw bad(`Невалидна дата за „${label}“`);
  return s;
};
const DELIVERY_KINDS = ['to_site', 'return', 'other'];
const DELIVERY_STATUSES = ['planned', 'in_transit', 'delivered', 'cancelled'];
const DELIVERY_FLOW = { planned: ['in_transit', 'cancelled'], in_transit: ['delivered', 'cancelled'], delivered: [], cancelled: [] };
const ASSET_STATUSES = ['available', 'in_use', 'maintenance', 'retired'];
const ALLOC_STATUSES = ['planned', 'active', 'completed', 'cancelled'];
const LIVE_ALLOC = "('planned','active')";

export default function mountLogistics(app, db) {
  const project = id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const needLog = (req, pid = null, action = 'read') => {
    need(req.user, 'logistics', action);
    if (pid != null) {
      if (!project(pid)) throw new HttpError(404, 'Обектът не е намерен');
      if (!canSeeProject(db, req.user, pid)) throw new HttpError(403, 'Нямате достъп до този обект');
    }
  };
  const optPid = (req, v) => { const pid = v == null || v === '' ? null : Number(v); if (pid != null) needLog(req, pid); return pid; };

  const delivView = `SELECT d.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name,
      v.code AS vehicle_code, v.name AS vehicle_name, v.plate AS vehicle_plate, u.full_name AS created_by_name,
      (SELECT COUNT(*) FROM delivery_items i WHERE i.delivery_id = d.id) AS items_count,
      (SELECT GROUP_CONCAT(pr.name || ' ×' || i.qty, ', ') FROM delivery_items i JOIN products pr ON pr.id = i.product_id WHERE i.delivery_id = d.id) AS items_summary
    FROM deliveries d JOIN projects p ON p.id = d.project_id JOIN customers c ON c.id = p.customer_id
    LEFT JOIN assets v ON v.id = d.vehicle_asset_id LEFT JOIN users u ON u.id = d.created_by`;
  const allocView = `SELECT a.*, s.code AS asset_code, s.name AS asset_name, s.kind AS asset_kind, s.plate AS asset_plate,
      p.code AS project_code, p.name AS project_name, u.full_name AS created_by_name
    FROM asset_allocations a JOIN assets s ON s.id = a.asset_id JOIN projects p ON p.id = a.project_id LEFT JOIN users u ON u.id = a.created_by`;
  const assetView = `SELECT s.*,
      (SELECT p.code || ' — ' || p.name FROM asset_allocations a JOIN projects p ON p.id = a.project_id
        WHERE a.asset_id = s.id AND a.status IN ${LIVE_ALLOC} ORDER BY a.id DESC LIMIT 1) AS allocated_project,
      (SELECT a.project_id FROM asset_allocations a JOIN projects p ON p.id = a.project_id
        WHERE a.asset_id = s.id AND a.status IN ${LIVE_ALLOC} ORDER BY a.id DESC LIMIT 1) AS allocated_project_id
    FROM assets s`;
  const deliveryItems = (deliveryId) => db.prepare(`SELECT i.id, i.product_id, i.qty, pr.code AS product_code, pr.name AS product_name, pr.unit
    FROM delivery_items i JOIN products pr ON pr.id = i.product_id WHERE i.delivery_id = ? ORDER BY i.id`).all(deliveryId);

  const checkItems = items => {
    if (!Array.isArray(items) || !items.length) throw bad('Доставката трябва да има поне един артикул');
    for (const it of items) {
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(Number(it.product_id))) throw bad('Невалиден продукт в доставката');
      num(it.qty, 'Количество', { min: 0.000001 });
    }
  };
  const insertItems = (deliveryId, items) => {
    const ins = db.prepare('INSERT INTO delivery_items(delivery_id, product_id, qty) VALUES (?,?,?)');
    for (const it of items) ins.run(deliveryId, Number(it.product_id), Number(it.qty));
  };
  const checkVehicle = v => {
    if (v == null || v === '') return null;
    const a = db.prepare('SELECT id FROM assets WHERE id = ?').get(Number(v));
    if (!a) throw bad('Няма такава техника');
    return a.id;
  };
  const checkRequest = (v, pid) => {
    if (v == null || v === '') return null;
    const mr = db.prepare('SELECT project_id FROM material_requests WHERE id = ?').get(Number(v));
    if (!mr) throw bad('Няма такава заявка за материали');
    if (pid != null && mr.project_id !== pid) throw bad('Заявката е за друг обект');
    return Number(v);
  };

  // ---- портфолио: логистични показатели по всички видими обекти + автопаркът
  app.get('/api/logistics', h(req => {
    need(req.user, 'logistics');
    const projects = db.prepare(`SELECT p.id, p.code, p.name, p.status, c.name AS customer_name FROM projects p JOIN customers c ON c.id = p.customer_id
      WHERE p.archived = 0 ORDER BY p.id DESC`).all()
      .filter(p => canSeeProject(db, req.user, p.id))
      .map(p => {
        const d = db.prepare(`SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END) AS planned,
            SUM(CASE WHEN status = 'in_transit' THEN 1 ELSE 0 END) AS in_transit,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
          FROM deliveries WHERE project_id = ?`).get(p.id);
        const a = db.prepare(`SELECT COUNT(*) n FROM asset_allocations WHERE project_id = ? AND status IN ${LIVE_ALLOC}`).get(p.id);
        return { ...p, deliveries: { total: d.total, planned: d.planned || 0, in_transit: d.in_transit || 0, delivered: d.delivered || 0, cancelled: d.cancelled || 0 }, active_allocations: a.n };
      });
    const fleet = db.prepare('SELECT status, COUNT(*) n FROM assets GROUP BY status').all();
    return { projects, fleet: Object.fromEntries(fleet.map(f => [f.status, f.n])),
      totals: { projects: projects.length, deliveries: projects.reduce((s, p) => s + p.deliveries.total, 0),
        in_transit: projects.reduce((s, p) => s + p.deliveries.in_transit, 0),
        active_allocations: projects.reduce((s, p) => s + p.active_allocations, 0) } };
  }));

  // ---- обеден изглед: всички логистични записи на един обект + неговите логистични бележки
  app.get('/api/projects/:pid/logistics', h(req => {
    needLog(req, Number(req.params.pid));
    const pid = Number(req.params.pid);
    const deliveries = db.prepare(`${delivView} WHERE d.project_id = ? ORDER BY d.id DESC`).all(pid)
      .map(d => ({ ...d, items: deliveryItems(d.id) }));
    return { deliveries,
      allocations: db.prepare(`${allocView} WHERE a.project_id = ? ORDER BY a.id DESC`).all(pid),
      logistics_fields: pick(project(pid), ['access_notes', 'unloading_notes', 'storage_notes', 'parking_notes', 'courier_office', 'courier_pallets']) };
  }));

  // ---- Доставки
  app.get('/api/deliveries', h(req => {
    need(req.user, 'logistics');
    const pid = optPid(req, req.query.project_id);
    const w = pid != null ? ' WHERE d.project_id = ?' : '';
    return db.prepare(`${delivView}${w} ORDER BY d.id DESC`).all(...(pid != null ? [pid] : []))
      .filter(r => canSeeProject(db, req.user, r.project_id));
  }));
  app.post('/api/deliveries', h(req => tx(db, () => {
    need(req.user, 'logistics', 'write');
    const b = req.body || {};
    const pid = Number(b.project_id);
    if (!pid) throw bad('Обектът е задължителен');
    needLog(req, pid, 'write');
    const kind = b.kind || 'to_site';
    if (!DELIVERY_KINDS.includes(kind)) throw bad('Невалиден вид доставка');
    checkItems(b.items);
    const f = { code: nextCode(db, 'DLV'), project_id: pid, request_id: checkRequest(b.request_id, pid), kind,
      planned_date: reqDate(b.planned_date, 'Планирана дата', { required: false }), status: 'planned',
      carrier: b.carrier || null, courier_office: b.courier_office || null,
      pallets: b.pallets != null && b.pallets !== '' ? num(b.pallets, 'Палети', { min: 0 }) : null,
      palletized: b.palletized == null ? 1 : (b.palletized ? 1 : 0),
      vehicle_asset_id: checkVehicle(b.vehicle_asset_id),
      unloading: b.unloading || null, address: b.address || null, access_notes: b.access_notes || null,
      note: b.note || null, created_by: req.user.id };
    const id = Number(db.prepare(`INSERT INTO deliveries(code, project_id, request_id, kind, planned_date, status, carrier, courier_office, pallets, palletized, vehicle_asset_id, unloading, address, access_notes, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(f.code, f.project_id, f.request_id, f.kind, f.planned_date, f.status, f.carrier, f.courier_office, f.pallets, f.palletized, f.vehicle_asset_id, f.unloading, f.address, f.access_notes, f.note, f.created_by).lastInsertRowid);
    insertItems(id, b.items);
    audit(db, req.user, { project_id: pid, entity_type: 'delivery', entity_id: id, action: 'create', after: { code: f.code, kind, planned_date: f.planned_date }, module: 'logistics' });
    emit(db, req.user, { type: 'delivery.created', origin: 'logistics', project_id: pid, entity_type: 'delivery', entity_id: id,
      dedupe_key: `delivery.created:${id}`, next: { code: f.code }, affected: ['warehouse', 'technical', 'brigadier', 'logistics'] });
    return { ...db.prepare(`${delivView} WHERE d.id = ?`).get(id), items: deliveryItems(id) };
  })));
  app.patch('/api/deliveries/:id', h(req => tx(db, () => {
    need(req.user, 'logistics', 'write');
    const d = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(Number(req.params.id));
    if (!d) throw new HttpError(404, 'Няма такава доставка');
    needLog(req, d.project_id, 'write');
    const b = req.body || {};
    const f = pick(b, ['carrier', 'courier_office', 'pallets', 'palletized', 'unloading', 'address', 'access_notes', 'note', 'planned_date', 'kind', 'request_id', 'vehicle_asset_id']);
    if (f.kind !== undefined && !DELIVERY_KINDS.includes(f.kind)) throw bad('Невалиден вид доставка');
    if (f.planned_date !== undefined) f.planned_date = reqDate(f.planned_date, 'Планирана дата', { required: false });
    if (f.pallets !== undefined) f.pallets = f.pallets === '' || f.pallets === null ? null : num(f.pallets, 'Палети', { min: 0 });
    if (f.palletized !== undefined) f.palletized = f.palletized ? 1 : 0;
    if (f.vehicle_asset_id !== undefined) f.vehicle_asset_id = checkVehicle(f.vehicle_asset_id);
    if (f.request_id !== undefined) f.request_id = checkRequest(f.request_id, d.project_id);
    if (b.status !== undefined && b.status !== d.status) {
      if (!DELIVERY_STATUSES.includes(b.status)) throw bad('Невалиден статус');
      if (!DELIVERY_FLOW[d.status]?.includes(b.status)) throw bad(`Статусът не може да мине от „${d.status}“ към „${b.status}“`);
      f.status = b.status;
    }
    if (b.items !== undefined) {
      checkItems(b.items);
      db.prepare('DELETE FROM delivery_items WHERE delivery_id = ?').run(d.id);
      insertItems(d.id, b.items);
    }
    updateRow(db, 'deliveries', d.id, f, b.row_version);
    audit(db, req.user, { project_id: d.project_id, entity_type: 'delivery', entity_id: d.id, action: f.status ? 'status' : 'update',
      before: pick(d, Object.keys(f).filter(k => k !== 'status')), after: f, module: 'logistics' });
    if (f.status === 'delivered')
      emit(db, req.user, { type: 'delivery.delivered', origin: 'logistics', project_id: d.project_id, entity_type: 'delivery', entity_id: d.id,
        dedupe_key: `delivery.delivered:${d.id}`, prev: { status: d.status }, next: { status: 'delivered' }, affected: ['brigadier', 'technical', 'logistics'] });
    if (f.status === 'cancelled')
      emit(db, req.user, { type: 'delivery.cancelled', origin: 'logistics', project_id: d.project_id, entity_type: 'delivery', entity_id: d.id,
        dedupe_key: `delivery.cancelled:${d.id}`, prev: { status: d.status }, next: { status: 'cancelled' }, affected: ['warehouse', 'logistics'] });
    return { ...db.prepare(`${delivView} WHERE d.id = ?`).get(d.id), items: deliveryItems(d.id) };
  })));

  // ---- Техника (активи)
  app.get('/api/assets', h(req => { need(req.user, 'logistics'); return hideForeignProject(db, req.user, db.prepare(`${assetView} ORDER BY s.id DESC`).all()); }));
  app.post('/api/assets', h(req => tx(db, () => {
    need(req.user, 'logistics', 'write');
    const b = req.body || {};
    const status = b.status || 'available';
    if (!ASSET_STATUSES.includes(status)) throw bad('Невалиден статус');
    const f = { code: nextCode(db, 'AST'), name: reqStr(b.name, 'Име'), kind: reqStr(b.kind, 'Вид'), plate: b.plate || null,
      status, location: b.location || null, notes: b.notes || null };
    const id = Number(db.prepare('INSERT INTO assets(code, name, kind, plate, status, location, notes) VALUES (?,?,?,?,?,?,?)')
      .run(f.code, f.name, f.kind, f.plate, f.status, f.location, f.notes).lastInsertRowid);
    audit(db, req.user, { entity_type: 'asset', entity_id: id, action: 'create', after: { code: f.code, name: f.name, kind: f.kind }, module: 'logistics' });
    return db.prepare(`${assetView} WHERE s.id = ?`).get(id);
  })));
  app.patch('/api/assets/:id', h(req => tx(db, () => {
    need(req.user, 'logistics', 'write');
    const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(Number(req.params.id));
    if (!a) throw new HttpError(404, 'Няма такава техника');
    const b = req.body || {};
    const f = pick(b, ['name', 'kind', 'plate', 'status', 'location', 'notes']);
    if (f.name !== undefined) f.name = reqStr(f.name, 'Име');
    if (f.kind !== undefined) f.kind = reqStr(f.kind, 'Вид');
    if (f.status !== undefined && !ASSET_STATUSES.includes(f.status)) throw bad('Невалиден статус');
    updateRow(db, 'assets', a.id, f, b.row_version);
    audit(db, req.user, { entity_type: 'asset', entity_id: a.id, action: 'update', before: pick(a, Object.keys(f)), after: f, module: 'logistics' });
    return db.prepare(`${assetView} WHERE s.id = ?`).get(a.id);
  })));

  // ---- Разпределение на техниката по обекти
  const overlap = (assetId, from, to, excludeId = null) =>
    db.prepare(`SELECT id FROM asset_allocations WHERE asset_id = ? AND status IN ${LIVE_ALLOC} AND date_from <= ? AND date_to >= ? ${excludeId != null ? 'AND id != ?' : ''}`)
      .get(assetId, to, from, ...(excludeId != null ? [excludeId] : []));
  app.get('/api/asset-allocations', h(req => {
    need(req.user, 'logistics');
    const w = [], args = [];
    if (req.query.project_id !== undefined && req.query.project_id !== '') { const pid = optPid(req, req.query.project_id); w.push('a.project_id = ?'); args.push(pid); }
    if (req.query.asset_id !== undefined && req.query.asset_id !== '') { w.push('a.asset_id = ?'); args.push(Number(req.query.asset_id)); }
    return db.prepare(`${allocView}${w.length ? ' WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC`).all(...args)
      .filter(r => canSeeProject(db, req.user, r.project_id));
  }));
  app.post('/api/asset-allocations', h(req => tx(db, () => {
    need(req.user, 'logistics', 'write');
    const b = req.body || {};
    const aid = Number(b.asset_id), pid = Number(b.project_id);
    if (!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(aid)) throw bad('Няма такава техника');
    needLog(req, pid, 'write');
    const df = reqDate(b.date_from, 'От дата'), dt = reqDate(b.date_to, 'До дата');
    if (dt < df) throw bad('Крайната дата е преди началната');
    const status = b.status || 'planned';
    if (!ALLOC_STATUSES.includes(status)) throw bad('Невалиден статус');
    if (['planned', 'active'].includes(status) && overlap(aid, df, dt)) throw bad('Техниката вече е разпределена за този период');
    const id = Number(db.prepare('INSERT INTO asset_allocations(asset_id, project_id, date_from, date_to, status, note, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(aid, pid, df, dt, status, b.note || null, req.user.id).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'asset_allocation', entity_id: id, action: 'create', after: { asset_id: aid, date_from: df, date_to: dt, status }, module: 'logistics' });
    emit(db, req.user, { type: 'asset.allocated', origin: 'logistics', project_id: pid, entity_type: 'asset_allocation', entity_id: id,
      dedupe_key: `asset.allocated:${id}`, next: { asset_id: aid, date_from: df, date_to: dt }, affected: ['technical', 'logistics'] });
    return db.prepare(`${allocView} WHERE a.id = ?`).get(id);
  })));
  app.patch('/api/asset-allocations/:id', h(req => tx(db, () => {
    need(req.user, 'logistics', 'write');
    const a = db.prepare('SELECT * FROM asset_allocations WHERE id = ?').get(Number(req.params.id));
    if (!a) throw new HttpError(404, 'Няма такова разпределение');
    needLog(req, a.project_id, 'write');
    const b = req.body || {};
    const f = pick(b, ['date_from', 'date_to', 'status', 'note']);
    if (f.date_from !== undefined) f.date_from = reqDate(f.date_from, 'От дата');
    if (f.date_to !== undefined) f.date_to = reqDate(f.date_to, 'До дата');
    const ndt = f.date_to ?? a.date_to, ndf = f.date_from ?? a.date_from;
    if (ndt < ndf) throw bad('Крайната дата е преди началната');
    if (f.status !== undefined && !ALLOC_STATUSES.includes(f.status)) throw bad('Невалиден статус');
    const ns = f.status ?? a.status;
    if (['planned', 'active'].includes(ns) && (f.date_from !== undefined || f.date_to !== undefined || f.status !== undefined) && overlap(a.asset_id, ndf, ndt, a.id))
      throw bad('Техниката вече е разпределена за този период');
    updateRow(db, 'asset_allocations', a.id, f, b.row_version);
    audit(db, req.user, { project_id: a.project_id, entity_type: 'asset_allocation', entity_id: a.id, action: 'update', before: pick(a, Object.keys(f)), after: f, module: 'logistics' });
    return db.prepare(`${allocView} WHERE a.id = ?`).get(a.id);
  })));
}

// Събития, които само уведомяват хора.
on('delivery.created', 'notify_ops', (db, ev) => {
  const d = db.prepare('SELECT d.code, p.code AS pcode FROM deliveries d JOIN projects p ON p.id = d.project_id WHERE d.id = ?').get(ev.entity_id);
  if (!d) return { skipped: true };
  return notify(db, ev, { departments: ['warehouse', 'technical', 'brigadier'],
    title: `Нова доставка ${d.code}${d.pcode ? ' — ' + d.pcode : ''}`,
    body: 'Планирана доставка до обект.', link: `/logistics?pid=${ev.project_id}` });
});
on('delivery.delivered', 'notify_site', (db, ev) => {
  const d = db.prepare('SELECT d.code, p.code AS pcode FROM deliveries d JOIN projects p ON p.id = d.project_id WHERE d.id = ?').get(ev.entity_id);
  if (!d) return { skipped: true };
  return notify(db, ev, { departments: ['brigadier', 'technical'],
    title: `Доставката ${d.code} е пристигнала${d.pcode ? ' — ' + d.pcode : ''}`,
    link: `/logistics?pid=${ev.project_id}` });
});
on('delivery.cancelled', 'notify_warehouse', (db, ev) => {
  const d = db.prepare('SELECT d.code, p.code AS pcode FROM deliveries d JOIN projects p ON p.id = d.project_id WHERE d.id = ?').get(ev.entity_id);
  if (!d) return { skipped: true };
  return notify(db, ev, { departments: ['warehouse'], severity: 'warn',
    title: `Доставката ${d.code} е отменена${d.pcode ? ' — ' + d.pcode : ''}`,
    link: `/logistics?pid=${ev.project_id}` });
});
on('asset.allocated', 'notify_technical', (db, ev) => {
  const a = db.prepare(`SELECT a.id, s.name AS asset_name, p.code AS pcode FROM asset_allocations a JOIN assets s ON s.id = a.asset_id JOIN projects p ON p.id = a.project_id WHERE a.id = ?`).get(ev.entity_id);
  if (!a) return { skipped: true };
  return notify(db, ev, { departments: ['technical', 'logistics'],
    title: `Техника „${a.asset_name}“ е разпределена${a.pcode ? ' — ' + a.pcode : ''}`,
    link: `/logistics?pid=${ev.project_id}` });
});
