import crypto from 'node:crypto';
import fs from 'node:fs';
import { tx } from './db.js';
import { humanEvent } from './human.js';
import { recordLink } from './links.js';

export const DEPARTMENTS = [
  ['management', 'Управител', '#7c3aed'], ['offers', 'Оферти', '#2563eb'], ['contracts', 'Договори', '#0891b2'],
  ['technical', 'Техник', '#ea580c'], ['accounting', 'Счетоводство', '#16a34a'], ['warehouse', 'Склад', '#ca8a04'],
  ['logistics', 'Логистика', '#db2777'], ['brigadier', 'Бригадир', '#dc2626'],
];
export const ROLES = { admin: 'management', manager: 'management', commercial: 'offers', contracts: 'contracts', technical: 'technical',
  accounting: 'accounting', warehouse: 'warehouse', logistics: 'logistics', brigadier: 'brigadier' };
export const RESOURCES = ['customers', 'catalog', 'offers', 'contracts', 'projects', 'technical', 'progress', 'warehouse', 'logistics',
  'finance', 'approvals', 'tasks', 'messages', 'documents', 'reports', 'users', 'settings', 'events'];
// r = read, w = write, a = approve
const DEFAULT_PERMS = {
  admin: Object.fromEntries(RESOURCES.map(r => [r, 'rwa'])),
  manager: Object.fromEntries(RESOURCES.map(r => [r, r === 'users' || r === 'settings' ? 'r' : 'rwa'])),
  commercial: { customers: 'rw', catalog: 'rw', offers: 'rw', contracts: 'r', projects: 'r', technical: 'r', progress: 'r', warehouse: 'r', logistics: 'r', finance: 'r', tasks: 'rw', messages: 'rw', documents: 'rw', reports: 'r' },
  contracts: { customers: 'rw', catalog: 'r', offers: 'r', contracts: 'rw', projects: 'rw', technical: 'r', progress: 'r', warehouse: 'rw', logistics: 'rw', finance: 'r', tasks: 'rw', messages: 'rw', documents: 'rw', reports: 'r' },
  technical: { customers: 'r', catalog: 'rw', offers: 'r', contracts: 'r', projects: 'rw', technical: 'rw', progress: 'rw', warehouse: 'rw', logistics: 'rw', tasks: 'rw', messages: 'rw', documents: 'rw', reports: 'r' },
  accounting: { customers: 'r', catalog: 'r', offers: 'r', contracts: 'r', projects: 'r', technical: 'r', progress: 'r', warehouse: 'r', logistics: 'r', finance: 'rw', tasks: 'rw', messages: 'rw', documents: 'rw', reports: 'r' },
  warehouse: { catalog: 'rw', projects: 'r', technical: 'r', progress: 'r', warehouse: 'rw', logistics: 'rw', tasks: 'rw', messages: 'rw', documents: 'rw' },
  logistics: { customers: 'r', catalog: 'r', projects: 'r', technical: 'r', progress: 'r', warehouse: 'r', logistics: 'rw', tasks: 'rw', messages: 'rw', documents: 'rw' },
  brigadier: { catalog: 'r', projects: 'r', technical: 'r', progress: 'rw', warehouse: 'r', logistics: 'r', tasks: 'rw', messages: 'rw', documents: 'rw' },
};
export const DEFAULT_STAGES = [
  ['inquiry', 'Запитване от клиент', 'offers'], ['customer_info', 'Събиране на данни за клиента', 'offers'], ['offer_prep', 'Изготвяне на оферта', 'offers'],
  ['offer_negotiation', 'Ревизии и преговори', 'offers'], ['customer_confirmation', 'Потвърждение от клиента', 'offers'],
  ['contract_generation', 'Генериране на договор', 'contracts'], ['contract_approval', 'Преглед и одобрение на договора', 'contracts'],
  ['project_card', 'Създаване на Картон на обекта', 'contracts'], ['technical_review', 'Технически преглед (Техник + Бригадир)', 'technical'],
  ['site_validation', 'Въпросник за обекта и логистична проверка', 'technical'], ['resource_planning', 'Планиране на материали и механизация', 'technical'],
  ['procurement', 'Заявки и складово обезпечаване', 'warehouse'], ['schedule', 'Линеен график', 'technical'],
  ['customer_readiness', 'Потвърждение за готовност от клиента', 'offers'], ['execution', 'Изпълнение', 'technical'],
  ['daily_reporting', 'Дневно отчитане', 'brigadier'], ['consumption_tracking', 'Проследяване на разхода на материали', 'technical'],
  ['financial_sync', 'Финансова синхронизация', 'accounting'], ['delivery_monitoring', 'Контрол на доставки и монтаж', 'logistics'],
  ['completion', 'Завършване на обекта', 'technical'], ['reconciliation', 'Финансово приключване', 'accounting'], ['closure', 'Закриване и архивиране', 'management'],
];

