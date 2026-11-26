// Едно плащане — един запис: всичко „платено“ се чете от книгата (transactions). Този модул само смята, никога не пише.
// Сумите в книгата са с ДДС; брои се единствено status = 'paid'.
import { roleOf } from './roles.js';
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.005;
const vatSetting = db => Number(db.prepare("SELECT value FROM settings WHERE key = 'vat_pct'").get()?.value ?? 20);

export const grossOf = (net, vatPct) => r2(net * (1 + vatPct / 100));
export const vatInside = (gross, vatPct) => r2(gross * vatPct / (100 + vatPct));
export const netOf = (tx, vatPct = 20) => tx.has_vat ? tx.amount - (tx.vat_amount ?? vatInside(tx.amount, vatPct)) : tx.amount;
/** The rate a row was recorded at, read back from its amounts. */
export const ratePct = t => t.has_vat && t.vat_amount ? Math.round(t.vat_amount / (t.amount - t.vat_amount) * 1000) / 10 : 0;
/** Today's date where the company works; the server clock may be in another zone. */
export const localToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' });

/** Advance / 30 % interim / the rest: net and gross parts always add up to the contract. */
export function splitSchedule(net, vatPct, advancePct) {
  const interimPct = Math.min(30, Math.max(0, 100 - advancePct)), finalPct = r2(100 - advancePct - interimPct);
  const total = r2(net), gross = grossOf(total, vatPct);
  const a = r2(total * advancePct / 100), i = r2(total * interimPct / 100), ga = grossOf(a, vatPct), gi = grossOf(i, vatPct);
  return [{ kind: 'advance', pct: advancePct, net: a, gross: ga }, { kind: 'interim', pct: interimPct, net: i, gross: gi },
    { kind: 'final', pct: finalPct, net: r2(total - a - i), gross: r2(gross - ga - gi) }];
}

/** When a target is reached by dated rows; null until then. A zero target is never "paid". */
/** With `net`, rows carrying their own VAT may also reach it in net terms (another rate, or cents lost by splitting). */
export function paidState(rows, gross, net = null) {
  let sum = 0, netSum = 0, n = 0, paid_at = null;
  for (const t of [...rows].sort((a, b) => a.tx_date < b.tx_date ? -1 : a.tx_date > b.tx_date ? 1 : a.id - b.id)) {
    sum = r2(sum + t.amount);
    netSum += netOf(t); n++;
    if (!paid_at && gross > 0 && (sum >= gross - EPS || (net > 0 && netSum >= net - 0.01 * n - EPS))) paid_at = t.tx_date;
  }
  return { paid: sum, paid_at, over: gross > 0 ? r2(Math.max(0, sum - gross)) : 0 };
}

const milestoneRows = (db, m, projectId, status) => db.prepare(`SELECT * FROM transactions t WHERE direction = 'in' AND status = ? AND project_id = ? AND NOT EXISTS (SELECT 1 FROM transactions k WHERE k.document_id = t.id AND k.status = 'paid') AND
  (contract_payment_id = ? OR (contract_payment_id IS NULL AND proforma_id IN (SELECT id FROM proformas WHERE project_id = ? AND kind = ?)))`).all(status, projectId, m.id, projectId, m.kind);

