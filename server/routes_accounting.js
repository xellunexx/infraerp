// Счетоводство: проформи, приходи/разходи, заявки за плащане с одобрение от Управител, настаняване, финансов преглед по обект и портфолио.
import crypto from 'node:crypto';
import { tx, nextCode } from './db.js';
import { HttpError, bad, need, can, canSeeProject, scopeRows, redactMoney, audit, updateRow, emit, notify, on, setting, resolveApproval } from './core.js';
import { documentState, proformaState, orderDates, similarPayments, vatInside } from './payments.js';
import { recordPayment, paymentAmount, bankDate } from './routes_payments.js';
import { finance, personCard, supplierOrderView, round2 } from './calc.js';
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
// §14.1: the workbook's hand-typed „вид" column becomes a fixed vocabulary; category stays free text below it
const TX_KINDS = ['client', 'supplier_doc', 'bank_in', 'bank_out', 'proforma', 'labour', 'fiscal', 'card', 'no_doc', 'store', 'other'];
const TX_METHODS = ['bank', 'cash', 'card'];
const SO_MANUAL_STATUSES = ['ordered', 'delivered', 'cancelled']; // 'ordered' resets to auto-derived status

export default function mountAccounting(app, db) {
  const project = id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const needPid = (req, pid, action = 'read') => { need(req.user, 'finance', action); if (pid != null) { if (!project(pid)) throw new HttpError(404, 'Обектът не е намерен'); needProjectGuard(req.user, pid); } };
  const needProjectGuard = (u, pid) => { if (!canSeeProject(db, u, pid)) throw new HttpError(403, 'Нямате достъп до този обект'); };

  const optProject = (req, v) => { const pid = v == null || v === '' ? null : Number(v); if (pid != null && !project(pid)) throw new HttpError(404, 'Обектът не е намерен'); if (pid != null) needProjectGuard(req.user, pid); return pid; };

  // ---- views
  const proformaView = `SELECT f.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name, u.full_name AS created_by_name
    FROM proformas f JOIN projects p ON p.id = f.project_id JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = f.created_by`;
  const txView = `SELECT t.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name, pf.code AS proforma_code, u.full_name AS created_by_name,
      ap.name AS person_name, cc.name AS cost_center_name, ast.name AS asset_name, ast.plate AS asset_plate, d.code AS document_code,
      (SELECT COALESCE(SUM(c2.amount), 0) FROM transactions c2 WHERE c2.document_id = t.id AND c2.status = 'paid') AS paid_sum
    FROM transactions t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN proformas pf ON pf.id = t.proforma_id LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN accountable_persons ap ON ap.id = t.person_id LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
    LEFT JOIN assets ast ON ast.id = t.asset_id LEFT JOIN transactions d ON d.id = t.document_id`;
  // open balance lives on document rows: what the invoice is still owed after its settlement rows
  const withOpen = t => t ? { ...t, open_amount: t.document_id != null || t.status === 'voided' || t.status === 'reported' ? null : t.paid_sum ? round2(Math.max(0, t.amount - t.paid_sum)) : t.status === 'paid' ? 0 : t.amount } : t;
  const pfView = f => f ? { ...f, ...proformaState(db, f) } : f;
  const soOut = o => supplierOrderView(o, orderDates(db, o));
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
      proformas: db.prepare(`${proformaView} WHERE f.project_id = ? ORDER BY f.id DESC`).all(...w).map(pfView),
      transactions: db.prepare(`${txView} WHERE t.project_id = ? ORDER BY t.tx_date DESC, t.id DESC`).all(...w).map(withOpen),
      payment_requests: db.prepare(`${prView} WHERE r.project_id = ? ORDER BY r.id DESC`).all(...w),
      accommodations: db.prepare(`${accoView} WHERE a.project_id = ? ORDER BY a.id DESC`).all(...w) };
  }));

  // ---- Проформи
  app.get('/api/proformas', h(req => {
    need(req.user, 'finance');
    const w = wherePid(req, 'f.project_id');
    return scopeRows(db, req.user, db.prepare(`${proformaView}${w ? ' WHERE ' + w : ''} ORDER BY f.id DESC`).all(...(w ? [Number(req.query.project_id)] : []))).map(pfView);
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
    return pfView(db.prepare(`${proformaView} WHERE f.id = ?`).get(id));
  })));
  app.post('/api/proformas/:id/:action', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const pf = db.prepare('SELECT * FROM proformas WHERE id = ?').get(Number(req.params.id));
    if (!pf) throw new HttpError(404, 'Няма такава проформа');
    needProjectGuard(req.user, pf.project_id);
    const action = req.params.action, state = proformaState(db, pf);
    if (action === 'cancel') {
      if (state.status === 'cancelled') throw bad('Проформата вече е отменена');
      if (db.prepare("SELECT 1 FROM transactions WHERE proforma_id = ? AND status IN ('paid', 'reported')").get(pf.id)) throw bad('По проформата има плащане — не се отменя');
      db.prepare("UPDATE proformas SET status = 'cancelled', row_version = row_version + 1 WHERE id = ?").run(pf.id);
      audit(db, req.user, { project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id, action: 'cancel', before: { status: pf.status }, after: { status: 'cancelled' }, module: 'accounting' });
      emit(db, req.user, { type: 'proforma.cancelled', origin: 'accounting', project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id,
        dedupe_key: `proforma.cancelled:${pf.id}:${pf.row_version}`, prev: { status: 'issued' }, next: { status: 'cancelled' }, affected: ['accounting'] });
      return pfView(db.prepare(`${proformaView} WHERE f.id = ?`).get(pf.id));
    }
    if (action !== 'paid') throw bad('Непозната операция');
    if (state.status === 'cancelled') throw bad('Отменена проформа не може да бъде платена');
    const out = (row, deduped) => ({ proforma: pfView(db.prepare(`${proformaView} WHERE f.id = ?`).get(pf.id)), transaction: withOpen(db.prepare(`${txView} WHERE t.id = ?`).get(row.id)), deduped });
    if (state.status === 'paid') return out(db.prepare("SELECT id FROM transactions WHERE proforma_id = ? AND status = 'paid' ORDER BY id DESC").get(pf.id), true);
    const b = req.body || {}, tx_date = bankDate(b.paid_at), amount = b.amount == null || b.amount === '' ? round2(state.gross - state.paid) : paymentAmount(b.amount);
    const cust = db.prepare('SELECT c.name FROM customers c JOIN projects p ON p.customer_id = c.id WHERE p.id = ?').get(pf.project_id);
    const r = recordPayment(db, req.user, { project_id: pf.project_id, direction: 'in', status: 'paid', uid: b.uid, amount, tx_date, separate: b.separate === true, proforma: pf, vat_pct: pf.vat_pct,
      category: pf.kind, counterparty: cust?.name, document_ref: pf.code });
    audit(db, req.user, { project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id, action: 'paid', before: { paid: state.paid }, after: { transaction_id: r.payment.id, amount }, module: 'accounting' });
    if (proformaState(db, pf).status === 'paid') emit(db, req.user, { type: 'proforma.paid', origin: 'accounting', project_id: pf.project_id, entity_type: 'proforma', entity_id: pf.id,
      dedupe_key: `proforma.paid:${pf.id}:${r.payment.id}`, prev: { status: 'issued' }, next: { status: 'paid', amount: pf.amount }, affected: ['accounting'] });
    return out(r.payment, r.deduped);
  })));

  // ---- Транзакции (приходи и разходи)
  const txFilters = req => {
    const w = [], args = [];
    const q = req.query || {};
    if (q.project_id) { w.push('t.project_id = ?'); args.push(Number(q.project_id)); }
    if (q.person_id) { w.push('t.person_id = ?'); args.push(Number(q.person_id)); }
    if (q.cost_center_id) { w.push('t.cost_center_id = ?'); args.push(Number(q.cost_center_id)); }
    if (q.asset_id) { w.push('t.asset_id = ?'); args.push(Number(q.asset_id)); }
    if (q.company) { w.push('t.company = ?'); args.push(String(q.company)); }
    if (q.tx_kind) { w.push('t.tx_kind = ?'); args.push(String(q.tx_kind)); }
    if (q.direction) { w.push('t.direction = ?'); args.push(String(q.direction)); }
    if (q.from) { w.push('t.tx_date >= ?'); args.push(String(q.from)); }
    if (q.to) { w.push('t.tx_date <= ?'); args.push(String(q.to)); }
    if (q.document_id === 'null' || q.roots === '1') w.push('t.document_id IS NULL');
    else if (q.document_id) { w.push('t.document_id = ?'); args.push(Number(q.document_id)); }
    return { sql: w.length ? ' WHERE ' + w.join(' AND ') : '', args };
  };
  app.get('/api/transactions', h(req => {
    need(req.user, 'finance');
    const w = wherePid(req, 't.project_id');
    return scopeRows(db, req.user, db.prepare(`${txView}${w ? ' WHERE ' + w : ''} ORDER BY t.tx_date DESC, t.id DESC`).all(...(w ? [Number(req.query.project_id)] : []))).map(withOpen);
  }));
  // ---- Книга: the single ledger, filtered into views (§14.1) — project / person / company / cost center / period
  app.get('/api/ledger', h(req => {
    need(req.user, 'finance');
    const { sql, args } = txFilters(req);
    const rows = scopeRows(db, req.user, db.prepare(`${txView}${sql} ORDER BY t.tx_date DESC, t.id DESC`).all(...args)).map(withOpen);
    // a document with payments is represented by them; planned and reported rows are not owed yet
    const live = rows.filter(t => !['voided', 'planned', 'reported'].includes(t.status)).map(t => t.document_id == null && t.paid_sum ? { ...t, represented: true } : t);
    const moved = live.filter(t => t.status === 'paid' && !t.represented);
    const totals = { in: round2(moved.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0)),
      out: round2(moved.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0)),
      open_in: round2(live.filter(t => t.direction === 'in' && t.open_amount > 0).reduce((s, t) => s + t.open_amount, 0)),
      open_out: round2(live.filter(t => t.direction === 'out' && t.open_amount > 0).reduce((s, t) => s + t.open_amount, 0)) };
    const by_company = {};
    for (const t of moved) {
      const k = t.company || '—';
      by_company[k] = by_company[k] || { in: 0, out: 0 };
      by_company[k][t.direction] = round2(by_company[k][t.direction] + t.amount);
    }
    return { rows, totals, by_company, companies: JSON.parse(setting(db, 'finance_companies', '[]')) };
  }));
  // shared field parsing for POST + PATCH (the workbook's money columns as real fields)
  const txFields = (req, b, pid, direction) => {
    const f = {};
    if (b.tx_kind !== undefined) { if (b.tx_kind != null && !TX_KINDS.includes(b.tx_kind)) throw bad('Невалиден вид операция'); f.tx_kind = b.tx_kind || null; }
    if (b.method !== undefined) { if (b.method != null && !TX_METHODS.includes(b.method)) throw bad('Невалиден начин на плащане'); f.method = b.method || null; }
    if (b.company !== undefined) f.company = b.company || null;
    if (b.counterparty !== undefined) f.counterparty = b.counterparty || null;
    if (b.document_ref !== undefined) f.document_ref = b.document_ref || null;
    if (b.pko_no !== undefined) f.pko_no = b.pko_no || null;
    if (b.rko_no !== undefined) f.rko_no = b.rko_no || null;
    if (b.has_vat !== undefined) f.has_vat = b.has_vat ? 1 : 0;
    if (b.vat_amount !== undefined) f.vat_amount = b.vat_amount == null || b.vat_amount === '' ? null : num(b.vat_amount, 'ДДС сума', { min: 0 });
    if (b.labour_worker !== undefined) f.labour_worker = b.labour_worker || null;
    if (b.labour_days !== undefined) f.labour_days = b.labour_days == null || b.labour_days === '' ? null : num(b.labour_days, 'Дни', { min: 0 });
    if (b.labour_rate !== undefined) f.labour_rate = b.labour_rate == null || b.labour_rate === '' ? null : num(b.labour_rate, 'Надница', { min: 0 });
    if (b.person_id !== undefined) f.person_id = b.person_id == null || b.person_id === '' ? null : (db.prepare('SELECT id FROM accountable_persons WHERE id = ?').get(Number(b.person_id)) || (() => { throw bad('Няма такова подотчетно лице'); })()).id;
    if (b.cost_center_id !== undefined) f.cost_center_id = b.cost_center_id == null || b.cost_center_id === '' ? null : (db.prepare('SELECT id FROM cost_centers WHERE id = ?').get(Number(b.cost_center_id)) || (() => { throw bad('Няма такъв център на разходите'); })()).id;
    if (b.asset_id !== undefined) f.asset_id = b.asset_id == null || b.asset_id === '' ? null : (db.prepare('SELECT id FROM assets WHERE id = ?').get(Number(b.asset_id)) || (() => { throw bad('Няма такова МПС'); })()).id;
    // a settlement row must point at an existing document row of the same direction
    if (b.document_id !== undefined) {
      if (b.document_id == null || b.document_id === '') f.document_id = null;
      else {
        const doc = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(b.document_id));
        if (!doc || doc.status === 'voided' || doc.status === 'reported') throw bad('Няма такъв документ за плащане');
        if (doc.status === 'paid' && !db.prepare("SELECT 1 FROM transactions WHERE document_id = ? AND status = 'paid'").get(doc.id)) throw bad('Документът вече е отбелязан като платен изцяло');
        if (doc.direction !== direction) throw bad('Плащането и документът трябва да са в една посока');
        if (doc.document_id != null) throw bad('Плащане не може да се връзва към друго плащане — изберете документа');
        f.document_id = doc.id;
      }
    }
    return f;
  };
  app.post('/api/transactions', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const b = req.body || {};
    const pid = optProject(req, b.project_id);
    const direction = b.direction;
    if (!['in', 'out'].includes(direction)) throw bad('Посоката трябва да е „in“ или „out“');
    const category = reqStr(b.category, 'Категория');
    const labourAmt = b.labour_days != null && b.labour_rate != null && b.labour_days !== '' && b.labour_rate !== '' ? Number(b.labour_days) * Number(b.labour_rate) : null;
    const amount = b.amount != null && b.amount !== '' ? num(b.amount, 'Сума', { min: 0.000001 }) : labourAmt != null && labourAmt > 0 ? round2(labourAmt) : num(b.amount, 'Сума', { min: 0.000001 });
    const status = b.status || 'paid';
    if (!['planned', 'committed', 'paid'].includes(status)) throw bad('Невалиден статус');
    let proformaId = null;
    if (b.proforma_id != null && b.proforma_id !== '') {
      const pf = db.prepare('SELECT * FROM proformas WHERE id = ?').get(Number(b.proforma_id));
      if (!pf) throw bad('Няма такава проформа');
      if (pid != null && pf.project_id !== pid) throw bad('Проформата е за друг обект');
      proformaId = pf.id;
    }
    const ext = txFields(req, b, pid, direction);
    // a payment typed straight into the ledger against a proforma is the same fact as „Запиши плащане“: same checks, same VAT share
    if (proformaId != null) {
      if (direction !== 'in') throw bad('По проформа се записва само приход');
      const pf = db.prepare('SELECT * FROM proformas WHERE id = ?').get(proformaId);
      if (pf.status === 'cancelled') throw bad('Отменена проформа не може да бъде платена');
      if (status === 'paid') { bankDate(b.tx_date); const like = similarPayments(db, { project_id: pf.project_id, direction, amount, tx_date: b.tx_date });
        if (like.length && b.separate !== true) throw new HttpError(409, 'Има подобно плащане по този обект. Посочете дали е същото или отделно.', { similar: like }); }
      if (b.has_vat === undefined) { ext.has_vat = 1; ext.vat_amount = vatInside(amount, pf.vat_pct); }
    }
    const companyDefault = JSON.parse(setting(db, 'finance_companies', '[]'))[0] || null;
    const f = { code: nextCode(db, 'TXN'), uid: crypto.randomUUID(), project_id: pid, direction, category, amount, status,
      tx_date: reqDate(b.tx_date, 'Дата'), due_on: reqDate(b.due_on, 'Срок', { required: false }),
      counterparty: b.counterparty || null, document_ref: b.document_ref || null, proforma_id: proformaId,
      note: b.note || null, created_by: req.user.id };
    if (ext.company === undefined) ext.company = companyDefault;
    const cols = ['code', 'uid', 'project_id', 'direction', 'category', 'amount', 'status', 'tx_date', 'due_on', 'counterparty', 'document_ref', 'proforma_id', 'note', 'created_by',
      'tx_kind', 'method', 'company', 'document_id', 'cost_center_id', 'person_id', 'asset_id', 'has_vat', 'vat_amount', 'pko_no', 'rko_no', 'labour_worker', 'labour_days', 'labour_rate'];
    const vals = cols.map(c => c === 'has_vat' ? (ext.has_vat ?? 0) : (f[c] !== undefined ? f[c] : (ext[c] ?? null)));
    const id = Number(db.prepare(`INSERT INTO transactions(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'transaction', entity_id: id, action: 'create', after: { code: f.code, direction, amount, category, tx_kind: ext.tx_kind || null }, module: 'accounting' });
    emit(db, req.user, { type: 'transaction.recorded', origin: 'accounting', project_id: pid, entity_type: 'transaction', entity_id: id,
      dedupe_key: `transaction.recorded:${id}`, next: { code: f.code, direction, amount, category }, affected: ['accounting'] });
    return withOpen(db.prepare(`${txView} WHERE t.id = ?`).get(id));
  })));
  app.patch('/api/transactions/:id', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
    if (!t) throw new HttpError(404, 'Няма такава транзакция');
    needProjectGuard(req.user, t.project_id);
    const b = req.body || {};
    if (t.status === 'reported') throw bad('Докладвано плащане се решава само с потвърждение или отхвърляне');
    const f = pick(b, ['category', 'amount', 'tx_date', 'due_on', 'counterparty', 'document_ref', 'proforma_id', 'status', 'note']);
    if (f.category !== undefined) f.category = reqStr(f.category, 'Категория');
    if (f.amount !== undefined) f.amount = num(f.amount, 'Сума', { min: 0.000001 });
    for (const k of ['tx_date', 'due_on']) if (f[k] !== undefined) f[k] = reqDate(f[k], k === 'tx_date' ? 'Дата' : 'Срок', { required: k === 'tx_date' });
    if (f.status !== undefined && !TX_STATUSES.includes(f.status)) throw bad('Невалиден статус');
    const kids = db.prepare("SELECT * FROM transactions WHERE document_id = ? AND status = 'paid'").all(t.id), { settled } = documentState({ ...t, status: 'committed' }, kids);
    if (kids.length && f.status === 'voided') throw bad('По документа има плащания — първо ги анулирайте');
    if (kids.length && f.amount !== undefined && f.amount < settled - 0.005) throw bad(`По документа вече е платено ${settled.toFixed(2)}`);
    // a linked bank payment keeps its VAT share when the amount is corrected, and its date stays a real bank date
    if (t.proforma_id || t.contract_payment_id || t.supplier_order_id) {
      if (f.amount !== undefined) { f.amount = paymentAmount(f.amount); if (t.has_vat && b.vat_amount === undefined) f.vat_amount = round2(t.vat_amount * f.amount / t.amount); }
      if (f.tx_date !== undefined) f.tx_date = bankDate(f.tx_date);
    }
    if (f.proforma_id !== undefined && f.proforma_id !== null) {
      const pf = db.prepare('SELECT * FROM proformas WHERE id = ?').get(Number(f.proforma_id));
      if (!pf) throw bad('Няма такава проформа');
      if (t.project_id != null && pf.project_id !== t.project_id) throw bad('Проформата е за друг обект');
      f.proforma_id = pf.id;
    }
    Object.assign(f, txFields(req, b, t.project_id, t.direction));
    if (f.document_id != null && kids.length) throw bad('Документ с плащания не може да стане плащане');
    if (f.document_id === t.id) throw bad('Плащането не може да сочи към самия документ');
    updateRow(db, 'transactions', t.id, f, b.row_version);
    audit(db, req.user, { project_id: t.project_id, entity_type: 'transaction', entity_id: t.id, action: 'update', before: pick(t, Object.keys(f)), after: f, module: 'accounting' });
    return withOpen(db.prepare(`${txView} WHERE t.id = ?`).get(t.id));
  })));

  // ---- Заявки за плащане -> одобрение от Управител (парите се въвеждат ръчно като транзакция)
  app.get('/api/payment-requests', h(req => {
    need(req.user, 'finance');
    const w = wherePid(req, 'r.project_id');
    return scopeRows(db, req.user, db.prepare(`${prView}${w ? ' WHERE ' + w : ''} ORDER BY r.id DESC`).all(...(w ? [Number(req.query.project_id)] : [])));
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
    return scopeRows(db, req.user, db.prepare(`${accoView}${w ? ' WHERE ' + w : ''} ORDER BY a.id DESC`).all(...(w ? [Number(req.query.project_id)] : [])));
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

  // ---- Подотчетни лица (§14.2): the card is a view over the ledger, never a copy
  const personView = `SELECT p.*, u.full_name AS user_name, u.username FROM accountable_persons p LEFT JOIN users u ON u.id = p.user_id`;
  app.get('/api/accountable-persons', h(req => {
    need(req.user, 'finance');
    return db.prepare(`${personView} ORDER BY p.name`).all().map(p => ({ ...p, ...Object.fromEntries(Object.entries(personCard(db, p.id)).filter(([k]) => k !== 'movements')) }));
  }));
  app.post('/api/accountable-persons', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const b = req.body || {}, name = reqStr(b.name, 'Име');
    let user_id = null;
    if (b.user_id != null && b.user_id !== '') { if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(Number(b.user_id))) throw bad('Няма такъв потребител'); user_id = Number(b.user_id); }
    const id = Number(db.prepare('INSERT INTO accountable_persons(code, name, user_id, note) VALUES (?,?,?,?)')
      .run(nextCode(db, 'PER'), name, user_id, b.note || null).lastInsertRowid);
    audit(db, req.user, { entity_type: 'accountable_person', entity_id: id, action: 'create', after: { name }, module: 'accounting' });
    return db.prepare(`${personView} WHERE p.id = ?`).get(id);
  })));
  app.patch('/api/accountable-persons/:id', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const p = db.prepare('SELECT * FROM accountable_persons WHERE id = ?').get(Number(req.params.id));
    if (!p) throw new HttpError(404, 'Няма такова лице');
    const f = pick(req.body || {}, ['name', 'note', 'active']);
    if (f.name !== undefined) f.name = reqStr(f.name, 'Име');
    if (req.body?.user_id !== undefined) { const uid = req.body.user_id == null || req.body.user_id === '' ? null : Number(req.body.user_id); if (uid != null && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) throw bad('Няма такъв потребител'); f.user_id = uid; }
    updateRow(db, 'accountable_persons', p.id, f, req.body?.row_version);
    audit(db, req.user, { entity_type: 'accountable_person', entity_id: p.id, action: 'update', before: pick(p, Object.keys(f)), after: f, module: 'accounting' });
    return db.prepare(`${personView} WHERE p.id = ?`).get(p.id);
  })));
  app.get('/api/accountable-persons/:id/card', h(req => {
    need(req.user, 'finance');
    const p = db.prepare(`${personView} WHERE p.id = ?`).get(Number(req.params.id));
    if (!p) throw new HttpError(404, 'Няма такова лице');
    return { person: p, ...personCard(db, p.id) };
  }));

  // ---- Центрове на разходите (§14.b): офис / склад / механизация / маркетинг / лични / кредити…
  app.get('/api/cost-centers', h(req => { need(req.user, 'finance'); return db.prepare('SELECT * FROM cost_centers ORDER BY name').all(); }));
  app.post('/api/cost-centers', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const b = req.body || {}, name = reqStr(b.name, 'Име');
    const id = Number(db.prepare('INSERT INTO cost_centers(code, name, kind) VALUES (?,?,?)').run(nextCode(db, 'CC'), name, b.kind || 'overhead').lastInsertRowid);
    audit(db, req.user, { entity_type: 'cost_center', entity_id: id, action: 'create', after: { name, kind: b.kind || 'overhead' }, module: 'accounting' });
    return db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(id);
  })));
  app.patch('/api/cost-centers/:id', h(req => tx(db, () => {
    need(req.user, 'finance', 'write');
    const c = db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(Number(req.params.id));
    if (!c) throw new HttpError(404, 'Няма такъв център');
    const f = pick(req.body || {}, ['name', 'kind', 'active']);
    if (f.name !== undefined) f.name = reqStr(f.name, 'Име');
    updateRow(db, 'cost_centers', c.id, f, req.body?.row_version);
    audit(db, req.user, { entity_type: 'cost_center', entity_id: c.id, action: 'update', before: pick(c, Object.keys(f)), after: f, module: 'accounting' });
    return db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(c.id);
  })));

  // ---- Поръчки към доставчици (§14.4): countdown on real bank dates, never typed deadlines
  // споделеният запис се обслужва и от Логистика — тя следи движението на поръчките (един запис, различни изгледи)
  const needSO = (u, action = 'read') => { if (!can(u, 'finance', action)) need(u, 'logistics', action); };
  const soView = `SELECT o.*, p.code AS project_code, p.name AS project_name, l.description AS line_description, u.full_name AS created_by_name
    FROM supplier_orders o JOIN projects p ON p.id = o.project_id LEFT JOIN project_lines l ON l.id = o.project_line_id
    LEFT JOIN users u ON u.id = o.created_by`;
  const soFields = (req, b, { forCreate = false, row = null, pid = row?.project_id } = {}) => {
    const f = {};
    if (forCreate || b.supplier !== undefined) f.supplier = reqStr(b.supplier, 'Доставчик');
    for (const k of ['order_doc_no', 'note']) if (b[k] !== undefined) f[k] = b[k] || null;
    for (const k of ['total_eur', 'advance_eur', 'prod_days', 'transport_days']) if (b[k] !== undefined)
      f[k] = b[k] == null || b[k] === '' ? (forCreate ? 0 : k.endsWith('_eur') ? (() => { throw bad('Стойността е задължителна'); })() : null) : num(b[k], k === 'total_eur' ? 'Обща стойност' : k === 'advance_eur' ? 'Аванс' : 'Дни', { min: 0 });
    if (b.advance_paid_at || b.final_paid_at) throw bad('Датата идва от самото плащане — използвайте „Запиши плащане“ по поръчката');
    if (b.status !== undefined) { if (!SO_MANUAL_STATUSES.includes(b.status)) throw bad('Статусът се извежда сам; ръчно може само „delivered“, „cancelled“ или „ordered“ за връщане към автоматичен'); f.status = b.status; }
    if (b.project_line_id !== undefined) f.project_line_id = b.project_line_id == null || b.project_line_id === '' ? null : (db.prepare('SELECT id FROM project_lines WHERE id = ? AND project_id = ?').get(Number(b.project_line_id), pid) || (() => { throw bad('Няма такъв ред от КС'); })()).id;
    if ((f.advance_eur ?? row?.advance_eur ?? 0) > (f.total_eur ?? row?.total_eur ?? 0)) throw bad('Авансът не може да е над общата стойност');
    return f;
  };
  app.get('/api/supplier-orders', h(req => {
    needSO(req.user);
    const w = [], args = [];
    if (req.query.project_id) { w.push('o.project_id = ?'); args.push(Number(req.query.project_id)); }
    // amounts belong to finance and to those who maintain the orders; other readers follow dates and status only
    const rows = scopeRows(db, req.user, db.prepare(`${soView}${w.length ? ' WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC`).all(...args)).map(soOut);
    return can(req.user, 'finance') || can(req.user, 'logistics', 'write') ? rows : redactMoney(rows);
  }));
  app.post('/api/supplier-orders', h(req => tx(db, () => {
    needSO(req.user, 'write');
    const b = req.body || {};
    const pid = optProject(req, b.project_id);
    if (pid == null) throw bad('Обектът е задължителен');
    const f = soFields(req, b, { forCreate: true, pid });
    const id = Number(db.prepare(`INSERT INTO supplier_orders(code, project_id, project_line_id, supplier, order_doc_no, total_eur, advance_eur,
      prod_days, transport_days, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(nextCode(db, 'SO'), pid, f.project_line_id ?? null, f.supplier, f.order_doc_no ?? null, f.total_eur ?? 0, f.advance_eur ?? 0,
        f.prod_days ?? null, f.transport_days ?? null, 'ordered', f.note ?? null, req.user.id).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'supplier_order', entity_id: id, action: 'create', after: { supplier: f.supplier, total_eur: f.total_eur }, module: 'accounting' });
    emit(db, req.user, { type: 'supplier_order.created', origin: 'accounting', project_id: pid, entity_type: 'supplier_order', entity_id: id,
      dedupe_key: `supplier_order.created:${id}`, next: { supplier: f.supplier, total_eur: f.total_eur }, affected: ['accounting', 'logistics'] });
    return soOut(db.prepare(`${soView} WHERE o.id = ?`).get(id));
  })));
  app.patch('/api/supplier-orders/:id', h(req => tx(db, () => {
    needSO(req.user, 'write');
    const o = db.prepare('SELECT * FROM supplier_orders WHERE id = ?').get(Number(req.params.id));
    if (!o) throw new HttpError(404, 'Няма такава поръчка');
    needProjectGuard(req.user, o.project_id);
    const f = soFields(req, req.body || {}, { row: o });
    updateRow(db, 'supplier_orders', o.id, f, req.body?.row_version);
    audit(db, req.user, { project_id: o.project_id, entity_type: 'supplier_order', entity_id: o.id, action: 'update', before: pick(o, Object.keys(f)), after: f, module: 'accounting' });
    return soOut(db.prepare(`${soView} WHERE o.id = ?`).get(o.id));
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