export function bootstrap(db) {
  tx(db, () => {
    const dep = db.prepare('INSERT INTO departments(code, name, color) VALUES (?,?,?) ON CONFLICT(code) DO NOTHING');
    for (const d of DEPARTMENTS) dep.run(...d);
    if (!db.prepare('SELECT 1 FROM role_permissions LIMIT 1').get()) {
      const ins = db.prepare('INSERT INTO role_permissions(role, resource, can_read, can_write, can_approve) VALUES (?,?,?,?,?)');
      for (const role of Object.keys(ROLES)) for (const res of RESOURCES) {
        const p = DEFAULT_PERMS[role][res] || '';
        ins.run(role, res, +p.includes('r'), +p.includes('w'), +p.includes('a'));
      }
    }
    if (!db.prepare('SELECT 1 FROM stage_templates LIMIT 1').get()) {
      const ins = db.prepare('INSERT INTO stage_templates(code, name, department, sort) VALUES (?,?,?,?)');
      DEFAULT_STAGES.forEach((s, i) => ins.run(s[0], s[1], s[2], (i + 1) * 10));
    }
    // offer templates generated from the company's Excel (tools/import_offer_template.py); loaded once, then maintained in the app
    if (!db.prepare('SELECT 1 FROM offer_templates LIMIT 1').get()) {
      const file = new URL('./seed/offer_templates.json', import.meta.url);
      if (fs.existsSync(file)) {
        const ins = db.prepare('INSERT INTO offer_templates(code, family, title, description, footer, alternative, lines) VALUES (?,?,?,?,?,?,?)');
        for (const t of JSON.parse(fs.readFileSync(file, 'utf8'))) ins.run(t.code, t.family, t.title, t.description || null, t.footer || null, t.alternative ? 1 : 0, JSON.stringify(t.lines || []));
      }
    }
    const set = db.prepare('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO NOTHING');
    for (const [k, v] of [['company_name', ''], ['currency', 'EUR'], ['vat_pct', '20'], ['exceptional_expense_limit', '1000'], ['extra_work_limit', '500'], ['overconsumption_tolerance_pct', '5'], ['overhead_pct', '3.5'], ['profit_pct', '30'], ['corporate_tax_pct', '10'],
      ['weather_rain_mm', '2'], ['weather_wind_ms', '10'], ['weather_min_temp', '5'], ['weather_refresh_hours', '3'], ['indirect_per_manday', '150']]) set.run(k, v);
    // schedules signed before rates were stored on them keep the rate they were agreed under; a later setting change must not move them
    db.prepare(`UPDATE contract_payments SET vat_pct = v.rate, gross = ROUND(amount * (1 + v.rate / 100.0), 2) FROM (SELECT CAST(value AS REAL) AS rate FROM settings WHERE key = 'vat_pct') v
      WHERE vat_pct IS NULL AND amount IS NOT NULL AND contract_id IN (SELECT id FROM contracts WHERE status = 'signed')`).run();
  });
}

