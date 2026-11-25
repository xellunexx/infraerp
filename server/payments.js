// Едно плащане — един запис: всичко „платено“ се чете от книгата (transactions). Този модул само смята, никога не пише.
// Сумите в книгата са с ДДС; брои се единствено status = 'paid'.
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.005;
const vatSetting = db => Number(db.prepare("SELECT value FROM settings WHERE key = 'vat_pct'").get()?.value ?? 20);

export const grossOf = (net, vatPct) => r2(net * (1 + vatPct / 100));
export const vatInside = (gross, vatPct) => r2(gross * vatPct / (100 + vatPct));
export const netOf = (tx, vatPct = 20) => tx.has_vat ? tx.amount - (tx.vat_amount ?? vatInside(tx.amount, vatPct)) : tx.amount;
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
export function paidState(rows, gross) {
  let sum = 0, paid_at = null;
  for (const t of [...rows].sort((a, b) => a.tx_date < b.tx_date ? -1 : a.tx_date > b.tx_date ? 1 : a.id - b.id)) {
    sum = r2(sum + t.amount);
    if (!paid_at && gross > 0 && sum >= gross - EPS) paid_at = t.tx_date;
  }
  return { paid: sum, paid_at, over: gross > 0 ? r2(Math.max(0, sum - gross)) : 0 };
}

const milestoneRows = (db, m, projectId, status) => db.prepare(`SELECT * FROM transactions WHERE direction = 'in' AND status = ? AND project_id = ? AND
  (contract_payment_id = ? OR (contract_payment_id IS NULL AND proforma_id IN (SELECT id FROM proformas WHERE project_id = ? AND kind = ?)))`).all(status, projectId, m.id, projectId, m.kind);

export function milestones(db, contractId) {
  const c = db.prepare('SELECT project_id FROM contracts WHERE id = ?').get(contractId);
  if (!c) return [];
  return db.prepare("SELECT * FROM contract_payments WHERE contract_id = ? ORDER BY CASE kind WHEN 'advance' THEN 1 WHEN 'interim' THEN 2 ELSE 3 END").all(contractId).map(m => {
    const vat = m.vat_pct ?? vatSetting(db);
    const gross = m.gross ?? (m.amount == null ? null : grossOf(m.amount, vat));
    // the remainder milestone may differ by a cent from a proforma issued on its net amount: either closes it
    const target = gross == null ? null : Math.min(gross, grossOf(m.amount ?? gross, m.amount == null ? 0 : vat));
    const rows = milestoneRows(db, m, c.project_id, 'paid'), st = paidState(rows, target);
    const reported = r2(milestoneRows(db, m, c.project_id, 'reported').reduce((s, t) => s + t.amount, 0));
    return { id: m.id, kind: m.kind, pct: m.pct, amount: m.amount, net: m.amount, gross, vat_pct: vat, note: m.note, paid: st.paid, paid_at: st.paid_at,
      over: gross > 0 ? r2(Math.max(0, st.paid - gross)) : 0, reported, unmatched_date: m.paid_at && !rows.length ? m.paid_at : null };
  });
}

export function proformaState(db, pf) {
  const gross = grossOf(pf.amount, pf.vat_pct);
  const st = paidState(db.prepare("SELECT * FROM transactions WHERE proforma_id = ? AND direction = 'in' AND status = 'paid'").all(pf.id), gross);
  return { gross, paid: st.paid, paid_at: st.paid_at, status: pf.status === 'cancelled' ? 'cancelled' : st.paid_at ? 'paid' : 'issued' };
}
/** SQL condition: the proforma (alias) is issued and its payments have not reached its gross amount. */
export const proformaOpenSql = a => `${a}.status != 'cancelled' AND (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.proforma_id = ${a}.id AND t.direction = 'in' AND t.status = 'paid') < ROUND(${a}.amount * (1 + ${a}.vat_pct / 100.0), 2) - ${EPS}`;

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
    const paid = kids.all(d.id), { settled, open } = documentState(d, paid), share = netOf(d, vat) / d.amount;
    if (d.direction === 'in') { m.received += settled; m.received_net += settled * share; continue; }
    m.paid_out += settled; m.paid_net += settled * share;
    if (d.status === 'planned' && !paid.length) { m.planned_out += d.amount; continue; }
    m.payables += open; m.expense_net += Math.max(d.amount, settled) * share;
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r2(v)]));
}

export function orderDates(db, order) {
  const rows = stage => db.prepare("SELECT * FROM transactions WHERE supplier_order_id = ? AND order_stage = ? AND status = 'paid'").all(order.id, stage);
  const rest = r2((order.total_eur || 0) - (order.advance_eur || 0));
  return { advance_paid_at: paidState(rows('advance'), order.advance_eur || 0).paid_at, final_paid_at: paidState(rows('final'), rest).paid_at };
}

/** Payments that could be the same transfer: same project and direction, same amount, within 5 days. */
export const similarPayments = (db, { id = 0, project_id, direction, amount, tx_date }) => db.prepare(`SELECT id, code, amount, tx_date, status, document_ref FROM transactions
  WHERE id != ? AND project_id = ? AND direction = ? AND status IN ('reported', 'paid') AND ABS(amount - ?) < ${EPS} AND ABS(julianday(tx_date) - julianday(?)) <= 5 ORDER BY id`).all(id, project_id, direction, amount, tx_date);
