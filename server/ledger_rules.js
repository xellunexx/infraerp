// Правилата на книгата на едно място: викат се след ВСЕКИ запис в transactions, откъдето и да идва (форма, потвърждение, обединяване, заявка за промяна).
// Гледат крайното състояние на реда; нарушение = грешка в същата транзакция, нищо не се записва.
import { HttpError, bad } from './core.js';
import { similarPayments, vatInside, localToday } from './payments.js';
import { roleOf } from './roles.js';

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export function bankDate(v) {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s)) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) throw bad('Въведете датата на плащането по банка');
  if (s > localToday()) throw bad('Датата на плащането не може да е в бъдещето');
  return s;
}
export const refuseSimilar = list => { throw new HttpError(409, 'Има подобно плащане по този обект. Посочете дали е същото или отделно.', { similar: list }); };

export function settleRow(db, id, { before = null, separate = false } = {}) {
  const row = x => db.prepare('SELECT * FROM transactions WHERE id = ?').get(x), t = row(id);
  const kids = db.prepare("SELECT * FROM transactions WHERE document_id = ? AND status IN ('paid', 'reported')").all(id);
  if (kids.length) {
    if (!['cost', 'income_doc', 'legacy'].includes(roleOf(t))) throw bad('Документ с плащания остава документ: видът му не може да е превод, аванс или склад');
    // a re-linked document takes its payments along to the new proforma or milestone
    if (before && t.direction === 'in' && (before.proforma_id !== t.proforma_id || before.contract_payment_id !== t.contract_payment_id))
      db.prepare('UPDATE transactions SET proforma_id = ?, contract_payment_id = ? WHERE document_id = ? AND proforma_id IS ? AND contract_payment_id IS ?').run(t.proforma_id, t.contract_payment_id, t.id, before.proforma_id, before.contract_payment_id);
    const paid = r2(kids.filter(k => k.status === 'paid').reduce((s, k) => s + k.amount, 0));
    if (t.status === 'voided') throw bad('По документа има плащания — първо ги анулирайте');
    if (t.document_id != null) throw bad('Документ с плащания не може да стане плащане');
    if (kids.some(k => k.direction !== t.direction || k.project_id !== t.project_id)) throw bad('Документ с плащания не сменя посока или обект');
    if (before && t.amount < before.amount && t.amount < paid - 0.005) throw bad(`По документа вече е платено ${paid.toFixed(2)}`);
    if (t.status === 'paid' && before?.status !== 'paid' && kids.some(k => k.status === 'reported')) throw bad('По документа има докладвано плащане — първо го решете');
    if (t.status === 'paid' && before?.status !== 'paid' && paid < t.amount - 0.005) throw bad(`По документа са платени ${paid.toFixed(2)} от ${t.amount.toFixed(2)}`);
  }
  if (t.status === 'voided') return t;
  if (t.document_id != null) {
    const d = row(t.document_id);
    // a payment on a client invoice that settles a proforma pays that proforma and its milestone too
    if (d && t.direction === 'in' && (d.proforma_id != null || d.contract_payment_id != null) && t.proforma_id == null && t.contract_payment_id == null) {
      db.prepare('UPDATE transactions SET proforma_id = ?, contract_payment_id = ? WHERE id = ?').run(d.proforma_id, d.contract_payment_id, t.id);
      return settleRow(db, id, { before, separate });
    }
    if (!d || d.status === 'voided' || d.status === 'reported') throw bad('Няма такъв документ за плащане');
    if (d.id === t.id || d.document_id != null) throw bad('Плащане се връзва само към документ');
    if (d.direction !== t.direction) throw bad('Плащането и документът трябва да са в една посока');
    if (d.project_id !== t.project_id) throw bad('Плащането и документът са за различни обекти');
    if (d.status === 'paid' && !db.prepare("SELECT 1 FROM transactions WHERE document_id = ? AND id != ? AND status = 'paid'").get(d.id, t.id)) throw bad('Документът вече е отбелязан като платен изцяло');
  }
  const linked = t.proforma_id != null || t.contract_payment_id != null || t.supplier_order_id != null;
  if (!linked) return t;
  if (t.proforma_id != null || t.contract_payment_id != null) {
    if (t.direction !== 'in') throw bad('По проформа или етап се записва само приход');
    const pf = t.proforma_id == null ? null : db.prepare('SELECT * FROM proformas WHERE id = ?').get(t.proforma_id);
    const m = t.contract_payment_id == null ? null : db.prepare('SELECT m.*, c.project_id FROM contract_payments m JOIN contracts c ON c.id = m.contract_id WHERE m.id = ?').get(t.contract_payment_id);
    if ((pf && pf.project_id !== t.project_id) || (m && m.project_id !== t.project_id)) throw bad('Проформата или етапът са за друг обект');
    if (pf?.status === 'cancelled') throw bad('Отменена проформа не може да бъде платена');
    if (pf && m && pf.kind !== m.kind) throw bad('Проформата и етапът са от различен вид');
    const vat = pf?.vat_pct ?? m?.vat_pct ?? Number(db.prepare("SELECT value FROM settings WHERE key = 'vat_pct'").get()?.value ?? 20);
    db.prepare('UPDATE transactions SET has_vat = 1, vat_amount = ? WHERE id = ?').run(vatInside(t.amount, vat), t.id); // the VAT share always follows the amount
  }
  if (t.supplier_order_id != null) {
    const o = db.prepare('SELECT project_id FROM supplier_orders WHERE id = ?').get(t.supplier_order_id);
    if (t.direction !== 'out' || !o || o.project_id !== t.project_id || !['advance', 'final'].includes(t.order_stage)) throw bad('Плащането не съответства на поръчката');
    // a corrected amount keeps the stated rate; the edit form echoes the old share unchanged
    if (t.has_vat && before?.has_vat && t.amount !== before.amount && t.vat_amount === before.vat_amount) db.prepare('UPDATE transactions SET vat_amount = ? WHERE id = ?').run(r2(t.vat_amount * t.amount / before.amount), t.id);
    else if (t.has_vat && !(t.vat_amount >= 0 && t.vat_amount < t.amount)) throw bad('ДДС трябва да е по-малко от сумата');
  }
  if (t.status === 'paid' || t.status === 'reported') bankDate(t.tx_date);
  if (t.status === 'paid' && before?.status !== 'paid' && !separate && !kids.length) { const like = similarPayments(db, t); if (like.length) refuseSimilar(like); }
  return row(id);
}
