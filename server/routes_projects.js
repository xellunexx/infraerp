// Договори + Картон на обекта (core view) + engine visibility, notifications, search.
import { tx } from './db.js';
import { HttpError, bad, need, can, needProject, canSeeProject, audit, updateRow, emit, reindex, resolveApproval } from './core.js';
import { signContract, newContractVersion, setStage, deriveProjectStatus, syncProjectStatus } from './domain.js';
import { progressSummary, finance } from './calc.js';
import { h, pick } from './app.js';
import { refreshProject, weatherView } from './weather.js';

export default function mountProjects(app, db) {
  const contractView = projectId => {
    const c = db.prepare(`SELECT c.*, p.code AS project_code, p.name AS project_name, cu.name AS customer_name FROM contracts c
      JOIN projects p ON p.id = c.project_id JOIN customers cu ON cu.id = p.customer_id WHERE c.project_id = ?`).get(projectId);
    if (!c) return null;
    c.versions = db.prepare(`SELECT v.id, v.version, v.reason, v.total_value, v.amendment_id, v.created_at, u.full_name AS approved_by_name
      FROM contract_versions v LEFT JOIN users u ON u.id = v.approved_by WHERE v.contract_id = ? ORDER BY v.version`).all(c.id);
    c.appendices = db.prepare('SELECT * FROM contract_appendices WHERE contract_id = ? AND contract_version = ? ORDER BY number').all(c.id, c.active_version ?? 0);
    c.total = progressSummary(db, projectId).contract_value;
    return c;
  };
  app.get('/api/contracts', h(req => { need(req.user, 'contracts'); return db.prepare(`SELECT c.*, p.code AS project_code, p.name AS project_name, cu.name AS customer_name,
    (SELECT COALESCE(SUM(qty * unit_price), 0) FROM project_lines l WHERE l.project_id = c.project_id AND l.removed = 0) AS total
    FROM contracts c JOIN projects p ON p.id = c.project_id JOIN customers cu ON cu.id = p.customer_id ORDER BY c.id DESC`).all(); }));
  app.get('/api/projects/:pid/contract', h(req => { need(req.user, 'contracts'); needProject(db, req.user, req.params.pid); return contractView(Number(req.params.pid)); }));
  app.get('/api/contract-versions/:id', h(req => { need(req.user, 'contracts');
    const v = db.prepare('SELECT * FROM contract_versions WHERE id = ?').get(req.params.id);
    if (!v) throw new HttpError(404, 'Няма такава версия');
    return { ...v, snapshot: JSON.parse(v.snapshot), appendices: db.prepare('SELECT * FROM contract_appendices WHERE contract_id = ? AND contract_version = ? ORDER BY number').all(v.contract_id, v.version) }; }));
  app.patch('/api/projects/:pid/contract', h(req => tx(db, () => {
    need(req.user, 'contracts', 'write');
    const pid = Number(req.params.pid), c = db.prepare('SELECT * FROM contracts WHERE project_id = ?').get(pid);
    if (!c) throw new HttpError(404, 'Няма договор');
    if (c.status !== 'draft') throw bad('Договорът вече е изпратен за одобрение. Променя се само след връщане или с анекс.');
    const f = pick(req.body || {}, ['template', 'special_terms', 'delivery_deadline', 'install_start', 'install_deadline', 'advance_pct', 'payment_terms_days']);
    const s = f.install_start ?? c.install_start, e = f.install_deadline ?? c.install_deadline;
    if (s && e && e < s) throw bad('Крайният срок е преди началото на монтажа');
    updateRow(db, 'contracts', c.id, f, req.body?.row_version);
    audit(db, req.user, { project_id: pid, entity_type: 'contract', entity_id: c.id, action: 'update', before: pick(c, Object.keys(f)), after: f, module: 'contracts' });
    return contractView(pid);
  })));
  /** draft -> review -> approved (immutable version 1) -> signed (event). */
  app.post('/api/projects/:pid/contract/:action', h(req => {
    const pid = Number(req.params.pid), action = req.params.action;
    if (action === 'sign') { need(req.user, 'contracts', 'write'); return { event_id: signContract(db, req.user, pid, req.body?.signed_on) }; }
    return tx(db, () => {
      const c = db.prepare('SELECT * FROM contracts WHERE project_id = ?').get(pid);
      if (!c) throw new HttpError(404, 'Няма договор');
      const special = c.template !== 'standard' || !!c.special_terms;
      if (action === 'submit') {
        need(req.user, 'contracts', 'write');
        if (c.status !== 'draft') throw bad('Договорът не е в статус „проект“');
        db.prepare("UPDATE contracts SET status = 'review', row_version = row_version + 1 WHERE id = ?").run(c.id);
        setStage(db, pid, 'contract_generation', 'done', req.user); setStage(db, pid, 'contract_approval', 'active');
        emit(db, req.user, { type: 'contract.submitted', origin: 'contracts', project_id: pid, entity_type: 'contract', entity_id: c.id, dedupe_key: `contract.submitted:${c.id}:${c.row_version}`,
          prev: { status: 'draft' }, next: { status: 'review', special }, approval_status: special ? 'pending' : null, affected: special ? ['management'] : ['contracts'] });
      } else if (action === 'approve') {
        if (c.status !== 'review') throw bad('Договорът не е изпратен за одобрение');
        if (special) need(req.user, 'approvals', 'approve'); else need(req.user, 'contracts', 'write');
        db.prepare("UPDATE contracts SET status = 'approved', row_version = row_version + 1 WHERE id = ?").run(c.id);
        resolveApproval(db, 'contract', c.id, 'approved');
        newContractVersion(db, pid, 'Първоначален договор (одобрена оферта)', { approved_by: req.user.id });
        setStage(db, pid, 'contract_approval', 'done', req.user);
        db.prepare("UPDATE approvals SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE entity_type = 'contract' AND entity_id = ? AND status = 'pending'").run(req.user.id, c.id);
      } else if (action === 'return') {
        need(req.user, 'contracts', 'write');
        if (c.status !== 'review') throw bad('Договорът не е в преглед');
        db.prepare("UPDATE contracts SET status = 'draft', row_version = row_version + 1 WHERE id = ?").run(c.id);
        resolveApproval(db, 'contract', c.id, 'rejected');
        db.prepare("UPDATE approvals SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE entity_type = 'contract' AND entity_id = ? AND status = 'pending'").run(req.user.id, req.body?.note || null, c.id);
      } else throw bad('Непозната операция');
      audit(db, req.user, { project_id: pid, entity_type: 'contract', entity_id: c.id, action, before: { status: c.status }, after: { note: req.body?.note || null }, module: 'contracts' });
      return contractView(pid);
    });
  }));

  // ---- Картон на обекта
  const visible = (u, pid) => canSeeProject(db, u, pid);
  app.get('/api/projects', h(req => {
    need(req.user, 'projects');
    const money = can(req.user, 'finance');
    return db.prepare(`SELECT p.*, c.name AS customer_name, t.full_name AS technical_name, b.full_name AS brigadier_name,
        (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status = 'open' AND i.severity IN ('high', 'critical')) AS critical_issues
      FROM projects p JOIN customers c ON c.id = p.customer_id LEFT JOIN users t ON t.id = p.technical_id LEFT JOIN users b ON b.id = p.brigadier_id ORDER BY p.id DESC`).all()
      .filter(p => visible(req.user, p.id))
      .map(p => { const s = progressSummary(db, p.id); return { ...p, progress_pct: s.progress_pct, contract_value: money ? s.contract_value : null }; });
  }));
  app.get('/api/projects/:id', h(req => {
    need(req.user, 'projects'); const id = Number(req.params.id); needProject(db, req.user, id);
    const p = db.prepare(`SELECT p.*, t.full_name AS technical_name, b.full_name AS brigadier_name FROM projects p
      LEFT JOIN users t ON t.id = p.technical_id LEFT JOIN users b ON b.id = p.brigadier_id WHERE p.id = ?`).get(id);
    if (!p) throw new HttpError(404, 'Обектът не е намерен');
    const s = progressSummary(db, id), money = can(req.user, 'finance');
    p.site_questionnaire = JSON.parse(p.site_questionnaire || '{}'); p.customer_questionnaire = JSON.parse(p.customer_questionnaire || '{}');
    return { ...p, customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(p.customer_id),
      offer: p.offer_id ? db.prepare('SELECT id, code, title, confirmed_version, current_version FROM offers WHERE id = ?').get(p.offer_id) : null,
      contract: db.prepare('SELECT id, code, status, active_version, signed_on, delivery_deadline, install_start, install_deadline FROM contracts WHERE project_id = ?').get(id) || null,
      progress_pct: s.progress_pct, lines: s.lines.map(l => money ? l : { ...l, unit_price: null, unit_cost: null }),
      finance: money ? finance(db, id) : null,
      stages: db.prepare('SELECT s.*, u.full_name AS done_by_name FROM project_stages s LEFT JOIN users u ON u.id = s.done_by WHERE s.project_id = ? ORDER BY s.sort').all(id),
      members: db.prepare('SELECT m.user_id, m.role, u.full_name, u.department FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ?').all(id) };
  }));
  app.patch('/api/projects/:id', h(req => tx(db, () => {
    need(req.user, 'projects', 'write');
    const id = Number(req.params.id), before = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!before) throw new HttpError(404, 'Обектът не е намерен');
    const b = req.body || {};
    const f = pick(b, ['name', 'site_address', 'technical_id', 'brigadier_id', 'access_notes', 'unloading_notes', 'storage_notes', 'parking_notes', 'courier_office', 'courier_pallets', 'payment_urgency']);
    for (const k of ['site_questionnaire', 'customer_questionnaire']) if (b[k]) f[k] = JSON.stringify(b[k]);
    // site location: coordinates typed by hand win; a changed address without coordinates is geocoded again on the next weather refresh
    if (b.latitude !== undefined || b.longitude !== undefined) {
      const lat = b.latitude === '' || b.latitude == null ? null : Number(b.latitude), lon = b.longitude === '' || b.longitude == null ? null : Number(b.longitude);
      if ((lat == null) !== (lon == null) || (lat != null && !(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180))) throw bad('Невалидни координати');
      Object.assign(f, { latitude: lat, longitude: lon, geo_source: lat == null ? null : 'manual', geo_label: lat == null ? null : 'въведени ръчно' });
    } else if (f.site_address !== undefined && f.site_address !== before.site_address && before.geo_source !== 'manual') Object.assign(f, { latitude: null, longitude: null, geo_source: null, geo_label: null });
    if (f.latitude !== undefined && (f.latitude !== before.latitude || f.longitude !== before.longitude)) db.prepare('DELETE FROM weather_forecasts WHERE project_id = ?').run(id);
    updateRow(db, 'projects', id, f, b.row_version);
    audit(db, req.user, { project_id: id, entity_type: 'project', entity_id: id, action: 'update', before: pick(before, Object.keys(f)), after: f, module: 'projects' });
    if (f.name || f.site_address) { const a = db.prepare('SELECT p.code, p.name, p.site_address, c.name AS cn FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.id = ?').get(id); reindex(db, 'project', id, a.code, a.name, `${a.cn} ${a.site_address || ''}`); }
    for (const k of ['technical_id', 'brigadier_id']) if (f[k] !== undefined && f[k] !== before[k])
      emit(db, req.user, { type: 'project.assigned', origin: 'projects', project_id: id, entity_type: 'project', entity_id: id, prev: { [k]: before[k] }, next: { [k]: f[k] }, affected: ['technical', 'brigadier'] });
    // coarse status is stage-derived; the only manual writes are on_hold (pause) and resume (re-derive)
    if (b.status !== undefined) {
      if (b.status !== 'on_hold' && b.status !== 'resume') throw bad('Статусът следва етапите — възможни са само „on_hold“ (пауза) и „resume“ (възобновяване)');
      let next = before.status;
      if (b.status === 'on_hold' && before.status !== 'closed') next = 'on_hold';
      else if (b.status === 'resume' && before.status === 'on_hold') next = deriveProjectStatus(db, id);
      if (next !== before.status) {
        db.prepare('UPDATE projects SET status = ?, row_version = row_version + 1 WHERE id = ?').run(next, id);
        audit(db, req.user, { project_id: id, entity_type: 'project', entity_id: id, action: 'status', before: { status: before.status }, after: { status: next }, module: 'projects' });
      }
    }
    return { ok: true };
  })));
  // ---- weather at the project site (several independent sources, refreshed in the background and on demand)
  app.get('/api/projects/:id/weather', h(req => { need(req.user, 'projects'); needProject(db, req.user, req.params.id);
    return weatherView(db, Number(req.params.id), Number(req.query.days) === 14 ? 14 : 7); }));
  app.post('/api/projects/:id/weather/refresh', (req, res, next) => {
    try { need(req.user, 'projects'); needProject(db, req.user, req.params.id); } catch (e) { return next(e); }
    const id = Number(req.params.id);
    refreshProject(db, id, app.locals.fetch || fetch).then(results => res.json({ results, view: weatherView(db, id, Number(req.query.days) === 14 ? 14 : 7) }))
      .catch(e => next(new HttpError(422, e.message)));
  });

  /** Lifecycle is configurable per project: complete, skip, reopen, or add an extra step. */
  app.post('/api/projects/:id/stages', h(req => tx(db, () => {
    need(req.user, 'projects', 'write');
    const id = Number(req.params.id), b = req.body || {};
    if (b.add) {
      const sort = (db.prepare('SELECT sort FROM project_stages WHERE project_id = ? AND code = ?').get(id, b.after)?.sort ?? 9990) + 1;
      const code = `extra_${Date.now()}`;
      db.prepare('INSERT INTO project_stages(project_id, code, name, department, sort, requires_approval) VALUES (?,?,?,?,?,?)').run(id, code, String(b.add), b.department || null, sort, b.requires_approval ? 1 : 0);
      syncProjectStatus(db, id);
      audit(db, req.user, { project_id: id, entity_type: 'stage', action: 'add', after: b, module: 'projects' });
      return { ok: true, code };
    }
    const s = db.prepare('SELECT * FROM project_stages WHERE project_id = ? AND code = ?').get(id, b.code);
    if (!s) throw new HttpError(404, 'Няма такъв етап');
    if (!['pending', 'active', 'done', 'skipped'].includes(b.status)) throw bad('Невалиден статус');
    if (s.requires_approval && b.status === 'done') need(req.user, 'approvals', 'approve');
    setStage(db, id, b.code, b.status, req.user, b.note || null);
    audit(db, req.user, { project_id: id, entity_type: 'stage', entity_id: s.id, action: 'status', before: { status: s.status }, after: { status: b.status, note: b.note }, module: 'projects' });
    emit(db, req.user, { type: 'stage.changed', origin: 'projects', project_id: id, entity_type: 'stage', entity_id: s.id, prev: { code: s.code, status: s.status }, next: { code: s.code, name: s.name, status: b.status }, affected: [s.department].filter(Boolean) });
    return { ok: true };
  })));
  /** Archive is the explicit close: archived=1 + status 'closed'; unarchive re-derives from stages. */
  app.post('/api/projects/:id/archive', h(req => tx(db, () => {
    need(req.user, 'projects', 'write');
    const id = Number(req.params.id), want = req.body?.archived;
    if (typeof want !== 'boolean') throw bad('Посочете archived: true или false');
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!p) throw new HttpError(404, 'Обектът не е намерен');
    needProject(db, req.user, id);
    if (!!p.archived === want) return { ok: true, archived: p.archived, status: p.status };
    const next = want ? 'closed' : deriveProjectStatus(db, id);
    db.prepare('UPDATE projects SET archived = ?, status = ?, row_version = row_version + 1 WHERE id = ?').run(want ? 1 : 0, next, id);
    audit(db, req.user, { project_id: id, entity_type: 'project', entity_id: id, action: want ? 'archive' : 'unarchive',
      before: { archived: p.archived, status: p.status }, after: { archived: want ? 1 : 0, status: next }, module: 'projects' });
    return { ok: true, archived: want, status: next };
  })));
  app.get('/api/projects/:id/timeline', h(req => { need(req.user, 'projects'); needProject(db, req.user, req.params.id);
    return db.prepare(`SELECT e.id, e.type, e.origin_module, e.ts, e.status, e.approval_status, e.affected_modules, e.prev_value, e.new_value, e.last_error, u.full_name AS user_name
      FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE e.project_id = ? ORDER BY e.id DESC LIMIT 300`).all(req.params.id); }));
  app.get('/api/projects/:id/audit', h(req => { need(req.user, 'projects'); needProject(db, req.user, req.params.id);
    return db.prepare('SELECT a.*, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 500').all(req.params.id); }));

  // ---- engine visibility, notifications, search
  app.get('/api/events', h(req => { need(req.user, 'events'); return db.prepare(`SELECT e.*, p.code AS project_code, u.full_name AS user_name,
    (SELECT json_group_array(json_object('handler', handler, 'status', status, 'result', result)) FROM event_effects f WHERE f.event_id = e.id) AS effects
    FROM events e LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 300`).all(); }));
  app.post('/api/events/:id/retry', h(req => { need(req.user, 'events', 'write');
    const r = db.prepare("UPDATE events SET status = 'pending', attempts = 0, next_attempt_at = NULL WHERE id = ? AND status = 'failed'").run(req.params.id);
    if (!r.changes) throw bad('Само неуспешни събития могат да се повторят');
    audit(db, req.user, { entity_type: 'event', entity_id: Number(req.params.id), action: 'retry', module: 'events' });
    return { ok: true }; }));
  app.get('/api/notifications', h(req => db.prepare(`SELECT n.*, p.code AS project_code, (r.user_id IS NOT NULL) AS is_read FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ? WHERE n.user_id = ? OR n.department = ? ORDER BY n.id DESC LIMIT 200`)
    .all(req.user.id, req.user.id, req.user.department).filter(n => !n.project_id || visible(req.user, n.project_id))));
  app.post('/api/notifications/read', h(req => { const ins = db.prepare('INSERT INTO notification_reads(notification_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING');
    for (const id of req.body?.ids || []) ins.run(Number(id), req.user.id); return { ok: true }; }));
  app.get('/api/search', h(req => {
    const q = String(req.query.q || '').replace(/["*():^]/g, ' ').trim().split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(' ');
    if (!q) return [];
    const allowed = { project: 'projects', customer: 'customers', contract: 'contracts', offer: 'offers', product: 'catalog', smr: 'catalog' };
    return db.prepare('SELECT kind, ref_id, code, title, body FROM search_index WHERE search_index MATCH ? LIMIT 60').all(q)
      .filter(r => can(req.user, allowed[r.kind]) && (r.kind !== 'project' || visible(req.user, r.ref_id)));
  }));
}