// Всеки ред в книгата има една роля: разход, плащане, приход, аванс, връщане, склад. Разходът идва от документа; преводът само го плаща.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { roleOf } from '../server/roles.js';

test('role of every kind of row', () => {
  const R = (direction, tx_kind, x = {}) => roleOf({ direction, tx_kind, document_id: null, proforma_id: null, contract_payment_id: null, ...x });
  for (const k of ['supplier_doc', 'fiscal', 'no_doc', 'labour', 'other']) assert.equal(R('out', k), 'cost', k);
  assert.equal(R('out', 'store'), 'stock');
  assert.equal(R('out', 'bank_out'), 'payment');
  assert.equal(R('out', 'supplier_doc', { document_id: 5 }), 'payment', 'a child row pays its document');
  assert.equal(R('out', 'card'), 'advance');
  for (const k of ['client', 'proforma']) assert.equal(R('in', k), 'income_doc', k);
  assert.equal(R('in', 'client', { proforma_id: 3 }), 'income_doc', 'an invoice settling a proforma is still a document');
  assert.equal(R('in', 'bank_in'), 'income_payment');
  assert.equal(R('in', 'client', { document_id: 4 }), 'income_payment');
  assert.equal(R('in', null, { proforma_id: 3 }), 'income_payment');
  assert.equal(R('in', 'card'), 'return');
  assert.equal(R('in', 'other'), 'income_payment');
  assert.equal(R('out', null), 'legacy'); assert.equal(R('in', null), 'legacy');
});

async function project(t) {
  const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  return t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
}
const world = async fn => { const t = await start(); try { await fn(t, t.admin); } finally { await t.stop(); } };
const tx = (a, pid, b) => a.post('/api/transactions', { project_id: pid, category: 'x', tx_date: '2026-11-01', ...b }).then(r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; });

test('a transfer is not a cost; an unlinked one waits for its document', () => world(async (t, a) => {
  const pid = await project(t), fin = async () => (await a.get(`/api/projects/${pid}/finance`)).data;
  await tx(a, pid, { direction: 'out', tx_kind: 'supplier_doc', amount: 1200, status: 'committed', has_vat: true, vat_amount: 200 });
  const pay = await tx(a, pid, { direction: 'out', tx_kind: 'bank_out', amount: 5000, status: 'paid' });
  let f = await fin();
  assert.deepEqual([f.actual_expenses, f.payments_made, f.payables], [1000, 5000, 1200]);
  assert.deepEqual((await a.get(`/api/payments/unallocated?project_id=${pid}`)).data.map(x => x.id), [pay.id]);
  await tx(a, pid, { direction: 'out', tx_kind: 'store', amount: 865.12, status: 'paid' });
  f = await fin(); assert.deepEqual([f.actual_expenses, f.payments_made, f.payables], [1865.12, 5000, 1200], 'stock is cost only');
  const legacy = await tx(a, pid, { direction: 'out', amount: 100, status: 'paid' });
  f = await fin(); assert.equal(f.actual_expenses, 1965.12, 'rows without a kind keep their old meaning');
  assert.ok((await a.get(`/api/payments/unallocated?project_id=${pid}`)).data.some(x => x.id === legacy.id), 'and are listed for review');
}));

test('what clients owe: client documents minus money received; an invoice settling a proforma counts once', () => world(async (t, a) => {
  const pid = await project(t), fin = async () => (await a.get(`/api/projects/${pid}/finance`)).data;
  const inv = await tx(a, pid, { direction: 'in', tx_kind: 'client', amount: 10000, status: 'committed', has_vat: true, vat_amount: 1666.67 });
  await tx(a, pid, { direction: 'in', tx_kind: 'bank_in', amount: 6000, status: 'paid', document_id: inv.id });
  assert.deepEqual([(await fin()).invoiced, (await fin()).receivables, (await fin()).payments_received], [10000, 4000, 6000]);
  // advance proforma paid, then the invoice for that advance
  for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 50 });
  await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' }); t.sync();
  const pf = t.db.prepare('SELECT * FROM proformas WHERE project_id = ?').get(pid);
  await a.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-02' });
  await tx(a, pid, { direction: 'in', tx_kind: 'client', amount: 3720, status: 'committed', proforma_id: pf.id });
  let f = await fin(); assert.deepEqual([f.invoiced, f.receivables, f.payments_received], [13720, 4000, 9720]);
  // an invoice linked to a proforma and paid by a transfer on the invoice closes the milestone once
  const c = (await a.get(`/api/projects/${pid}/contract`)).data, m = c.payments[1];
  const pf2 = (await a.post('/api/proformas', { project_id: pid, kind: 'interim', amount: m.net })).data;
  const inv2 = await tx(a, pid, { direction: 'in', tx_kind: 'client', amount: m.gross, status: 'committed', proforma_id: pf2.id });
  await tx(a, pid, { direction: 'in', tx_kind: 'bank_in', amount: m.gross, status: 'paid', document_id: inv2.id, tx_date: '2026-11-03' });
  f = await fin(); assert.deepEqual([f.invoiced, f.receivables, f.payments_received], [r2(13720 + m.gross), 4000, r2(9720 + m.gross)]);
  const c2 = (await a.get(`/api/projects/${pid}/contract`)).data;
  assert.deepEqual([c2.payments[1].paid, c2.payments[1].paid_at], [m.gross, '2026-11-03']);
  assert.equal((await a.get('/api/proformas')).data.find(x => x.id === pf2.id).status, 'paid');
}));
const r2 = n => Math.round(n * 100) / 100;
