// Автоматични напомняния: случай, който чака повече от 12 часа, известява отговорния
// отдел/потребител. Всяко изпращане се записва в reminders_log (дедупликация: 1/ден/случай)
// — това е историческата основа, върху която отчетите мерят „изпратено ли е, Attention ли е обърнато“.
import { audit } from './core.js';
import { proformaOpenSql } from './payments.js';

const HOUR_MS = 3600e3;
const THRESHOLD_H = 12;
const BUCKET_SQL = `CAST(strftime('%s','now')/86400 AS INTEGER)`;

// kind → { label, link, severity, targets(db,row) → {departments, users} }
const WATCHDOGS = [
  { kind: 'approval_event', entity: 'event', label: 'Събитие очаква одобрение',
    sql: `SELECT e.id, e.type, e.project_id, e.ts FROM events e WHERE e.approval_status = 'pending'
      AND e.ts < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: r => r.project_id ? `/projects/${r.project_id}` : '/management',
    targets: () => ({ departments: ['management'], users: [] }) },
  { kind: 'approval_row', entity: 'approval', label: 'Одобрение чака решение',
    sql: `SELECT a.id, a.code, a.title, a.project_id FROM approvals a WHERE a.status = 'pending'
      AND a.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: r => r.project_id ? `/projects/${r.project_id}` : '/management',
    targets: () => ({ departments: ['management'], users: [] }) },
  { kind: 'task_open', entity: 'task', label: 'Задача е отворена',
    sql: `SELECT t.id, t.code, t.title, t.project_id, t.assignee_id, t.assignee_dept, t.due_date, t.created_at FROM tasks t
      WHERE t.status = 'open' AND (t.due_date < date('now') OR t.created_at < datetime('now', ?))`,
    args: [`-${THRESHOLD_H} hours`], link: r => r.project_id ? `/projects/${r.project_id}` : '/',
    targets: r => r.assignee_id ? { departments: [], users: [r.assignee_id] } : { departments: [r.assignee_dept].filter(Boolean), users: [] } },
  { kind: 'stage_pending', entity: 'stage', label: 'Етап от жизнения цикъл закъснява',
    sql: `SELECT s.id, s.name, s.project_id, s.department, s.due_date FROM project_stages s
      WHERE s.status = 'pending' AND s.due_date IS NOT NULL AND s.due_date < date('now')`,
    args: [], link: r => `/projects/${r.project_id}`, targets: r => ({ departments: [r.department || 'management'].filter(Boolean), users: [] }) },
  { kind: 'delivery_planned', entity: 'delivery', label: 'Доставка не е изпратена',
    sql: `SELECT d.id, d.code, d.project_id, d.planned_date FROM deliveries d WHERE d.status = 'planned'
      AND d.planned_date IS NOT NULL AND d.planned_date < date('now')`,
    args: [], link: () => '/logistics', targets: () => ({ departments: ['logistics'], users: [] }) },
  { kind: 'material_request', entity: 'material_request', label: 'Заявка за материали чака обработка',
    sql: `SELECT m.id, m.code, m.project_id, m.needed_by FROM material_requests m WHERE m.status = 'submitted'
      AND m.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: r => r.project_id ? `/projects/${r.project_id}` : '/warehouse',
    targets: () => ({ departments: ['warehouse'], users: [] }) },
  { kind: 'payment_request', entity: 'payment_request', label: 'Заявка за плащане чака одобрение',
    sql: `SELECT p.id, p.code, p.amount, p.payee, p.project_id FROM payment_requests p WHERE p.status = 'pending'
      AND p.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: () => '/accounting', targets: () => ({ departments: ['management'], users: [] }) },
  { kind: 'payment_reported', entity: 'transaction', label: 'Докладвано плащане чака потвърждение',
    sql: `SELECT t.id, t.code, t.project_id FROM transactions t WHERE t.status = 'reported' AND t.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: () => '/accounting?tab=confirm', targets: () => ({ departments: ['accounting'], users: [] }) },
  { kind: 'proforma_due', entity: 'proforma', label: 'Проформа с изтекъл падеж',
    sql: `SELECT p.id, p.code, p.amount, p.due_on, p.project_id FROM proformas p WHERE ${proformaOpenSql('p')}
      AND p.due_on IS NOT NULL AND p.due_on < date('now')`,
    args: [], link: () => '/accounting', targets: () => ({ departments: ['accounting'], users: [] }) },
  { kind: 'issue_open', entity: 'issue', label: 'Критичен проблем е отворен',
    sql: `SELECT i.id, i.code, i.title, i.project_id, i.assigned_dept, i.created_at FROM issues i
      WHERE i.status = 'open' AND i.severity IN ('high','critical') AND i.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: r => r.project_id ? `/brigade/${r.project_id}` : '/brigade',
    targets: r => ({ departments: [r.assigned_dept || 'technical'].filter(Boolean), users: [] }) },
  { kind: 'change_request', entity: 'change_request', label: 'Заявка за промяна чака администратор',
    sql: `SELECT c.id, c.code, c.entity_label, c.kind FROM change_requests c WHERE c.status = 'pending'
      AND c.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: () => '/change-requests?scope=queue', targets: () => ({ departments: ['management'], users: [] }) },
  { kind: 'amendment_pending', entity: 'amendment', label: 'Изменение чака одобрение',
    sql: `SELECT a.id, a.code, a.title, a.project_id FROM amendments a WHERE a.status = 'pending'
      AND a.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: r => r.project_id ? `/projects/${r.project_id}` : '/contracts',
    targets: () => ({ departments: ['management'], users: [] }) },
  { kind: 'project_stuck', entity: 'project', label: 'Обект чака договор',
    sql: `SELECT p.id, p.code, p.name FROM projects p WHERE p.status = 'contract_pending' AND p.archived = 0
      AND p.created_at < datetime('now', ?)`,
    args: [`-${THRESHOLD_H} hours`], link: r => `/projects/${r.id}`, targets: () => ({ departments: ['contracts', 'offers'], users: [] }) },
];

