// Справки — каталог от подбрани отчети, всеки sluggish data + параметри → таблица (+CSV от клиента).
// Само единото място, където "очите на админа" се хранят: dwell/penдинг анализаторът чете
// reminders_log, за да отговори „изпратено ли е напомняне, обърнато ли е внимание“.
import { can, need, HttpError, bad } from './core.js';
import { h } from './app.js';
import { finance, stock } from './calc.js';

const ageH = col => `CAST((julianday('now') - julianday(${col}))*24.0 AS INTEGER)`;
const parseTs = s => { if (!s) return null; const str = String(s); const norm = str.includes('T') ? str : str.includes(' ') ? str.replace(' ', 'T') + 'Z' : str + 'T00:00:00Z'; const t = Date.parse(norm); return isNaN(t) ? null : t; };

// ---- dwell: чакащи случаи по тип — pending_since, напомняния, отговорник, downstream ефект
const DWELL = {
  task: { label: 'Задача', pending: `t.status = 'open'`, since: 't.created_at', pcol: 't.project_id',
    sql: `SELECT t.id, t.code AS ref, t.title AS what, t.project_id, p.code AS pcode, t.status,
      t.created_at AS since, ${ageH('t.created_at')} AS age_h, t.due_date, u.full_name AS who, d.name AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'task' AND r.entity_id = t.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'task' AND r.entity_id = t.id) AS last_reminder,
      t.done_at AS resolved_at, '/projects/' || t.project_id AS link
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN departments d ON d.code = t.assignee_dept`,
    where: `t.status = 'open'` },
  stage: { label: 'Етап от жизнен цикъл', pending: `s.status = 'pending'`, since: 's.due_date', pcol: 's.project_id',
    sql: `SELECT s.id, s.code AS ref, s.name AS what, s.project_id, p.code AS pcode, s.status,
      s.due_date AS since, ${ageH('s.due_date')} AS age_h, s.due_date, d.name AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'stage' AND r.entity_id = s.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'stage' AND r.entity_id = s.id) AS last_reminder,
      s.done_at AS resolved_at, '/projects/' || s.project_id AS link,
      (SELECT COUNT(*) FROM project_stages x WHERE x.project_id = s.project_id AND x.sort > s.sort AND x.status = 'pending' AND x.due_date < date('now')) AS ripple_overdue
      FROM project_stages s JOIN projects p ON p.id = s.project_id LEFT JOIN departments d ON d.code = s.department`,
    where: `s.status = 'pending' AND s.due_date < date('now')` },
  delivery: { label: 'Доставка', pending: `d.status = 'planned'`, since: 'd.planned_date', pcol: 'd.project_id',
    sql: `SELECT d.id, d.code AS ref, d.kind AS what, d.project_id, p.code AS pcode, d.status,
      d.planned_date AS since, ${ageH('d.planned_date')} AS age_h, d.planned_date, 'Логистика' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'delivery' AND r.entity_id = d.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'delivery' AND r.entity_id = d.id) AS last_reminder,
      NULL AS resolved_at, '/logistics' AS link
      FROM deliveries d JOIN projects p ON p.id = d.project_id`,
    where: `d.status = 'planned' AND d.planned_date < date('now')` },
  material_request: { label: 'Заявка за материали', pending: `m.status IN ('submitted','approved')`, since: 'm.created_at', pcol: 'm.project_id',
    sql: `SELECT m.id, m.code AS ref, m.status AS what, m.project_id, p.code AS pcode, m.status,
      m.created_at AS since, ${ageH('m.created_at')} AS age_h, m.needed_by AS due, 'Склад' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'material_request' AND r.entity_id = m.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'material_request' AND r.entity_id = m.id) AS last_reminder,
      NULL AS resolved_at, '/warehouse' AS link
      FROM material_requests m JOIN projects p ON p.id = m.project_id`,
    where: `m.status IN ('submitted','approved')` },
  payment_request: { label: 'Заявка за плащане', pending: `pr.status = 'pending'`, since: 'pr.created_at', pcol: 'pr.project_id',
    sql: `SELECT pr.id, pr.code AS ref, pr.payee AS what, pr.project_id, p.code AS pcode, pr.status,
      pr.created_at AS since, ${ageH('pr.created_at')} AS age_h, NULL AS due, 'Управление' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'payment_request' AND r.entity_id = pr.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'payment_request' AND r.entity_id = pr.id) AS last_reminder,
      NULL AS resolved_at, '/accounting' AS link
      FROM payment_requests pr LEFT JOIN projects p ON p.id = pr.project_id`,
    where: `pr.status = 'pending'` },
  proforma: { label: 'Проформа', pending: `f.status = 'issued'`, since: 'f.due_on', pcol: 'f.project_id',
    sql: `SELECT f.id, f.code AS ref, f.kind AS what, f.project_id, p.code AS pcode, f.status,
      f.due_on AS since, ${ageH('f.due_on')} AS age_h, f.due_on, 'Счетоводство' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'proforma' AND r.entity_id = f.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'proforma' AND r.entity_id = f.id) AS last_reminder,
      NULL AS resolved_at, '/accounting' AS link
      FROM proformas f JOIN projects p ON p.id = f.project_id`,
    where: `f.status = 'issued' AND f.due_on < date('now')` },
  issue: { label: 'Проблем', pending: `i.status = 'open'`, since: 'i.created_at', pcol: 'i.project_id',
    sql: `SELECT i.id, i.code AS ref, i.title AS what, i.project_id, p.code AS pcode, i.status,
      i.created_at AS since, ${ageH('i.created_at')} AS age_h, i.severity AS due, d.name AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'issue' AND r.entity_id = i.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'issue' AND r.entity_id = i.id) AS last_reminder,
      i.resolved_at, CASE WHEN i.project_id IS NULL THEN '/brigade' ELSE '/brigade/' || i.project_id END AS link
      FROM issues i LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN departments d ON d.code = i.assigned_dept`,
    where: `i.status = 'open' AND i.severity IN ('high','critical')` },
  change_request: { label: 'Заявка за промяна', pending: `c.status = 'pending'`, since: 'c.created_at', pcol: 'NULL',
    sql: `SELECT c.id, c.code AS ref, c.entity_label AS what, NULL AS project_id, NULL AS pcode, c.status,
      c.created_at AS since, ${ageH('c.created_at')} AS age_h, NULL AS due, 'Управление' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'change_request' AND r.entity_id = c.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'change_request' AND r.entity_id = c.id) AS last_reminder,
      c.decided_at AS resolved_at, '/change-requests?scope=queue' AS link
      FROM change_requests c`,
    where: `c.status = 'pending'` },
  amendment: { label: 'Изменение към договор', pending: `a.status = 'pending'`, since: 'a.created_at', pcol: 'a.project_id',
    sql: `SELECT a.id, a.code AS ref, a.title AS what, a.project_id, p.code AS pcode, a.status,
      a.created_at AS since, ${ageH('a.created_at')} AS age_h, NULL AS due, 'Управление' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'amendment' AND r.entity_id = a.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'amendment' AND r.entity_id = a.id) AS last_reminder,
      a.decided_at AS resolved_at, '/projects/' || a.project_id AS link
      FROM amendments a JOIN projects p ON p.id = a.project_id`,
    where: `a.status = 'pending'` },
  project: { label: 'Обект чака договор', pending: `p.status = 'contract_pending'`, since: 'p.created_at', pcol: 'p.id',
    sql: `SELECT p.id, p.code AS ref, p.name AS what, p.id AS project_id, p.code AS pcode, p.status,
      p.created_at AS since, ${ageH('p.created_at')} AS age_h, p.planned_start AS due, 'Договори' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'project' AND r.entity_id = p.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'project' AND r.entity_id = p.id) AS last_reminder,
      NULL AS resolved_at, '/projects/' || p.id AS link
      FROM projects p`,
    where: `p.status = 'contract_pending' AND p.archived = 0` },
  approval: { label: 'Одобрение', pending: `a.status = 'pending'`, since: 'a.created_at', pcol: 'a.project_id',
    sql: `SELECT a.id, a.code AS ref, a.title AS what, a.project_id, p.code AS pcode, a.status,
      a.created_at AS since, ${ageH('a.created_at')} AS age_h, NULL AS due, 'Управление' AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'approval' AND r.entity_id = a.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'approval' AND r.entity_id = a.id) AS last_reminder,
      a.decided_at AS resolved_at, CASE WHEN a.project_id IS NULL THEN '/management' ELSE '/projects/' || a.project_id END AS link
      FROM approvals a LEFT JOIN projects p ON p.id = a.project_id`,
    where: `a.status = 'pending'` },
  event: { label: 'Събитие чака одобрение', pending: `e.approval_status = 'pending'`, since: 'e.ts', pcol: 'e.project_id',
    sql: `SELECT e.id, e.type AS ref, substr(COALESCE(e.new_value,''),1,80) AS what, e.project_id, p.code AS pcode, e.approval_status AS status,
      e.ts AS since, ${ageH('e.ts')} AS age_h, NULL AS due, e.origin_module AS dept,
      (SELECT COUNT(*) FROM reminders_log r WHERE r.entity_type = 'event' AND r.entity_id = e.id) AS reminders,
      (SELECT MAX(r.created_at) FROM reminders_log r WHERE r.entity_type = 'event' AND r.entity_id = e.id) AS last_reminder,
      e.processed_at AS resolved_at, CASE WHEN e.project_id IS NULL THEN '/management' ELSE '/projects/' || e.project_id END AS link
      FROM events e LEFT JOIN projects p ON p.id = e.project_id`,
    where: `e.approval_status = 'pending'` },
};