export const setting = (db, key, dflt = null) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? dflt;

export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
export const bad = (msg, extra) => new HttpError(400, msg, extra);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?, datetime('now', '+14 days'))").run(token, userId);
  return token;
}
export function userFromToken(db, token) {
  if (!token) return null;
  const u = db.prepare(`SELECT u.id, u.username, u.full_name, u.department, u.role, u.phone, u.email, u.offer_letter, u.office FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`).get(token);
  if (!u) return null;
  u.perms = {};
  for (const p of db.prepare('SELECT resource, can_read, can_write, can_approve FROM role_permissions WHERE role = ?').all(u.role))
    u.perms[p.resource] = { read: !!p.can_read, write: !!p.can_write, approve: !!p.can_approve };
  // per-user visibility limits set by an admin; admins themselves are never restricted
  if (u.role !== 'admin') for (const o of db.prepare('SELECT resource, can_read, can_write, can_approve FROM user_overrides WHERE user_id = ?').all(u.id)) {
    const cur = u.perms[o.resource] || { read: false, write: false, approve: false };
    u.perms[o.resource] = { read: o.can_read == null ? cur.read : !!o.can_read, write: o.can_write == null ? cur.write : !!o.can_write,
      approve: o.can_approve == null ? cur.approve : !!o.can_approve };
  }
  return u;
}
export function can(user, resource, action = 'read') { return !!user?.perms?.[resource]?.[action]; }
export function need(user, resource, action = 'read') {
  if (!can(user, resource, action)) throw new HttpError(403, `Нямате право: ${resource}/${action}`);
}
/** Hard admin gate — user management, permissions, settings and change-request decisions. */
export function needAdmin(user) {
  if (user?.role !== 'admin') throw new HttpError(403, 'Действието е само за администратор');
}
/** Brigadiers only reach projects they are assigned to. */
export function canSeeProject(db, user, projectId) {
  if (user.role !== 'brigadier') return true;
  return !!db.prepare('SELECT 1 FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ? WHERE p.id = ? AND (p.brigadier_id = ? OR m.user_id IS NOT NULL)').get(user.id, projectId, user.id);
}
export function needProject(db, user, projectId) {
  if (!canSeeProject(db, user, projectId)) throw new HttpError(403, 'Нямате достъп до този обект');
}

/** One project boundary for lists: rows of projects the user may not see are dropped; rows without a project stay. */
export function scopeRows(db, user, rows, projectOf = r => r.project_id) {
  return user.role !== 'brigadier' ? rows : rows.filter(r => { const pid = projectOf(r); return pid == null || canSeeProject(db, user, pid); });
}

/** Shared assets stay listed for everyone, but the name of a project the user may not see is withheld. */
export const hideForeignProject = (db, user, assets) => assets.map(a => a.allocated_project_id != null && !canSeeProject(db, user, a.allocated_project_id)
  ? { ...a, allocated_project: 'друг обект', allocated_project_id: null } : a);

// ---- one money mask: amounts are hidden by field name at any depth, also inside JSON text columns (events, audit)
const MONEY_KEY = /(^|_)(price|cost|amount|total|totals|margin|gross|net|vat|value|eur|rate)(_|$)/;
const NOT_MONEY = /^(prev_value|new_value|.*_pct|.*_at|.*_id)$/;
/** Roles holding finance or contract rights work with commercial figures; the rest see the work, not the money. */
export const canSeeMoney = user => can(user, 'finance') || can(user, 'contracts');
export function redactMoney(v) {
  if (typeof v === 'string') {
    if (!/^\s*[[{]/.test(v)) return v;
    try { return JSON.stringify(redactMoney(JSON.parse(v))); } catch { return v; }
  }
  if (Array.isArray(v)) return v.map(redactMoney);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, MONEY_KEY.test(k) && !NOT_MONEY.test(k) ? null : redactMoney(x)]));
  return v;
}

/** Mark the event that requested an approval as decided — approval_status='pending' is
 *  the live queue, so it must stop lying once a human decides. */
