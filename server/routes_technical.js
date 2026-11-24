// Техник: работно място, задачи, линеен график, дневен прогрес, разход на материали.
import crypto from 'node:crypto';
import { tx, nextCode } from './db.js';
import { HttpError, bad, need, can, needProject, canSeeProject, audit, updateRow, emit, setting } from './core.js';
import { progressSummary, consumption, scheduleStatus } from './calc.js';
import { h, pick, num, reqStr } from './app.js';
import { setStage } from './domain.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const reqDate = (v, label, { required = true } = {}) => {
  if (v == null || v === '') { if (required) throw bad(`Полето „${label}“ е задължително`); return null; }
  const s = String(v);
  if (!DATE.test(s) || isNaN(Date.parse(s))) throw bad(`Невалидна дата за „${label}“`);
  return s;
};

export default function mountTechnical(app, db) {
  const project = id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const needP = (req, res = 'technical', action = 'read') => { need(req.user, res, action); needProject(db, req.user, Number(req.params.pid ?? req.params.id)); };

  // ---- Работно място: обекти в подготовка/изпълнение, задачи към техник, отворени проблеми
  app.get('/api/technical', h(req => {
    need(req.user, 'technical');
    const rows = db.prepare(`SELECT p.*, c.name AS customer_name, t.full_name AS technical_name, b.full_name AS brigadier_name
      FROM projects p JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users t ON t.id = p.technical_id LEFT JOIN users b ON b.id = p.brigadier_id
      WHERE p.archived = 0 AND p.status NOT IN ('closed', 'completed') ORDER BY p.status = 'execution' DESC, p.id DESC`).all();
    const openIssues = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(severity IN ('high','critical')), 0) crit FROM issues WHERE status = 'open' AND project_id = ?");
    const stage = db.prepare("SELECT status FROM project_stages WHERE project_id = ? AND code IN ('technical_review','site_validation','resource_planning','schedule','execution','daily_reporting','consumption_tracking','completion') ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, sort LIMIT 1");
    const projects = rows.filter(p => canSeeProject(db, req.user, p.id)).map(p => {
      const s = progressSummary(db, p.id);
      const sched = scheduleStatus(db, p.id);
      const iss = openIssues.get(p.id) || { n: 0, crit: 0 };
      const st = stage.get(p.id);
      return { ...p, progress_pct: s.progress_pct, contract_value: can(req.user, 'finance') ? s.contract_value : null,
        open_issues: iss.n, critical_issues: iss.crit || 0,
        overdue_items: sched.filter(x => x.late_days > 0 || x.behind).length,
        next_end: sched.find(x => x.pct == null || x.pct < 100)?.end_date || null,
        tech_stage: st?.status || null };
    });
    const tasks = db.prepare(`SELECT t.*, p.code AS project_code, p.name AS project_name, u.full_name AS assignee_name, cb.full_name AS created_by_name
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cb ON cb.id = t.created_by
      WHERE t.status = 'open' AND (t.assignee_dept = 'technical' OR t.assignee_id = ? OR t.assignee_dept = ?) ORDER BY t.due_date IS NULL, t.due_date, t.id DESC LIMIT 100`)
      .all(req.user.id, req.user.department).filter(t => !t.project_id || canSeeProject(db, req.user, t.project_id));
    const issues = db.prepare(`SELECT i.*, p.code AS project_code, p.name AS project_name, pr.code AS product_code, pr.name AS product_name
      FROM issues i JOIN projects p ON p.id = i.project_id LEFT JOIN products pr ON pr.id = i.product_id
      WHERE i.status = 'open' AND (i.assigned_dept IN ('technical', ?) OR i.assigned_dept IS NULL) ORDER BY i.severity = 'critical' DESC, i.severity = 'high' DESC, i.id DESC LIMIT 100`)
      .all(req.user.department).filter(i => canSeeProject(db, req.user, i.project_id));
    return { projects, tasks, issues };
  }));

  // ---- Задачи (създаване към отдел/човек; отчитане на изпълнение)
  /** Per-project tasks + issues bundle for the Project Card "Задачи" tab. */
  app.get('/api/projects/:pid/tasks', h(req => {
    needP(req, 'tasks');
    const pid = Number(req.params.pid);
    return {
      tasks: db.prepare(`SELECT t.*, u.full_name AS assignee_name, ub.full_name AS created_by_name FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users ub ON ub.id = t.created_by
        WHERE t.project_id = ? ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.id DESC LIMIT 200`).all(pid),
      issues: db.prepare(`SELECT i.id, i.code, i.kind, i.severity, i.title, i.status, i.resolution, i.created_at, d.name AS assigned_dept_name
        FROM issues i LEFT JOIN departments d ON d.code = i.assigned_dept WHERE i.project_id = ? ORDER BY i.status = 'open' DESC, i.id DESC LIMIT 100`).all(pid)
    };
  }));
  app.post('/api/tasks', h(req => tx(db, () => {
    need(req.user, 'tasks', 'write');
    const b = req.body || {};
    const title = reqStr(b.title, 'Заглавие');
    const pid = b.project_id == null ? null : Number(b.project_id);
    if (pid != null) { if (!project(pid)) throw new HttpError(404, 'Обектът не е намерен'); needProject(db, req.user, pid); }
    if (b.assignee_id != null && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(Number(b.assignee_id))) throw bad('Няма такъв служител');
    if (b.assignee_dept != null && !db.prepare('SELECT 1 FROM departments WHERE code = ?').get(String(b.assignee_dept))) throw bad('Няма такъв отдел');
    const due = reqDate(b.due_date, 'Срок', { required: false });
    const code = nextCode(db, 'TSK');
    const id = Number(db.prepare(`INSERT INTO tasks(code, project_id, title, description, assignee_id, assignee_dept, due_date, priority, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(code, pid, title, b.description || null, b.assignee_id ?? null, b.assignee_dept || null, due,
      ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : 'normal', req.user.id).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'task', entity_id: id, action: 'create', after: { code, title }, module: 'tasks' });
    if (b.assignee_id || b.assignee_dept) emit(db, req.user, { type: 'task.assigned', origin: 'tasks', project_id: pid, entity_type: 'task', entity_id: id,
      dedupe_key: `task.assigned:${id}`, next: { code, title, assignee_id: b.assignee_id ?? null, assignee_dept: b.assignee_dept || null },
      affected: [b.assignee_dept].filter(Boolean) });
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  })));
  app.post('/api/tasks/:id/:action', h(req => tx(db, () => {
    need(req.user, 'tasks', 'write');
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params.id));
    if (!t) throw new HttpError(404, 'Няма такава задача');
    const status = req.params.action === 'done' ? 'done' : req.params.action === 'reopen' ? 'open' : null;
    if (!status) throw bad('Непозната операция');
    if (t.status === status) throw bad(status === 'done' ? 'Задачата вече е изпълнена' : 'Задачата вече е отворена');
    db.prepare("UPDATE tasks SET status = ?, done_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE NULL END WHERE id = ?").run(status, status, t.id);
    audit(db, req.user, { project_id: t.project_id, entity_type: 'task', entity_id: t.id, action: status, before: { status: t.status }, after: { status }, module: 'tasks' });
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id);
  })));

  // ---- Линеен график
  app.get('/api/projects/:pid/schedule', h(req => {
    needP(req);
    const pid = Number(req.params.pid);
    return { items: scheduleStatus(db, pid), deadline: db.prepare('SELECT install_deadline FROM contracts WHERE project_id = ?').get(pid)?.install_deadline || null,
      lines: db.prepare('SELECT id, code, description, unit, qty FROM project_lines WHERE project_id = ? AND removed = 0 ORDER BY sort, id').all(pid) };
  }));
  app.post('/api/projects/:pid/schedule', h(req => tx(db, () => {
    needP(req, 'technical', 'write');
    const pid = Number(req.params.pid), b = req.body || {};
    const name = reqStr(b.name, 'Дейност');
    const start = reqDate(b.start_date, 'Начало', { required: false }), end = reqDate(b.end_date, 'Край', { required: false });
    if (start && end && end < start) throw bad('Крайната дата е преди началната');
    if (b.project_line_id != null && !db.prepare('SELECT 1 FROM project_lines WHERE id = ? AND project_id = ? AND removed = 0').get(Number(b.project_line_id), pid)) throw bad('Няма такъв ред от КС');
    if (b.depends_on != null && !db.prepare('SELECT 1 FROM schedule_items WHERE id = ? AND project_id = ?').get(Number(b.depends_on), pid)) throw bad('Няма такава зависима дейност');
    const sort = (db.prepare('SELECT MAX(sort) s FROM schedule_items WHERE project_id = ?').get(pid).s || 0) + 10;
    const id = Number(db.prepare('INSERT INTO schedule_items(project_id, project_line_id, name, sort, start_date, end_date, depends_on, crew) VALUES (?,?,?,?,?,?,?,?)')
      .run(pid, b.project_line_id ?? null, name, sort, start, end, b.depends_on ?? null, b.crew || null).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'schedule_item', entity_id: id, action: 'create', after: { name, start, end }, module: 'technical' });
    emit(db, req.user, { type: 'schedule.changed', origin: 'technical', project_id: pid, entity_type: 'schedule_item', entity_id: id,
      next: { name, start_date: start, end_date: end, added: true }, affected: ['brigadier', 'logistics'] });
    return { id };
  })));
  app.patch('/api/schedule-items/:id', h(req => tx(db, () => {
    need(req.user, 'technical', 'write');
    const s = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(Number(req.params.id));
    if (!s) throw new HttpError(404, 'Няма такава дейност');
    needProject(db, req.user, s.project_id);
    const b = req.body || {};
    const f = pick(b, ['name', 'start_date', 'end_date', 'depends_on', 'crew']);
    for (const k of ['start_date', 'end_date']) if (f[k] !== undefined && f[k] !== null) f[k] = reqDate(f[k], k === 'start_date' ? 'Начало' : 'Край');
    const start = f.start_date !== undefined ? f.start_date : s.start_date, end = f.end_date !== undefined ? f.end_date : s.end_date;
    if (start && end && end < start) throw bad('Крайната дата е преди началната');
    if (f.depends_on != null) {
      if (Number(f.depends_on) === s.id) throw bad('Дейността не може да зависи от себе си');
      if (!db.prepare('SELECT 1 FROM schedule_items WHERE id = ? AND project_id = ?').get(Number(f.depends_on), s.project_id)) throw bad('Няма такава зависима дейност');
    }
    if (b.sort !== undefined) f.sort = num(b.sort, 'Ред');
    updateRow(db, 'schedule_items', s.id, f, b.row_version);
    audit(db, req.user, { project_id: s.project_id, entity_type: 'schedule_item', entity_id: s.id, action: 'update', before: pick(s, Object.keys(f)), after: f, module: 'technical' });
    emit(db, req.user, { type: 'schedule.changed', origin: 'technical', project_id: s.project_id, entity_type: 'schedule_item', entity_id: s.id,
      prev: { name: s.name, start_date: s.start_date, end_date: s.end_date }, next: { name: f.name ?? s.name, start_date: start, end_date: end },
      affected: ['brigadier', 'logistics'] });
    return { ok: true };
  })));

  // ---- Дневен прогрес (въвежда Техник; полевият екран на Бригадир е отделна фаза)
  app.get('/api/projects/:pid/progress', h(req => {
    needP(req, 'progress');
    const pid = Number(req.params.pid);
    const rawLines = progressSummary(db, pid).lines;
    const docIds = [...new Set(rawLines.map(l => l.image_document_id).filter(Boolean))];
    const specUrl = new Map(docIds.length ? db.prepare(`SELECT v.document_id, v.id AS vid FROM document_versions v
        WHERE v.version = (SELECT MAX(version) FROM document_versions WHERE document_id = v.document_id) AND v.document_id IN (${docIds.map(() => '?').join(',')})`)
        .all(...docIds).map(r => [r.document_id, `/api/documents/${r.vid}/file`]) : []);
    return { lines: rawLines.map(l => ({ id: l.id, code: l.code, description: l.description, unit: l.unit, qty: l.qty, done_qty: l.done_qty, pct: l.qty > 0 ? Math.min(100, Math.round(l.done_qty / l.qty * 1000) / 10) : null,
        spec_url: l.image_document_id ? specUrl.get(l.image_document_id) || null : null })),
      entries: db.prepare(`SELECT e.*, l.description AS line_description, l.unit, u.full_name AS reported_by_name FROM progress_entries e
        JOIN project_lines l ON l.id = e.project_line_id LEFT JOIN users u ON u.id = e.reported_by WHERE e.project_id = ? ORDER BY e.work_date DESC, e.id DESC LIMIT 300`).all(pid) };
  }));
  app.post('/api/projects/:pid/progress', h(req => tx(db, () => {
    needP(req, 'progress', 'write');
    const pid = Number(req.params.pid), b = req.body || {};
    const line = db.prepare('SELECT * FROM project_lines WHERE id = ? AND project_id = ? AND removed = 0').get(Number(b.project_line_id), pid);
    if (!line) throw bad('Няма такъв ред от КС за този обект');
    const qty = num(b.qty, 'Количество', { min: 0.000001 });
    const workDate = reqDate(b.work_date, 'Дата');
    const uid = typeof b.uid === 'string' && b.uid.trim() ? b.uid.trim().slice(0, 80) : crypto.randomUUID();
    const r = db.prepare('INSERT INTO progress_entries(uid, project_id, project_line_id, work_date, qty, note, reported_by) VALUES (?,?,?,?,?,?,?) ON CONFLICT(uid) DO NOTHING')
      .run(uid, pid, line.id, workDate, qty, b.note || null, req.user.id);
    const entry = db.prepare('SELECT * FROM progress_entries WHERE uid = ?').get(uid);
    // warn-and-allow: cumulative done above the contract qty is flagged, never blocked (extra work is real)
    const doneQty = db.prepare('SELECT COALESCE(SUM(qty),0) AS d FROM progress_entries WHERE project_line_id = ? AND voided = 0').get(line.id).d;
    const over = line.qty > 0 && doneQty - line.qty > 0.0001
      ? { contract_qty: line.qty, done_qty: Math.round(doneQty * 10000) / 10000, excess: Math.round((doneQty - line.qty) * 10000) / 10000 }
      : null;
    if (!r.changes) return { entry, deduped: true, over_contract: over };
    audit(db, req.user, { project_id: pid, entity_type: 'progress_entry', entity_id: entry.id, action: 'create', after: { line: line.id, qty, work_date: workDate, uid }, module: 'technical' });
    // first recorded work starts execution: actual start = earliest work date, stage execution becomes active
    db.prepare('UPDATE projects SET actual_start = MIN(COALESCE(actual_start, ?), ?), row_version = row_version + 1 WHERE id = ?').run(workDate, workDate, pid);
    setStage(db, pid, 'execution', 'active', req.user);
    emit(db, req.user, { type: 'progress.recorded', origin: 'technical', project_id: pid, entity_type: 'project_line', entity_id: line.id,
      dedupe_key: `progress.recorded:${uid}`, next: { entry_id: entry.id, line: line.description, qty, work_date: workDate },
      affected: ['accounting', 'management', 'technical'] });
    return { entry, deduped: false, over_contract: over };
  })));
  app.post('/api/progress-entries/:id/void', h(req => tx(db, () => {
    need(req.user, 'progress', 'write');
    const e = db.prepare('SELECT * FROM progress_entries WHERE id = ?').get(Number(req.params.id));
    if (!e) throw new HttpError(404, 'Няма такъв запис');
    needProject(db, req.user, e.project_id);
    if (e.voided) throw bad('Записът вече е анулиран');
    db.prepare('UPDATE progress_entries SET voided = 1 WHERE id = ?').run(e.id);
    audit(db, req.user, { project_id: e.project_id, entity_type: 'progress_entry', entity_id: e.id, action: 'void', before: { qty: e.qty, work_date: e.work_date }, after: { voided: 1 }, module: 'technical' });
    emit(db, req.user, { type: 'progress.voided', origin: 'technical', project_id: e.project_id, entity_type: 'project_line', entity_id: e.project_line_id,
      dedupe_key: `progress.voided:${e.id}`, prev: { entry_id: e.id, qty: e.qty, work_date: e.work_date }, next: { voided: 1 }, affected: ['accounting'] });
    return { ok: true };
  })));

  // ---- Разход на материали: планирано по рецепта срещу реално от склада
  // количествената сметка е споделен запис — Логистика я чете за планиране на доставки
  app.get('/api/projects/:pid/consumption', h(req => {
    needP(req, can(req.user, 'technical') ? 'technical' : 'logistics');
    return { rows: consumption(db, Number(req.params.pid), Number(setting(db, 'overconsumption_tolerance_pct', '5'))),
      tolerance_pct: Number(setting(db, 'overconsumption_tolerance_pct', '5')) };
  }));
}