const DWELL_COLS = [
  { key: 'ref', label: '№' }, { key: 'what', label: 'Какво' }, { key: 'pcode', label: 'Обект' }, { key: 'status', label: 'Статус' },
  { key: 'since', label: 'Чака от', type: 'date' }, { key: 'age_h', label: 'Часа чака', num: true }, { key: 'due', label: 'Срок/приоритет' },
  { key: 'dept', label: 'Отговорник' }, { key: 'reminders', label: 'Напомняния', num: true }, { key: 'last_reminder', label: 'Последно напомняне', type: 'date' },
  { key: 'ripple_overdue', label: 'Закъсняли следващи етапи', num: true }, { key: 'link', label: 'Връзка', type: 'link' }];

function runDwell(db, q) {
  const type = String(q.entity || 'task');
  const d = DWELL[type];
  if (!d) throw bad('Невалиден тип случай');
  const pid = q.project_id ? Number(q.project_id) : null;
  const minH = Math.max(0, Number(q.min_hours ?? 0));
  const rows = db.prepare(`${d.sql} WHERE ${d.where} ${pid && d.pcol !== 'NULL' ? `AND ${d.pcol} = ?` : ''} ${minH ? `AND ${ageH(d.since)} >= ?` : ''} ORDER BY age_h DESC LIMIT 500`)
    .all(...[pid && d.pcol !== 'NULL' ? [pid] : [], minH ? [minH] : []].flat());
  return { title: `Забавени случаи — ${d.label}`, cols: DWELL_COLS.filter(c => !(c.key === 'ripple_overdue' && type !== 'stage')),
    rows: rows.map(r => ({ ...r, link: r.link ? r.link : null })) };
}