export function resolveApproval(db, entityType, entityId, status) {
  db.prepare("UPDATE events SET approval_status = ? WHERE entity_type = ? AND entity_id = ? AND approval_status = 'pending'").run(status, entityType, entityId);
}

export function audit(db, user, { project_id = null, entity_type, entity_id = null, action, before = null, after = null, module = null }) {
  db.prepare('INSERT INTO audit_log(user_id, project_id, entity_type, entity_id, action, before, after, module) VALUES (?,?,?,?,?,?,?,?)')
    .run(user?.id ?? null, project_id, entity_type, entity_id, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), module);
}

/** Optimistic concurrency: update only when the caller saw the latest row_version. */
export function updateRow(db, table, id, fields, expectedVersion) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')}, row_version = row_version + 1 WHERE id = ?` + (expectedVersion != null ? ' AND row_version = ?' : '');
  const args = [...keys.map(k => fields[k]), id];
  if (expectedVersion != null) args.push(expectedVersion);
  const r = db.prepare(sql).run(...args);
  if (r.changes === 0) {
    const cur = db.prepare(`SELECT row_version FROM ${table} WHERE id = ?`).get(id);
    if (!cur) throw new HttpError(404, 'Записът не е намерен');
    throw new HttpError(409, 'Записът е променен от друг потребител. Презаредете и опитайте отново.', { current_version: cur.row_version });
  }
}

export function reindex(db, kind, refId, code, title, body = '') {
  db.prepare('DELETE FROM search_index WHERE kind = ? AND ref_id = ?').run(kind, refId);
  db.prepare('INSERT INTO search_index(kind, ref_id, code, title, body) VALUES (?,?,?,?,?)').run(kind, refId, code || '', title || '', body || '');
}

// ---------------------------------------------------------------- event engine
const handlers = new Map(); // type -> [{ name, fn }]
export function on(type, name, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push({ name, fn }); }
export const MAX_ATTEMPTS = 5;

/** Record a structured event in the same transaction as the business change. Returns null if the dedupe key already exists. */
export function emit(db, user, e) {
  const uid = crypto.randomUUID();
  const r = db.prepare(`INSERT INTO events(uid, dedupe_key, project_id, type, origin_module, user_id, entity_type, entity_id, prev_value, new_value, approval_status, affected_modules)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`).run(uid, e.dedupe_key || uid, e.project_id ?? null, e.type, e.origin, user?.id ?? null,
    e.entity_type ?? null, e.entity_id ?? null, e.prev == null ? null : JSON.stringify(e.prev), e.next == null ? null : JSON.stringify(e.next),
    e.approval_status ?? null, JSON.stringify(e.affected || []));
  return r.changes ? Number(r.lastInsertRowid) : null;
}

