// Счетоводство: проформи, приходи/разходи, заявки за плащане с одобрение от Управител, настаняване, финансов преглед по обект и портфолио.
import crypto from 'node:crypto';
import { tx, nextCode } from './db.js';
import { HttpError, bad, need, canSeeProject, audit, updateRow, emit, notify, on, setting, resolveApproval } from './core.js';
import { finance } from './calc.js';
import { h, pick, num, reqStr } from './app.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const reqDate = (v, label, { required = true } = {}) => {
  if (v == null || v === '') { if (required) throw bad(`Полето „${label}“ е задължително`); return null; }
  const s = String(v);
  if (!DATE.test(s) || isNaN(Date.parse(s))) throw bad(`Невалидна дата за „${label}“`);
  return s;
};
const today = () => new Date().toISOString().slice(0, 10);
const PROFORMA_KINDS = ['advance', 'interim', 'final', 'other'];
const TX_STATUSES = ['planned', 'committed', 'paid', 'voided'];

export default function mountAccounting(app, db) {
  const project = id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const needPid = (req, pid, action = 'read') => { need(req.user, 'finance', action); if (pid != null) { if (!project(pid)) throw new HttpError(404, 'Обектът не е намерен'); needProjectGuard(req.user, pid); } };
  const needProjectGuard = (u, pid) => { if (!canSeeProject(db, u, pid)) throw new HttpError(403, 'Нямате достъп до този обект'); };

  const optProject = (req, v) => { const pid = v == null || v === '' ? null : Number(v); if (pid != null && !project(pid)) throw new HttpError(404, 'Обектът не е намерен'); if (pid != null) needProjectGuard(req.user, pid); return pid; };

  // ---- views
  const proformaView = `SELECT f.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name, u.full_name AS created_by_name
    FROM proformas f JOIN projects p ON p.id = f.project_id JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = f.created_by`;
  const txView = `SELECT t.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name, pf.code AS proforma_code, u.full_name AS created_by_name
    FROM transactions t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN proformas pf ON pf.id = t.proforma_id LEFT JOIN users u ON u.id = t.created_by`;
  const prView = `SELECT r.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name, u.full_name AS requested_by_name,
      a.decided_by AS approval_decided_by, du.full_name AS decided_by_name, a.decision_note AS approval_note
    FROM payment_requests r LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN approvals a ON a.id = r.approval_id LEFT JOIN users du ON du.id = a.decided_by`;
  const accoView = `SELECT a.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name, u.full_name AS created_by_name
    FROM accommodations a JOIN projects p ON p.id = a.project_id JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = a.created_by`;

  const wherePid = (req, col = 'project_id') => req.query.project_id != null && req.query.project_id !== '' ? `${col} = ?` : null;

  // ---- портфолио: финансови показатели по всички видими обекти
  app.get('/api/accounting', h(req => {
    need(req.user, 'finance');
    const rows = db.prepare(`SELECT p.id, p.code, p.name, p.status, c.name AS customer_name FROM projects p JOIN customers c ON c.id = p.customer_id
      WHERE p.archived = 0 ORDER BY p.id DESC`).all()
      .filter(p => canSeeProject(db, req.user, p.id))
      .map(p => ({ ...p, ...finance(db, p.id) }));
    const KEYS = ['contract_value', 'offer_value', 'cost_price', 'planned_expenses', 'actual_expenses', 'payments_made', 'payments_received',
      'invoiced', 'receivables', 'not_invoiced', 'payables', 'planned_out', 'remaining_budget', 'planned_result', 'result_to_date', 'forecast_result', 'earned_value', 'earned_cost'];
    const totals = Object.fromEntries(KEYS.map(k => [k, Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) * 100) / 100]));
    return { projects: rows, totals };
  }));

  // ---- финансов преглед по обект: изчислените показатели + записите
  app.get('/api/projects/:pid/finance', h(req => {
    needPid(req, Number(req.params.pid));
    const pid = Number(req.params.pid);
    const w = [pid];
    return { ...finance(db, pid),
      proformas: db.prepare(`${proformaView} WHERE f.project_id = ? ORDER BY f.id DESC`).all(...w),
      transactions: db.prepare(`${txView} WHERE t.project_id = ? ORDER BY t.tx_date DESC, t.id DESC`).all(...w),
      payment_requests: db.prepare(`${prView} WHERE r.project_id = ? ORDER BY r.id DESC`).all(...w),
      accommodations: db.prepare(`${accoView} WHERE a.project_id = ? ORDER BY a.id DESC`).all(...w) };
  }));

  // ---- Проформи
  app.get('/api/proformas', h(req => {
    need(req.user, 'finance');
    const w = wherePid(req, 'f.project_id');
    return db.prepare(`${proformaView}${w ? ' WHERE ' + w : ''} ORDER BY f.id DESC`).all(...(w ? [Number(req.query.project_id)] : []));
  }));
  app.post('/api/proformas', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const b = req.body || {};
    const pid = optProject(req, b.project_id);
    if (pid == null) throw bad('Обектът е задължителен');
    if (!db.prepare('SELECT 1 FROM contracts WHERE project_id = ?').get(pid)) throw bad('Проформа се издава само за обект с договор');
    const kind = b.kind || 'advance';
    if (!PROFORMA_KINDS.includes(kind)) throw bad('Невалиден вид проформа');
    const amount = num(b.amount, 'Сума', { min: 0.000001 });
    const vat = b.vat_pct != null && b.vat_pct !== '' ? num(b.vat_pct, 'ДДС %') : Number(setting(db, 'vat_pct', '20'));
    const f = { code: nextCode(db, 'PF'), project_id: pid, kind, amount, vat_pct: vat,
      issued_on: reqDate(b.issued_on, 'Дата на издаване', { required: false }) || today(),
      due_on: reqDate(b.due_on, 'Срок на плащане', { required: false }),
      note: b.note || null, created_by: req.user.id };
    const id = Number(db.prepare('INSERT INTO proformas(code, project_id, kind, amount, vat_pct, issued_on, due_on, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(f.code, f.project_id, f.kind, f.amount, f.vat_pct, f.issued_on, f.due_on, 'issued', f.note, f.created_by).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'proforma', entity_id: id, action: 'issue', after: { code: f.code, amount, kind }, module: 'accounting' });
    emit(db, req.user, { type: 'proforma.issued', origin: 'accounting', project_id: pid, entity_type: 'proforma', entity_id: id,
      dedupe_key: `proforma.issued:${id}`, next: { code: f.code, amount, kind }, affected: ['accounting', 'management'] });
    return db.prepare(`${proformaView} WHERE f.id = ?`).get(id);
  })));
  app.post('/api/proformas/:id/:action', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const pf = db.prepare('SELECT * FROM proformas WHERE id = ?').get(Number(req.params.id));
    if (!pf) throw new HttpError(404, 'Няма такава проформа');
    needProjectGuard(req.user, pf.project_id);
    const action = req.params.action;
    if (action === 'cancel') {
      if (pf.status !== 'issued') throw bad(pf.status === 'paid' ? 'Платена проформа не се отменя' : 'Проформата вече е отменена');
      db.prepare("UPDATE proformas SET status = 'cancelled', row_version = row_version + 1 WHERE id = ?").run(pf.id);
      audit(db, req.user, { project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id, action: 'cancel', before: { status: pf.status }, after: { status: 'cancelled' }, module: 'accounting' });
      emit(db, req.user, { type: 'proforma.cancelled', origin: 'accounting', project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id,
        dedupe_key: `proforma.cancelled:${pf.id}:${pf.row_version}`, prev: { status: 'issued' }, next: { status: 'cancelled' }, affected: ['accounting'] });
      return db.prepare(`${proformaView} WHERE f.id = ?`).get(pf.id);
    }
    if (action !== 'paid') throw bad('Непозната операция');
    if (pf.status === 'cancelled') throw bad('Отменена проформа не може да бъде платена');
    const existing = db.prepare('SELECT * FROM transactions WHERE proforma_id = ?').get(pf.id);
    if (existing) {
      if (pf.status !== 'paid') db.prepare("UPDATE proformas SET status = 'paid', row_version = row_version + 1 WHERE id = ?").run(pf.id);
      return { proforma: db.prepare(`${proformaView} WHERE f.id = ?`).get(pf.id), transaction: db.prepare(`${txView} WHERE t.id = ?`).get(existing.id), deduped: true };
    }
    if (pf.status !== 'issued') throw bad('Проформата вече е платена');
    const cust = db.prepare('SELECT c.name FROM customers c JOIN projects p ON p.customer_id = c.id WHERE p.id = ?').get(pf.project_id);
    const tid = Number(db.prepare(`INSERT INTO transactions(code, uid, project_id, direction, category, amount, status, tx_date, counterparty, document_ref, proforma_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(nextCode(db, 'TXN'), crypto.randomUUID(), pf.project_id, 'in', pf.kind, pf.amount, 'paid', today(), cust?.name || null, pf.code, pf.id, req.user.id).lastInsertRowid);
    db.prepare("UPDATE proformas SET status = 'paid', row_version = row_version + 1 WHERE id = ?").run(pf.id);
    audit(db, req.user, { project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id, action: 'paid', before: { status: 'issued' }, after: { status: 'paid', transaction_id: tid }, module: 'accounting' });
    emit(db, req.user, { type: 'proforma.paid', origin: 'accounting', project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id,
      dedupe_key: `proforma.paid:${pf.id}`, prev: { status: 'issued' }, next: { status: 'paid', amount: pf.amount }, affected: ['accounting'] });
    return { proforma: db.prepare(`${proformaView} WHERE f.id = ?`).get(pf.id), transaction: db.prepare(`${txView} WHERE t.id = ?`).get(tid), deduped: false };
  })));

  // ---- Транзакции (приходи и разходи)
  app.get('/api/transactions', h(req => {
    need(req.user, 'finance');
    const w = wherePid(req, 't.project_id');
    return db.prepare(`${txView}${w ? ' WHERE ' + w : ''} ORDER BY t.tx_date DESC, t.id DESC`).all(...(w ? [Number(req.query.project_id)] : []));
  }));
  app.post('/api/transactions', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const b = req.body || {};
    const pid = optProject(req, b.project_id);
    const direction = b.direction;
    if (!['in', 'out'].includes(direction)) throw bad('Посоката трябва да е „in“ или „out“');
    const category = reqStr(b.category, 'Категория');
    const amount = num(b.amount, 'Сума', { min: 0.000001 });
    const status = b.status || 'paid';
    if (!['planned', 'committed', 'paid'].includes(status)) throw bad('Невалиден статус');
    let proformaId = null;
    if (b.proforma_id != null && b.proforma_id !== '') {
      const pf = db.prepare('SELECT * FROM proformas WHERE id = ?').get(Number(b.proforma_id));
      if (!pf) throw bad('Няма такава проформа');
      if (pid != null && pf.project_id !== pid) throw bad('Проформата е за друг обект');
      proformaId = pf.id; if (pid == null) { /* keep null: receipt can stay company-level */ }
    }
    const f = { code: nextCode(db, 'TXN'), uid: crypto.randomUUID(), project_id: pid, direction, category, amount, status,
      tx_date: reqDate(b.tx_date, 'Дата'), due_on: reqDate(b.due_on, 'Срок', { required: false }),
      counterparty: b.counterparty || null, document_ref: b.document_ref || null, proforma_id: proformaId,
      note: b.note || null, created_by: req.user.id };
    const id = Number(db.prepare(`INSERT INTO transactions(code, uid, project_id, direction, category, amount, status, tx_date, due_on, counterparty, document_ref, proforma_id, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.code, f.uid, f.project_id, f.direction, f.category, f.amount, f.status, f.tx_date, f.due_on, f.counterparty, f.document_ref, f.proforma_id, f.note, f.created_by).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'transaction', entity_id: id, action: 'create', after: { code: f.code, direction, amount, category }, module: 'accounting' });
    emit(db, req.user, { type: 'transaction.recorded', origin: 'accounting', project_id: pid, entity_type: 'transaction', entity_id: id,
      dedupe_key: `transaction.recorded:${id}`, next: { code: f.code, direction, amount, category }, affected: ['accounting'] });
    return db.prepare(`${txView} WHERE t.id = ?`).get(id);
  })));
  app.patch('/api/transactions/:id', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
    if (!t) throw new HttpError(404, 'Няма такава транзакция');
    needProjectGuard(req.user, t.project_id);
    const b = req.body || {};
    const f = pick(b, ['category', 'amount', 'tx_date', 'due_on', 'counterparty', 'document_ref', 'proforma_id', 'status', 'note']);
    if (f.category !== undefined) f.category = reqStr(f.category, 'Категория');
    if (f.amount !== undefined) f.amount = num(f.amount, 'Сума', { min: 0.000001 });
    for (const k of ['tx_date', 'due_on']) if (f[k] !== undefined) f[k] = reqDate(f[k], k === 'tx_date' ? 'Дата' : 'Срок', { required: k === 'tx_date' });
    if (f.status !== undefined && !TX_STATUSES.includes(f.status)) throw bad('Невалиден статус');
    if (f.proforma_id !== undefined && f.proforma_id !== null) {
      const pf = db.prepare('SELECT * FROM proformas WHERE id = ?').get(Number(f.proforma_id));
      if (!pf) throw bad('Няма такава проформа');
      if (t.project_id != null && pf.project_id !== t.project_id) throw bad('Проформата е за друг обект');
      f.proforma_id = pf.id;
    }
    updateRow(db, 'transactions', t.id, f, b.row_version);
    audit(db, req.user, { project_id: t.project_id, entity_type: 'transaction', entity_id: t.id, action: 'update', before: pick(t, Object.keys(f)), after: f, module: 'accounting' });
    return db.prepare(`${txView} WHERE t.id = ?`).get(t.id);
  })));

  // ---- Заявки за плащане -> одобрение от Управител (парите се въвеждат ръчно като транзакция)
  app.get('/api/payment-requests', h(req => {
    need(req.user, 'finance');
    const w = wherePid(req, 'r.project_id');
    return db.prepare(`${prView}${w ? ' WHERE ' + w : ''} ORDER BY r.id DESC`).all(...(w ? [Number(req.query.project_id)] : []));
  }));
  app.post('/api/payment-requests', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const b = req.body || {};
    const pid = optProject(req, b.project_id);
    const category = reqStr(b.category, 'Категория');
    const amount = num(b.amount, 'Сума', { min: 0.000001 });
    const payee = reqStr(b.payee, 'Получател');
    const limit = Number(setting(db, 'exceptional_expense_limit', '1000'));
    const exceptional = (b.exceptional ? 1 : 0) || (amount > limit ? 1 : 0);
    const code = nextCode(db, 'PAY');
    const id = Number(db.prepare('INSERT INTO payment_requests(code, project_id, category, amount, payee, reason, exceptional, status, requested_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(code, pid, category, amount, payee, b.reason || null, exceptional, 'pending', req.user.id).lastInsertRowid);
    const aid = Number(db.prepare(`INSERT INTO approvals(code, project_id, kind, entity_type, entity_id, title, amount, status, requested_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(nextCode(db, 'APR'), pid, 'payment_request', 'payment_request', id, `${code} — ${payee}: ${amount}`, amount, 'pending', req.user.id).lastInsertRowid);
    db.prepare('UPDATE payment_requests SET approval_id = ? WHERE id = ?').run(aid, id);
    audit(db, req.user, { project_id: pid, entity_type: 'payment_request', entity_id: id, action: 'create', after: { code, amount, payee, exceptional }, module: 'accounting' });
    emit(db, req.user, { type: 'payment_request.created', origin: 'accounting', project_id: pid, entity_type: 'payment_request', entity_id: id,
      dedupe_key: `payment_request.created:${id}`, next: { code, amount, payee, exceptional: !!exceptional }, approval_status: 'pending', affected: ['management', 'accounting'] });
    return db.prepare(`${prView} WHERE r.id = ?`).get(id);
  })));
  app.post('/api/payment-requests/:id/:action', h(req => tx(db, () => {
    need(req.user, 'approvals', 'approve');
    const r = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(Number(req.params.id));
    if (!r) throw new HttpError(404, 'Няма такава заявка');
    const action = req.params.action;
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
    if (!status) throw bad('Непозната операция');
    if (r.status !== 'pending') throw bad('Заявката вече е решена');
    db.prepare('UPDATE payment_requests SET status = ?, row_version = row_version + 1 WHERE id = ?').run(status, r.id);
    resolveApproval(db, 'payment_request', r.id, status);
    if (r.approval_id) db.prepare("UPDATE approvals SET status = ?, decided_by = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?")
      .run(status, req.user.id, req.body?.note || null, r.approval_id);
    audit(db, req.user, { project_id: r.project_id, entity_type: 'payment_request', entity_id: r.id, action, before: { status: 'pending' }, after: { status, note: req.body?.note || null }, module: 'accounting' });
    emit(db, req.user, { type: 'payment_request.decided', origin: 'accounting', project_id: r.project_id, entity_type: 'payment_request', entity_id: r.id,
      dedupe_key: `payment_request.decided:${r.id}`, prev: { status: 'pending' }, next: { status, note: req.body?.note || null }, affected: ['accounting', 'management'] });
    return db.prepare(`${prView} WHERE r.id = ?`).get(r.id);
  })));

  // ---- Настаняване
  app.get('/api/accommodations', h(req => {
    need(req.user, 'finance');
    const w = wherePid(req, 'a.project_id');
    return db.prepare(`${accoView}${w ? ' WHERE ' + w : ''} ORDER BY a.id DESC`).all(...(w ? [Number(req.query.project_id)] : []));
  }));
  const accoFields = b => {
    const f = {};
    if (b.place !== undefined) f.place = reqStr(b.place, 'Място');
    for (const k of ['address', 'payment_method', 'parking', 'workers', 'note']) if (b[k] !== undefined) f[k] = b[k] || null;
    for (const k of ['date_from', 'date_to']) if (b[k] !== undefined) f[k] = reqDate(b[k], k === 'date_from' ? 'Настаняване от' : 'Настаняване до', { required: false });
    if (b.beds !== undefined && b.beds !== '') f.beds = num(b.beds, 'Легла', { min: 0 });
    if (b.cost_per_night !== undefined && b.cost_per_night !== '') f.cost_per_night = num(b.cost_per_night, 'Цена за нощувка', { min: 0 });
    return f;
  };
  app.post('/api/accommodations', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const b = req.body || {};
    const pid = optProject(req, b.project_id);
    if (pid == null) throw bad('Обектът е задължителен');
    const f = accoFields(b);
    if (!f.place) throw bad('Полето „Място“ е задължително');
    const id = Number(db.prepare('INSERT INTO accommodations(project_id, place, address, date_from, date_to, beds, cost_per_night, payment_method, parking, workers, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(pid, f.place, f.address ?? null, f.date_from ?? null, f.date_to ?? null, f.beds ?? null, f.cost_per_night ?? 0, f.payment_method ?? null, f.parking ?? null, f.workers ?? null, f.note ?? null, req.user.id).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'accommodation', entity_id: id, action: 'create', after: f, module: 'accounting' });
    emit(db, req.user, { type: 'accommodation.recorded', origin: 'accounting', project_id: pid, entity_type: 'accommodation', entity_id: id,
      dedupe_key: `accommodation.recorded:${id}`, next: { place: f.place }, affected: ['accounting'] });
    return db.prepare(`${accoView} WHERE a.id = ?`).get(id);
  })));
  app.patch('/api/accommodations/:id', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const a = db.prepare('SELECT * FROM accommodations WHERE id = ?').get(Number(req.params.id));
    if (!a) throw new HttpError(404, 'Няма такъв запис');
    needProjectGuard(req.user, a.project_id);
    const f = accoFields(req.body || {});
    updateRow(db, 'accommodations', a.id, f, req.body?.row_version);
    audit(db, req.user, { project_id: a.project_id, entity_type: 'accommodation', entity_id: a.id, action: 'update', before: pick(a, Object.keys(f)), after: f, module: 'accounting' });
    return db.prepare(`${accoView} WHERE a.id = ?`).get(a.id);
  })));
}

// Събития, които само уведомяват хора (парите не се пипат тук).
on('payment_request.created', 'notify_management', (db, ev) => {
  const r = db.prepare('SELECT r.*, p.code AS pcode FROM payment_requests r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = ?').get(ev.entity_id);
  if (!r) return { skipped: true };
  return notify(db, ev, { departments: ['management'], severity: r.exceptional ? 'warn' : 'info',
    title: `Заявка за плащане ${r.code}${r.pcode ? ' — ' + r.pcode : ''}`,
    body: `${r.payee}: ${r.amount}. ${r.reason || ''}`.trim(), link: '/accounting' });
});
on('payment_request.decided', 'notify_accounting', (db, ev) => {
  const r = db.prepare('SELECT r.*, p.code AS pcode FROM payment_requests r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = ?').get(ev.entity_id);
  if (!r) return { skipped: true };
  const st = ev.next?.status === 'approved' ? 'одобрена' : 'отхвърлена';
  return notify(db, ev, { departments: ['accounting'],
    title: `Заявка за плащане ${st}: ${r.code}${r.pcode ? ' — ' + r.pcode : ''}`,
    body: `${r.payee}: ${r.amount}.${ev.next?.note ? ' Бележка: ' + ev.next.note : ''}`, link: '/accounting' });
});