function runVariance(db, q) {
  const pid = q.project_id ? Number(q.project_id) : null;
  const lines = db.prepare(`SELECT l.id, l.project_id, l.code, l.description, l.unit, l.qty, p.code AS pcode, p.name AS pname,
      ol.planned_days, ol.labour_days,
      (SELECT COUNT(DISTINCT pe.work_date) FROM progress_entries pe WHERE pe.project_line_id = l.id AND pe.voided = 0) AS actual_days,
      (SELECT COUNT(DISTINCT pe.work_date) FROM progress_entries pe WHERE pe.project_line_id = l.id AND pe.voided = 0) AS days,
      (SELECT MIN(pe.work_date) FROM progress_entries pe WHERE pe.project_line_id = l.id AND pe.voided = 0) AS first_day,
      (SELECT MAX(pe.work_date) FROM progress_entries pe WHERE pe.project_line_id = l.id AND pe.voided = 0) AS last_day,
      (SELECT COALESCE(SUM(CAST(julianday(s.baseline_end) - julianday(s.baseline_start) + 1 AS INTEGER)), 0) FROM schedule_items s WHERE s.project_line_id = l.id AND s.baseline_start IS NOT NULL AND s.baseline_end IS NOT NULL) AS sched_days
      FROM project_lines l JOIN projects p ON p.id = l.project_id
      LEFT JOIN offer_lines ol ON ol.id = l.source_offer_line_id
      WHERE l.removed = 0 ${pid ? 'AND l.project_id = ?' : ''} ORDER BY l.project_id, l.sort, l.id`).all(...(pid ? [pid] : []));
  const planned = l => l.planned_days ?? (l.sched_days || null);
  const rows = lines.map(l => {
    const pl = planned(l);
    return { project: `${l.pcode} — ${l.pname}`, line: l.code || `#${l.id}`, description: String(l.description || '').slice(0, 80),
      qty: l.qty, unit: l.unit, planned_days: pl, actual_days: l.actual_days || 0, first_day: l.first_day, last_day: l.last_day,
      variance_days: pl != null && l.actual_days ? l.actual_days - pl : null,
      over: pl != null && l.actual_days > pl };
  });
  const crew = db.prepare(`SELECT pr.code AS pcode, a.team, COUNT(DISTINCT a.work_date) AS days, ROUND(SUM(a.hours),1) AS hours,
      COUNT(DISTINCT a.worker) AS workers, COUNT(*) AS entries
    FROM attendance a JOIN projects pr ON pr.id = a.project_id ${pid ? 'WHERE a.project_id = ?' : ''}
    GROUP BY a.project_id, a.team ORDER BY a.project_id, hours DESC`).all(...(pid ? [pid] : []));
  return { title: 'Планово vs фактическо изпълнение', cols: [
      { key: 'project', label: 'Обект' }, { key: 'line', label: 'Ред' }, { key: 'description', label: 'Описание' }, { key: 'qty', label: 'Количество', num: true },
      { key: 'planned_days', label: 'Планови дни', num: true }, { key: 'actual_days', label: 'Работни дни', num: true },
      { key: 'first_day', label: 'Първи ден', type: 'date' }, { key: 'last_day', label: 'Последен ден', type: 'date' },
      { key: 'variance_days', label: 'Отклонение', num: true }],
    rows,
    sections: [{ title: 'Екипи — присъствие (часове/дни/хора)', cols: [
      { key: 'pcode', label: 'Обект' }, { key: 'team', label: 'Екип' }, { key: 'days', label: 'Дни', num: true },
      { key: 'hours', label: 'Часове', num: true }, { key: 'workers', label: 'Хора', num: true }, { key: 'entries', label: 'Записа', num: true }], rows: crew }] };
}

