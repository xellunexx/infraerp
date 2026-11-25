// Ролята на ред в книгата — едно място, от което четат финансите, резултатът по обект и картата на човек.
// Разходът идва от документа (фактура, бон, разписка, труд); преводът само плаща документ и никога не е разход.
const COST = new Set(['supplier_doc', 'fiscal', 'no_doc', 'labour', 'other']);

/** @returns {'cost'|'stock'|'payment'|'advance'|'income_doc'|'income_payment'|'return'|'legacy'} */
export function roleOf(t) {
  if (t.direction === 'out') {
    if (t.document_id != null) return 'payment';
    if (COST.has(t.tx_kind)) return 'cost';
    if (t.tx_kind === 'store') return 'stock';
    if (t.tx_kind === 'bank_out') return 'payment';
    if (t.tx_kind === 'card') return 'advance';
    return 'legacy'; // written before kinds were required: keeps its old meaning, listed for review
  }
  if (t.document_id != null) return 'income_payment';
  if (t.tx_kind === 'client' || t.tx_kind === 'proforma') return 'income_doc';
  if (t.tx_kind === 'card') return 'return';
  if (t.tx_kind == null && t.proforma_id == null && t.contract_payment_id == null) return 'legacy';
  return 'income_payment';
}