/** Една проходка: за всеки чакащ случай, който все още е в чакащото състояние, изпраща
 *  известие най-много веднъж на ден и запазва записа за отчетите. */
export function sweepReminders(db) {
  const sent = [];
  const insLog = db.prepare(`INSERT INTO reminders_log(entity_type, entity_id, kind, bucket, notified)
    VALUES (?,?,?,?,?) ON CONFLICT(entity_type, entity_id, kind, bucket) DO NOTHING`);
  // ref_type/ref_id: the reminder names its record, so the reader is taken to it (links.js), not to the module's first page
  const insNotif = db.prepare(`INSERT INTO notifications(department, user_id, project_id, title, body, link, severity, ref_type, ref_id) VALUES (?,?,?,?,?,?,?,?,?)`);
  const todayBucket = db.prepare(`SELECT CAST(strftime('%s','now')/86400 AS INTEGER) b`).get().b;
  for (const w of WATCHDOGS) {
    let rows;
    try { rows = db.prepare(w.sql).all(...w.args); } catch { continue; }
    for (const r of rows) {
      const { departments, users } = w.targets(r);
      if (!departments.length && !users.filter(Boolean).length) continue;
      const lr = insLog.run(w.entity, r.id, w.kind, todayBucket, JSON.stringify({ departments, users }));
      if (!lr.changes) continue; // вече напомнено днес
      const link = w.link(r);
      const projectId = r.project_id ?? null;
      for (const d of departments) insNotif.run(d, null, projectId, `⏰ ${w.label}: ${r.code || r.name || r.title || r.entity_label || '#' + r.id}`, `Чака повече от ${THRESHOLD_H} часа.`, link, 'warn', w.entity, r.id);
      for (const u of users.filter(Boolean)) insNotif.run(null, u, projectId, `⏰ ${w.label}: ${r.code || r.name || r.title || '#' + r.id}`, `Чака повече от ${THRESHOLD_H} часа.`, link, 'warn', w.entity, r.id);
      sent.push({ kind: w.kind, entity: w.entity, id: r.id });
    }
  }
  if (sent.length) audit(db, null, { entity_type: 'reminders', action: 'sweep', after: { sent: sent.length, items: sent.slice(0, 50) }, module: 'governance' });
  return sent;
}

export function startReminderWorker(db, intervalMs = 60_000) {
  // първа проверка веднага след старт, после на всеки интервал
  const run = () => { try { sweepReminders(db); } catch (e) { console.error('reminders', e); } };
  const t = setInterval(run, intervalMs);
  t.unref?.();
  run();
  return () => clearInterval(t);
}