function runExceptions(db, q) {
  const minH = Math.max(0, Number(q.min_hours ?? 12));
  const items = [];
  const push = (kind, ref, what, project, dept, since, link, sev = '') => { const t = parseTs(since);
    items.push({ kind, ref, what, project, dept, since, age_h: t == null ? null : Math.round((Date.now() - t) / 36e5), sev, link }); };
  for (const i of db.prepare(`SELECT i.*, p.code AS pcode FROM issues i LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.status = 'open' AND i.severity IN ('high','critical')`).all())
    push('Проблем', i.code, i.title, i.pcode, i.assigned_dept, i.created_at, i.project_id ? `/brigade/${i.project_id}` : '/brigade', i.severity);
  for (const e of db.prepare(`SELECT e.*, p.code AS pcode FROM events e LEFT JOIN projects p ON p.id = e.project_id WHERE e.status = 'failed'`).all())
    push('Неуспешна синхронизация', '#' + e.id, e.type, e.pcode, e.origin_module, e.ts, e.project_id ? `/projects/${e.project_id}` : '/settings');
  for (const t of db.prepare(`SELECT t.*, p.code AS pcode FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.status = 'open' AND t.due_date < date('now')`).all())
    push('Просрочена задача', t.code, t.title, t.pcode, t.assignee_dept, t.due_date, t.project_id ? `/projects/${t.project_id}` : '/');
  for (const a of db.prepare(`SELECT a.*, p.code AS pcode FROM approvals a LEFT JOIN projects p ON p.id = a.project_id WHERE a.status = 'pending'`).all())
    push('Одобрение', a.code, a.title, a.pcode, 'Управление', a.created_at, a.project_id ? `/projects/${a.project_id}` : '/management');
  for (const c of db.prepare('SELECT * FROM change_requests WHERE status = ?').all('pending'))
    push('Заявка за промяна', c.code, c.entity_label, null, 'Управление', c.created_at, '/change-requests?scope=queue');
  for (const d of db.prepare(`SELECT d.*, p.code AS pcode FROM deliveries d JOIN projects p ON p.id = d.project_id WHERE d.status = 'planned' AND d.planned_date < date('now')`).all())
    push('Закъсняла доставка', d.code, d.kind, d.pcode, 'Логистика', d.planned_date, '/logistics');
  for (const m of db.prepare(`SELECT m.*, p.code AS pcode FROM material_requests m JOIN projects p ON p.id = m.project_id WHERE m.status = 'submitted'`).all())
    push('Заявка за материали', m.code, m.status, m.pcode, 'Склад', m.created_at, '/warehouse');
  for (const f of db.prepare(`SELECT f.*, p.code AS pcode FROM proformas f JOIN projects p ON p.id = f.project_id WHERE f.status = 'issued' AND f.due_on < date('now')`).all())
    push('Проформа с изтекъл падеж', f.code, f.kind, f.pcode, 'Счетоводство', f.due_on, '/accounting');
  for (const p of db.prepare(`SELECT id, code, name, created_at FROM projects WHERE status = 'contract_pending' AND archived = 0 AND created_at < datetime('now', ?)`).all(`-${minH} hours`))
    push('Обект чака договор', p.code, p.name, null, 'Договори', p.created_at, `/projects/${p.id}`);
  for (const s of stock(db).filter(s => s.on_hand < 0))
    push('Отрицателен склад', s.code, s.name, null, 'Склад', null, '/warehouse', 'high');
  const rows = items.filter(i => i.age_h == null || i.age_h >= minH)
    .sort((a, b) => (b.age_h ?? 0) - (a.age_h ?? 0)).slice(0, 500);
  return { title: `Изключения и закъснения (>${minH}ч)`, cols: [
      { key: 'kind', label: 'Вид' }, { key: 'sev', label: 'Тежест' }, { key: 'ref', label: '№' }, { key: 'what', label: 'Какво' },
      { key: 'project', label: 'Обект' }, { key: 'dept', label: 'Отговорник' }, { key: 'since', label: 'От', type: 'date' },
      { key: 'age_h', label: 'Часа', num: true }, { key: 'link', label: 'Връзка', type: 'link' }], rows };
}