export function milestones(db, contractId) {
  const c = db.prepare('SELECT project_id FROM contracts WHERE id = ?').get(contractId);
  if (!c) return [];
  return db.prepare("SELECT * FROM contract_payments WHERE contract_id = ? ORDER BY CASE kind WHEN 'advance' THEN 1 WHEN 'interim' THEN 2 ELSE 3 END").all(contractId).map(m => {
    const vat = m.vat_pct ?? vatSetting(db);
    const gross = m.gross ?? (m.amount == null ? null : grossOf(m.amount, vat));
    const rows = milestoneRows(db, m, c.project_id, 'paid'), st = paidState(rows, gross ?? 0, m.amount);
    const repRows = milestoneRows(db, m, c.project_id, 'reported'), reported = r2(repRows.reduce((s, t) => s + t.amount, 0));
    // notes written with each payment, read from the ledger rows themselves: one note per payment, shown on its milestone
    const payment_notes = [...rows, ...repRows].filter(t => t.note && String(t.note).trim()).sort((x, y) => String(x.tx_date).localeCompare(String(y.tx_date)))
      .map(t => ({ date: t.tx_date, amount: t.amount, note: t.note }));
    return { id: m.id, kind: m.kind, pct: m.pct, amount: m.amount, net: m.amount, gross, vat_pct: vat, note: m.note, payment_notes, paid: st.paid, paid_at: st.paid_at,
      over: gross > 0 ? r2(Math.max(0, st.paid - gross)) : 0, reported, unmatched_date: m.paid_at && !rows.length ? m.paid_at : null };
  });
}

export function proformaState(db, pf) {
  const gross = grossOf(pf.amount, pf.vat_pct);
  const st = paidState(db.prepare("SELECT * FROM transactions t WHERE proforma_id = ? AND direction = 'in' AND status = 'paid' AND NOT EXISTS (SELECT 1 FROM transactions k WHERE k.document_id = t.id AND k.status = 'paid')").all(pf.id), gross);
  return { gross, paid: st.paid, paid_at: st.paid_at, status: pf.status === 'cancelled' ? 'cancelled' : st.paid_at ? 'paid' : 'issued' };
}
/** SQL condition: the proforma (alias) is issued and its payments have not reached its gross amount. */
export const proformaOpenSql = a => `${a}.status != 'cancelled' AND (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.proforma_id = ${a}.id AND NOT EXISTS (SELECT 1 FROM transactions k WHERE k.document_id = t.id AND k.status = 'paid') AND t.direction = 'in' AND t.status = 'paid') < ROUND(${a}.amount * (1 + ${a}.vat_pct / 100.0), 2) - ${EPS}`;

/** A document with payments is worth what was paid on it; without payments its own status decides. */
export function documentState(doc, paidChildren) {
  const kids = paidChildren.filter(k => k.status === 'paid');
  if (doc.status === 'voided' || doc.status === 'reported') return { settled: 0, open: 0 };
  const settled = kids.length ? r2(kids.reduce((s, k) => s + k.amount, 0)) : doc.status === 'paid' ? doc.amount : 0;
  return { settled, open: r2(Math.max(0, doc.amount - settled)) };
}

export function projectMoney(db, projectId) {
  const vat = vatSetting(db);
  const docs = db.prepare("SELECT * FROM transactions WHERE project_id = ? AND document_id IS NULL AND status NOT IN ('voided', 'reported')").all(projectId);
  const kids = db.prepare("SELECT * FROM transactions WHERE document_id = ? AND status = 'paid'");
  const m = { received: 0, paid_out: 0, payables: 0, received_net: 0, paid_net: 0, expense_net: 0, planned_out: 0 };
  for (const d of docs) {
    const role = roleOf(d), paid = kids.all(d.id), { settled, open } = documentState(d, paid), share = netOf(d, vat) / d.amount;
    if (d.direction === 'in') { if (role !== 'return') { m.received += settled; m.received_net += settled * share; } continue; }
    if (role === 'stock') { if (d.status !== 'planned') m.expense_net += d.amount * share; continue; } // cost of the project, never a bill, never money paid
    if (role === 'advance') continue; // money handed to a person: the project spends it through the costs the person pays
    m.paid_out += settled; m.paid_net += settled * share;
    if (role === 'payment') continue; // money moved, not a cost: the cost is the document it pays
    if (d.status === 'planned' && !paid.length) { m.planned_out += d.amount; continue; }
    m.payables += open; m.expense_net += Math.max(d.amount, settled) * share;
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r2(v)]));
}