const DEPT_CODES = new Set(DEPARTMENTS.map(d => d[0]));
export function notify(db, ev, { departments = [], users = [], title, body = '', link = null, severity = 'info' }) {
  // a misspelled department would silently reach nobody
  for (const d of departments) if (!DEPT_CODES.has(d)) throw new Error(`Непознат отдел за известие: ${d}`);
  const ins = db.prepare('INSERT INTO notifications(event_id, user_id, department, project_id, title, body, link, severity, ref_type, ref_id, author_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const args = [ev?.id ?? null, ev?.project_id ?? null, ev?.entity_type ?? null, ev?.entity_id ?? null, ev?.user_id ?? null];
  for (const d of new Set(departments)) ins.run(args[0], null, d, args[1], title, body, link, severity, args[2], args[3], args[4]);
  for (const u of new Set(users.filter(Boolean))) ins.run(args[0], u, null, args[1], title, body, link, severity, args[2], args[3], args[4]);
  return { departments, users: users.filter(Boolean) };
}

function notifyAffected(db, ev) {
  const depts = (JSON.parse(ev.affected_modules || '[]') || []).filter(d => DEPT_CODES.has(d));
  if (!depts.length) return { skipped: 'no affected department' };
  const p = ev.project_id ? db.prepare('SELECT code FROM projects WHERE id = ?').get(ev.project_id) : null;
  const h = humanEvent(db, { ...ev, user_name: ev.user_id ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(ev.user_id)?.full_name : null });
  return notify(db, ev, { departments: depts, title: `${h.label}${p ? ' — ' + p.code : ''}`, body: [h.user_name ? `от ${h.user_name}` : '', ...h.changes].filter(Boolean).join(' · '),
    link: recordLink(ev.entity_type, ev.entity_id, ev.project_id) ?? (ev.project_id ? `/projects/${ev.project_id}` : null), severity: ev.approval_status === 'pending' ? 'warn' : 'info' });
}

/** Process one event: every handler runs in its own transaction and is recorded once (idempotent on retry). */
export function processEvent(db, id) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev || ev.status === 'processed') return ev?.status;
  db.prepare("UPDATE events SET status = 'processing', attempts = attempts + 1 WHERE id = ?").run(id);
  ev.prev = ev.prev_value ? JSON.parse(ev.prev_value) : null;
  ev.next = ev.new_value ? JSON.parse(ev.new_value) : null;
  let error = null;
  // an event nobody handles still reaches the departments it affects (the "Slack" rule: no silent facts)
  for (const h of handlers.get(ev.type) || [{ name: 'notify_affected', fn: notifyAffected }]) {
    const done = db.prepare("SELECT 1 FROM event_effects WHERE event_id = ? AND handler = ? AND status = 'ok'").get(id, h.name);
    if (done) continue;
    try {
      tx(db, () => {
        const result = h.fn(db, ev);
        db.prepare(`INSERT INTO event_effects(event_id, handler, status, result) VALUES (?,?, 'ok', ?)
          ON CONFLICT(event_id, handler) DO UPDATE SET status = 'ok', result = excluded.result, created_at = datetime('now')`).run(id, h.name, JSON.stringify(result ?? null));
      });
    } catch (e) {
      error = `${h.name}: ${e.message}`;
      db.prepare(`INSERT INTO event_effects(event_id, handler, status, result) VALUES (?,?, 'error', ?)
        ON CONFLICT(event_id, handler) DO UPDATE SET status = 'error', result = excluded.result, created_at = datetime('now')`).run(id, h.name, JSON.stringify(e.message));
      break; // later handlers may depend on this one
    }
  }
  if (!error) { db.prepare("UPDATE events SET status = 'processed', last_error = NULL, processed_at = datetime('now') WHERE id = ?").run(id); return 'processed'; }
  const attempts = db.prepare('SELECT attempts FROM events WHERE id = ?').get(id).attempts;
  const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  db.prepare(`UPDATE events SET status = ?, last_error = ?, next_attempt_at = datetime('now', ?) WHERE id = ?`).run(status, error, `+${Math.min(300, 2 ** attempts * 5)} seconds`, id);
  return status;
}

/** Drain pending events in order. Returns the number processed in this pass. */
export function drain(db, { ignoreBackoff = false } = {}) {
  let n = 0;
  for (let guard = 0; guard < 500; guard++) {
    const ev = db.prepare(`SELECT id FROM events WHERE status = 'pending' ${ignoreBackoff ? '' : "AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))"} ORDER BY id LIMIT 1`).get();
    if (!ev) break;
    const st = processEvent(db, ev.id);
    n++;
    if (st !== 'processed' && ignoreBackoff && st === 'pending') break;
  }
  return n;
}
export function recoverStuck(db) { return db.prepare("UPDATE events SET status = 'pending' WHERE status = 'processing'").run().changes; }
export function startWorker(db, intervalMs = 700) {
  recoverStuck(db);
  let busy = false;
  const t = setInterval(() => { if (busy) return; busy = true; try { drain(db); } catch (e) { console.error('worker', e); } finally { busy = false; } }, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}