function runFinance(db, q) {
  const pid = q.project_id ? Number(q.project_id) : null;
  const projs = db.prepare(`SELECT p.id, p.code, p.name, p.status, c.name AS customer FROM projects p JOIN customers c ON c.id = p.customer_id
    WHERE p.archived = 0 ${pid ? 'AND p.id = ?' : ''} ORDER BY p.id DESC`).all(...(pid ? [pid] : []));
  const rows = projs.map(p => { const f = finance(db, p.id); const ps = f.progress_pct;
    return { project: `${p.code} — ${p.name}`, customer: p.customer, status: p.status, progress_pct: ps,
      contract_value: f.contract_value, invoiced: f.invoiced, received: f.payments_received, payables: f.payables,
      receivables: f.receivables, result_to_date: f.result_to_date, forecast_result: f.forecast_result,
      work_not_invoiced: f.work_not_invoiced, cost_variance: f.cost_variance }; });
  return { title: 'Финансов преглед по обекти', cols: [
      { key: 'project', label: 'Обект' }, { key: 'customer', label: 'Клиент' }, { key: 'status', label: 'Статус' }, { key: 'progress_pct', label: 'Прогрес %', num: true },
      { key: 'contract_value', label: 'Договор', num: true }, { key: 'invoiced', label: 'Фактурирано', num: true }, { key: 'received', label: 'Получено', num: true },
      { key: 'receivables', label: 'Вземания', num: true }, { key: 'payables', label: 'Задължения', num: true },
      { key: 'result_to_date', label: 'Резултат до сега', num: true }, { key: 'forecast_result', label: 'Прогнозен резултат', num: true },
      { key: 'work_not_invoiced', label: 'Извършено, нефактурирано', num: true }, { key: 'cost_variance', label: 'Отклонение разходи', num: true }], rows };
}

