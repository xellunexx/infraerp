// Плащания: единственният вход за пари по етап, проформа и поръчка. Договори/Логистика докладват, Счетоводство потвърждава.
import crypto from 'node:crypto';
import { tx, nextCode } from './db.js';
import { HttpError, bad, need, can, needProject, scopeRows, audit, emit, notify, on, updateRow } from './core.js';
import { milestones, proformaOpenSql, similarPayments, vatInside, localToday } from './payments.js';
import { h, reqStr } from './app.js';

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export function paymentAmount(v) {
  const n = typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) ? Number(v) : NaN;
  if (!Number.isFinite(n) || r2(n) <= 0) throw bad('Въведете сума с ДДС, по-голяма от нула (напр. 3720.00)');
  return r2(n);
}
export function bankDate(v) {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s)) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) throw bad('Въведете датата на плащането по банка');
  if (s > localToday()) throw bad('Датата на плащането не може да е в бъдещето');
  return s;
}
const rowOf = (db, id) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
const asSimilar = list => { throw new HttpError(409, 'Има подобно плащане по този обект. Посочете дали е същото или отделно.', { similar: list }); };

/** One write path. Returns { payment, similar, deduped }. `status` is decided by the caller's rights, never by the request. */
export function recordPayment(db, user, { project_id, direction, status, uid, amount, tx_date, separate, proforma = null, milestone = null, order = null, order_stage = null, document_id = null, vat_pct = null, ...rest }) {
  const key = `p:${user.id}:${uid || crypto.randomUUID()}`;
  const same = db.prepare('SELECT * FROM transactions WHERE uid = ?').get(key);
  if (same) return { payment: same, similar: [], deduped: true };
  const similar = similarPayments(db, { project_id, direction, amount, tx_date });
  if (status === 'paid' && similar.length && !separate) asSimilar(similar);
  const f = { code: nextCode(db, 'TXN'), uid: key, project_id, direction, category: rest.category, amount, status, tx_date, counterparty: rest.counterparty || null, document_ref: rest.document_ref || null,
    proforma_id: proforma?.id ?? null, contract_payment_id: milestone?.id ?? null, supplier_order_id: order?.id ?? null, order_stage, document_id, note: rest.note || null, created_by: user.id,
    tx_kind: direction === 'in' ? 'bank_in' : 'bank_out', method: 'bank', has_vat: vat_pct == null ? 0 : 1, vat_amount: vat_pct == null ? null : vatInside(amount, vat_pct),
    company: JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'finance_companies'").get()?.value || '[]')[0] || null };
  const cols = Object.keys(f);
  const id = Number(db.prepare(`INSERT INTO transactions(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => f[c])).lastInsertRowid);
  audit(db, user, { project_id, entity_type: 'transaction', entity_id: id, action: status === 'paid' ? 'payment' : 'payment_report', after: { code: f.code, amount, tx_date, status }, module: 'accounting' });
  emit(db, user, { type: status === 'paid' ? 'contract.payment_recorded' : 'payment.reported', origin: 'accounting', project_id, entity_type: 'transaction', entity_id: id,
    dedupe_key: `payment.${status}:${id}`, next: { code: f.code, amount, tx_date, supplier: order?.supplier ?? null }, affected: ['accounting', 'contracts', 'management'] });
  return { payment: rowOf(db, id), similar, deduped: false };
}

/** What a client payment settles: proforma and/or milestone of the same project. */
export function clientTarget(db, projectId, b) {
  let proforma = null, milestone = null;
  if (b.proforma_id != null && b.proforma_id !== '') {
    proforma = db.prepare('SELECT * FROM proformas WHERE id = ? AND project_id = ?').get(Number(b.proforma_id), projectId);
    if (!proforma || proforma.status === 'cancelled') throw bad('Няма такава проформа за този обект');
  }
  if (b.contract_payment_id != null && b.contract_payment_id !== '') {
    milestone = db.prepare('SELECT m.* FROM contract_payments m JOIN contracts c ON c.id = m.contract_id WHERE m.id = ? AND c.project_id = ?').get(Number(b.contract_payment_id), projectId);
    if (!milestone) throw bad('Няма такъв етап на плащане за този обект');
  }
  // named only by milestone: it also settles the oldest open proforma of that kind, so the proforma does not keep reminding
  if (milestone && !proforma) proforma = db.prepare(`SELECT f.* FROM proformas f WHERE f.project_id = ? AND f.kind = ? AND ${proformaOpenSql('f')} ORDER BY f.id`).get(projectId, milestone.kind) ?? null;
  if (proforma && milestone && proforma.kind !== milestone.kind) throw bad('Проформата и етапът са от различен вид');
  return { proforma, milestone };
}

export default function mountPayments(app, db) {
  const project = id => { const p = db.prepare('SELECT p.*, c.name AS customer_name FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.id = ?').get(id); if (!p) throw new HttpError(404, 'Обектът не е намерен'); return p; };
  const vatDefault = () => Number(db.prepare("SELECT value FROM settings WHERE key = 'vat_pct'").get()?.value ?? 20);

  app.post('/api/projects/:pid/payments', h(req => tx(db, () => {
    const paid = can(req.user, 'finance', 'write'), b = req.body || {};
    if (!paid) need(req.user, 'contracts', 'write');
    const p = project(Number(req.params.pid)); needProject(db, req.user, p.id);
    const amount = paymentAmount(b.amount), tx_date = bankDate(b.tx_date), t = clientTarget(db, p.id, b);
    if (!paid && !t.proforma && !t.milestone) throw bad('Изберете етап или проформа');
    return recordPayment(db, req.user, { project_id: p.id, direction: 'in', status: paid ? 'paid' : 'reported', uid: b.uid, amount, tx_date, separate: b.separate === true, ...t,
      vat_pct: t.proforma?.vat_pct ?? t.milestone?.vat_pct ?? vatDefault(), category: t.milestone?.kind ?? t.proforma?.kind ?? 'client', counterparty: p.customer_name,
      document_ref: b.document_ref || t.proforma?.code, note: b.note });
  })));

  app.post('/api/supplier-orders/:id/payments', h(req => tx(db, () => {
    const paid = can(req.user, 'finance', 'write'), b = req.body || {};
    if (!paid) need(req.user, 'logistics', 'write');
    const o = db.prepare('SELECT * FROM supplier_orders WHERE id = ?').get(Number(req.params.id));
    if (!o) throw new HttpError(404, 'Няма такава поръчка');
    needProject(db, req.user, o.project_id);
    if (!['advance', 'final'].includes(b.stage)) throw bad('Етапът е аванс или доплащане');
    const amount = paymentAmount(b.amount), tx_date = bankDate(b.tx_date);
    let document_id = null;
    if (b.document_id != null && b.document_id !== '') {
      const d = rowOf(db, Number(b.document_id));
      if (!d || d.direction !== 'out' || d.document_id != null || !['committed', 'planned'].includes(d.status) || d.project_id !== o.project_id) throw bad('Няма такъв неплатен документ за този обект');
      document_id = d.id;
    }
    return recordPayment(db, req.user, { project_id: o.project_id, direction: 'out', status: paid ? 'paid' : 'reported', uid: b.uid, amount, tx_date, separate: b.separate === true, order: o, order_stage: b.stage, document_id,
      category: 'supplier_order', counterparty: o.supplier, document_ref: b.document_ref || o.order_doc_no, note: b.note });
  })));

  // ---- решенията са само на Счетоводство
  const pending = (req, id) => {
    need(req.user, 'finance', 'write');
    const t = rowOf(db, Number(id));
    if (!t) throw new HttpError(404, 'Няма такова плащане');
    if (t.project_id != null) needProject(db, req.user, t.project_id);
    if (t.status !== 'reported') throw new HttpError(409, 'Плащането вече е решено');
    return t;
  };
  app.post('/api/payments/:id/confirm', h(req => tx(db, () => {
    const t = pending(req, req.params.id), b = req.body || {};
    const amount = b.amount == null || b.amount === '' ? t.amount : paymentAmount(b.amount), tx_date = b.tx_date == null || b.tx_date === '' ? t.tx_date : bankDate(b.tx_date);
    const similar = similarPayments(db, { ...t, amount, tx_date });
    if (similar.length && b.separate !== true) asSimilar(similar);
    const f = { status: 'paid', amount, tx_date };
    if (t.has_vat) f.vat_amount = r2(t.vat_amount * amount / t.amount);
    updateRow(db, 'transactions', t.id, f, b.row_version);
    audit(db, req.user, { project_id: t.project_id, entity_type: 'transaction', entity_id: t.id, action: 'payment_confirm', before: { status: t.status, amount: t.amount, tx_date: t.tx_date }, after: f, module: 'accounting' });
    emit(db, req.user, { type: 'contract.payment_recorded', origin: 'accounting', project_id: t.project_id, entity_type: 'transaction', entity_id: t.id, dedupe_key: `payment.paid:${t.id}`,
      next: { code: t.code, amount, tx_date }, affected: ['accounting', 'contracts', 'management'] });
    return { payment: rowOf(db, t.id) };
  })));
  app.post('/api/payments/:id/reject', h(req => tx(db, () => {
    const t = pending(req, req.params.id), reason = reqStr(req.body?.reason, 'Причина');
    updateRow(db, 'transactions', t.id, { status: 'voided', note: [t.note, `Отхвърлено: ${reason}`].filter(Boolean).join(' · ') }, req.body?.row_version);
    audit(db, req.user, { project_id: t.project_id, entity_type: 'transaction', entity_id: t.id, action: 'payment_reject', before: { status: t.status, amount: t.amount }, after: { status: 'voided', reason }, module: 'accounting' });
    emit(db, req.user, { type: 'payment.rejected', origin: 'accounting', project_id: t.project_id, entity_type: 'transaction', entity_id: t.id, dedupe_key: `payment.rejected:${t.id}`, next: { code: t.code, reason }, affected: ['contracts'] });
    return { ok: true };
  })));
  /** The report is the same transfer as an existing row: the existing row stays and takes over the missing links. */
  app.post('/api/payments/:id/merge', h(req => tx(db, () => {
    const t = pending(req, req.params.id), into = rowOf(db, Number(req.body?.into));
    if (!into || !similarPayments(db, t).some(s => s.id === into.id)) throw bad('Изберете плащане със същата сума и близка дата по същия обект');
    const links = {};
    for (const k of ['proforma_id', 'contract_payment_id', 'supplier_order_id', 'order_stage', 'document_id']) if (into[k] == null && t[k] != null) links[k] = t[k];
    if (Object.keys(links).length) updateRow(db, 'transactions', into.id, links);
    updateRow(db, 'transactions', t.id, { status: 'voided', note: [t.note, `Същото плащане като ${into.code}`].filter(Boolean).join(' · ') }, req.body?.row_version);
    audit(db, req.user, { project_id: t.project_id, entity_type: 'transaction', entity_id: t.id, action: 'payment_merge', before: { status: t.status, amount: t.amount }, after: { into: into.code, links }, module: 'accounting' });
    return { payment: rowOf(db, into.id) };
  })));

  app.get('/api/payments/queue', h(req => {
    need(req.user, 'finance');
    const reported = scopeRows(db, req.user, db.prepare(`SELECT t.*, p.code AS project_code, p.name AS project_name, u.full_name AS reported_by_name, pf.code AS proforma_code, m.kind AS milestone_kind, o.code AS order_code
      FROM transactions t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.created_by LEFT JOIN proformas pf ON pf.id = t.proforma_id
      LEFT JOIN contract_payments m ON m.id = t.contract_payment_id LEFT JOIN supplier_orders o ON o.id = t.supplier_order_id WHERE t.status = 'reported' ORDER BY t.id`).all())
      .map(t => ({ ...t, similar: similarPayments(db, t) }));
    const unmatched = scopeRows(db, req.user, db.prepare('SELECT c.id, c.code AS contract_code, c.project_id, p.code AS project_code, p.name AS project_name FROM contracts c JOIN projects p ON p.id = c.project_id').all())
      .flatMap(c => milestones(db, c.id).filter(m => m.unmatched_date).map(m => ({ id: m.id, kind: m.kind, gross: m.gross, unmatched_date: m.unmatched_date, project_id: c.project_id, project_code: c.project_code, project_name: c.project_name, contract_code: c.contract_code })));
    return { reported, unmatched };
  }));
  app.post('/api/payments/unmatched/:id/clear', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const m = db.prepare('SELECT m.*, c.project_id FROM contract_payments m JOIN contracts c ON c.id = m.contract_id WHERE m.id = ?').get(Number(req.params.id));
    if (!m) throw new HttpError(404, 'Няма такъв етап');
    needProject(db, req.user, m.project_id);
    db.prepare("UPDATE contract_payments SET paid_at = NULL, updated_at = datetime('now') WHERE id = ?").run(m.id);
    audit(db, req.user, { project_id: m.project_id, entity_type: 'contract', entity_id: m.contract_id, action: 'clear_unmatched_date', before: { kind: m.kind, paid_at: m.paid_at }, module: 'accounting' });
    return { ok: true };
  })));
}

const about = (db, ev) => db.prepare('SELECT t.*, p.code AS pcode FROM transactions t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?').get(ev.entity_id);
on('payment.reported', 'notify_accounting', (db, ev) => { const t = about(db, ev); if (!t) return { skipped: true };
  return notify(db, ev, { departments: ['accounting'], title: `Докладвано плащане ${t.code}${t.pcode ? ' — ' + t.pcode : ''}`, body: `${t.amount.toFixed(2)} с ДДС от ${t.tx_date}. Чака потвърждение по банка.`, link: '/accounting?tab=confirm' }); });
on('payment.rejected', 'notify_reporter', (db, ev) => { const t = about(db, ev); if (!t) return { skipped: true };
  return notify(db, ev, { users: [t.created_by], severity: 'warn', title: `Плащане ${t.code} е отхвърлено${t.pcode ? ' — ' + t.pcode : ''}`, body: ev.next?.reason || '', link: `/projects/${t.project_id}?tab=contract` }); });
on('contract.payment_recorded', 'notify_contracts', (db, ev) => { const t = about(db, ev); if (!t || ev.entity_type !== 'transaction') return { skipped: true };
  return notify(db, ev, { departments: t.direction === 'in' ? ['contracts', 'technical'] : ['logistics'], title: `${t.direction === 'in' ? 'Постъпило плащане' : 'Платено към доставчик'} ${t.code}${t.pcode ? ' — ' + t.pcode : ''}`,
    body: `Дата по банка: ${t.tx_date}.`, link: t.direction === 'in' ? `/projects/${t.project_id}?tab=contract` : '/logistics' }); });