/** Client documents (with VAT and without) and the proformas no invoice has replaced yet. */
export function clientDocuments(db, projectId) {
  const vat = vatSetting(db);
  const docs = db.prepare("SELECT * FROM transactions WHERE project_id = ? AND direction = 'in' AND document_id IS NULL AND status IN ('committed', 'paid')").all(projectId).filter(t => roleOf(t) === 'income_doc');
  let gross = docs.reduce((s, d) => s + d.amount, 0), net = docs.reduce((s, d) => s + netOf(d, vat), 0);
  for (const f of db.prepare("SELECT * FROM proformas WHERE project_id = ? AND status != 'cancelled'").all(projectId)) {
    const g = grossOf(f.amount, f.vat_pct), invoiced = docs.filter(d => d.proforma_id === f.id).reduce((s, d) => s + d.amount, 0), rest = Math.max(0, g - invoiced);
    gross += rest; net += g ? f.amount * rest / g : 0; // only what the invoices have not yet covered
  }
  return { gross: r2(gross), net: r2(net) };
}

/** The project result block of the company workbook, line by line. */
export function projectResult(db, projectId) {
  const vat = vatSetting(db), rate = Number(db.prepare("SELECT value FROM settings WHERE key = 'indirect_per_manday'").get()?.value ?? 150);
  const rows = db.prepare("SELECT * FROM transactions WHERE project_id = ? AND document_id IS NULL AND status NOT IN ('voided', 'reported', 'planned')").all(projectId);
  let materials = 0, labour = 0, days = 0, unknown = 0;
  for (const t of rows) {
    if (t.direction !== 'out') continue;
    const role = roleOf(t);
    if (role === 'cost' && t.tx_kind === 'labour') { labour += netOf(t, vat); if (t.labour_days > 0) days += t.labour_days; else unknown++; continue; }
    if (role === 'cost' || role === 'stock' || (role === 'legacy' && t.status !== 'planned')) materials += netOf(t, vat);
  }
  const income = clientDocuments(db, projectId).net, total = materials + labour, before = income - total, indirect = days * rate;
  return { income_net: r2(income), materials_net: r2(materials), labour: r2(labour), total_cost: r2(total), result_before: r2(before),
    man_days: r2(days), indirect_rate: rate, indirect: r2(indirect), result_after: r2(before - indirect), unknown_days: unknown };
}

export function orderDates(db, order) {
  const rows = stage => db.prepare("SELECT * FROM transactions WHERE supplier_order_id = ? AND order_stage = ? AND status = 'paid'").all(order.id, stage);
  const rest = r2((order.total_eur || 0) - (order.advance_eur || 0));
  const a = paidState(rows('advance'), order.advance_eur || 0), f = paidState(rows('final'), rest);
  const unlinked = db.prepare("SELECT 1 FROM transactions WHERE supplier_order_id = ? AND status = 'paid' AND document_id IS NULL").get(order.id);
  const last = db.prepare("SELECT * FROM transactions WHERE supplier_order_id = ? AND status IN ('paid', 'reported') ORDER BY id DESC LIMIT 1").get(order.id);
  return { awaiting_invoice: !!unlinked, last_vat_pct: last ? ratePct(last) : null, advance_paid_at: a.paid_at, final_paid_at: f.paid_at, advance_paid_amount: a.paid, final_paid_amount: f.paid };
}

/** Payments that could be the same transfer: same project and direction, same amount, within 5 days. */
export const similarPayments = (db, { id = 0, project_id, direction, amount, tx_date }) => db.prepare(`SELECT id, code, amount, tx_date, status, document_ref FROM transactions
  WHERE id != ? AND project_id = ? AND direction = ? AND status IN ('reported', 'paid') AND ABS(amount - ?) < ${EPS} AND ABS(julianday(tx_date) - julianday(?)) <= 5 ORDER BY id`).all(id, project_id, direction, amount, tx_date);