function runAttendance(db, q) {
  const pid = q.project_id ? Number(q.project_id) : null;
  const from = q.from || '2000-01-01', to = q.to || '2100-01-01';
  const rows = db.prepare(`SELECT p.code AS project, substr(a.work_date, 1, 7) AS month, a.team,
      COUNT(DISTINCT a.work_date) AS days, ROUND(SUM(a.hours), 1) AS hours, COUNT(DISTINCT a.worker) AS workers, COUNT(*) AS entries
    FROM attendance a JOIN projects p ON p.id = a.project_id
    WHERE a.work_date BETWEEN ? AND ? ${pid ? 'AND a.project_id = ?' : ''}
    GROUP BY a.project_id, month, a.team ORDER BY month DESC, project, hours DESC`).all(from, to, ...(pid ? [pid] : []));
  return { title: 'Присъствие по екипи и месеци', cols: [
      { key: 'month', label: 'Месец' }, { key: 'project', label: 'Обект' }, { key: 'team', label: 'Екип' },
      { key: 'days', label: 'Дни', num: true }, { key: 'hours', label: 'Часове', num: true }, { key: 'workers', label: 'Хора', num: true }, { key: 'entries', label: 'Записа', num: true }], rows };
}

const REPORTS = {
  dwell: { title: 'Забавени и чакащи случаи', desc: 'Колко дълго всеки случай стои в чакащо състояние — колко напомняния е получил, дали е обърнато внимание, кой отговаря и какъв е закъснялия ефект надолу по веригата.',
    params: [{ key: 'entity', label: 'Тип случай', type: 'select', options: Object.entries(DWELL).map(([k, v]) => [k, v.label]) },
      { key: 'project_id', label: 'Обект (по избор)', type: 'project' }, { key: 'min_hours', label: 'Минимум часове чака', type: 'number' }], run: runDwell },
  variance: { title: 'Планово vs фактическо (дни)', desc: 'Планираните дни от офертата/графика срещу реалните работни дни по всеки КС ред — плюс преглед на екипите по часове. Тук се вижда „екипът постоянно закъснява с 2 дни“.',
    params: [{ key: 'project_id', label: 'Обект (по избор)', type: 'project' }], run: runVariance },
  exceptions: { title: 'Изключения и закъснения', desc: 'Всички отворени проблеми, неуспешни синхронизации, просрочени задачи/доставки/проформи, чакащи одобрения и заявки, отрицателен склад — с възраст и отговорник.',
    params: [{ key: 'min_hours', label: 'Минимална възраст (часове)', type: 'number' }], run: runExceptions },
  finance: { title: 'Финансов преглед по обекти', desc: 'Договор, фактурирано, получено, вземания, резултат до сега и прогноза — за целия портфейл или един обект. Паричните колони изискват finance права.',
    params: [{ key: 'project_id', label: 'Обект (по избор)', type: 'project' }], money: true, run: runFinance },
  attendance: { title: 'Присъствие по екипи', desc: 'Часове, дни и хора по екип/обект/месец — основата за надничарските разчети и за анализа на натоварването.',
    params: [{ key: 'project_id', label: 'Обект (по избор)', type: 'project' }, { key: 'from', label: 'От', type: 'date' }, { key: 'to', label: 'До', type: 'date' }], run: runAttendance },
};

export default function mountReports(app, db) {
  app.get('/api/reports', h(req => { need(req.user, 'reports');
    return Object.entries(REPORTS).map(([id, r]) => ({ id, title: r.title, desc: r.desc, params: r.params, money: !!r.money })); }));
  app.get('/api/reports/:id', h(req => {
    need(req.user, 'reports');
    const r = REPORTS[String(req.params.id)];
    if (!r) throw new HttpError(404, 'Няма такава справка');
    if (r.money && !can(req.user, 'finance')) throw new HttpError(403, 'Тази справка изисква финансови права');
    const out = r.run(db, req.query || {});
    return { id: req.params.id, title: out.title, cols: out.cols, rows: out.rows, sections: out.sections || [] };
  }));
}
