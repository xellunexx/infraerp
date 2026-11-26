// Независим преглед 2026-11-26: всеки ред се брои веднъж, само когато е платен, и само там, където му е мястото.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

const world = async fn => { const t = await start(); try { await fn(t, t.admin); } finally { await t.stop(); } };
async function signed(t) {
  const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
  for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 50 });
  await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' }); t.sync();
  return { pid, pf: t.db.prepare('SELECT * FROM proformas WHERE project_id = ?').get(pid) };
}
const tx = (a, b) => a.post('/api/transactions', { category: 'x', tx_date: '2026-11-01', ...b });
const ok = async p => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const fin = async (a, pid) => (await a.get(`/api/projects/${pid}/finance`)).data;

test('review 1: an invoice marked paid and its payments count once against the proforma; a changed link moves its payments', () => world(async (t, a) => {
  const { pid, pf } = await signed(t);
  const inv = await ok(tx(a, { project_id: pid, direction: 'in', tx_kind: 'client', amount: 3720, status: 'committed', proforma_id: pf.id }));
  await ok(tx(a, { project_id: pid, direction: 'in', tx_kind: 'bank_in', amount: 3720, status: 'paid', document_id: inv.id }));
  await ok(a.patch(`/api/transactions/${inv.id}`, { status: 'paid' }));
  const p = (await a.get('/api/proformas')).data.find(x => x.id === pf.id);
  assert.deepEqual([p.paid, p.status], [3720, 'paid']);
  assert.deepEqual([(await a.get(`/api/projects/${pid}/contract`)).data.payments[0].paid, (await fin(a, pid)).payments_received], [3720, 3720]);
  const pf2 = (await a.post('/api/proformas', { project_id: pid, kind: 'advance', amount: 3100 })).data;
  await ok(a.patch(`/api/transactions/${inv.id}`, { proforma_id: pf2.id }));
  assert.equal(t.db.prepare('SELECT proforma_id FROM transactions WHERE document_id = ?').get(inv.id).proforma_id, pf2.id);
}));

test('review 2: an advance to a person is not project spending; costs the person paid are', () => world(async (t, a) => {
  const { pid } = await signed(t);
  const per = (await a.post('/api/accountable-persons', { name: 'W' })).data;
  await ok(tx(a, { project_id: pid, person_id: per.id, direction: 'out', tx_kind: 'card', amount: 1000, status: 'paid' }));
  await ok(tx(a, { project_id: pid, person_id: per.id, direction: 'out', tx_kind: 'supplier_doc', amount: 1000, status: 'paid' }));
  const f = await fin(a, pid);
  assert.deepEqual([f.payments_made, f.actual_expenses, f.result_to_date], [1000, 1000, -1000]);
  const L = (await a.get(`/api/ledger?project_id=${pid}`)).data.totals;
  assert.equal(L.out, 1000, 'the company paid 1000 once, through the person');
}));

test('review 3, 4: the person card counts only what was paid, and only once', () => world(async (t, a) => {
  const { pid } = await signed(t);
  const per = (await a.post('/api/accountable-persons', { name: 'W' })).data, P = { person_id: per.id, project_id: pid };
  await ok(tx(a, { ...P, direction: 'out', tx_kind: 'card', amount: 1000, status: 'paid' }));
  await ok(tx(a, { ...P, direction: 'out', tx_kind: 'card', amount: 777, status: 'planned' }));
  await ok(tx(a, { ...P, direction: 'out', tx_kind: 'fiscal', amount: 500, status: 'planned' }));
  await ok(tx(a, { ...P, direction: 'in', tx_kind: 'client', amount: 900, status: 'committed' }));
  const doc = await ok(tx(a, { ...P, direction: 'out', tx_kind: 'supplier_doc', amount: 300, status: 'committed' }));
  await ok(tx(a, { project_id: pid, direction: 'out', tx_kind: 'bank_out', amount: 300, status: 'paid', document_id: doc.id }));
  const doc2 = await ok(tx(a, { project_id: pid, direction: 'out', tx_kind: 'supplier_doc', amount: 200, status: 'committed' }));
  await ok(tx(a, { ...P, direction: 'out', tx_kind: 'bank_out', amount: 200, status: 'paid', document_id: doc2.id, method: 'cash' }));
  await ok(tx(a, { ...P, direction: 'out', tx_kind: 'no_doc', amount: 50, status: 'paid' }));
  const c = (await a.get(`/api/accountable-persons/${per.id}/card`)).data;
  assert.deepEqual([c.given, c.spent, c.returned, c.balance], [1000, 250, 0, 750], 'company-paid invoice is not the person\'s; the person\'s cash payment is');
}));

test('review 5: stock is cost only: never planned cost, never owed, never cash', () => world(async (t, a) => {
  const { pid } = await signed(t);
  await ok(tx(a, { project_id: pid, direction: 'out', tx_kind: 'store', amount: 300, status: 'planned' }));
  await ok(tx(a, { project_id: pid, direction: 'out', tx_kind: 'store', amount: 200, status: 'committed' }));
  const f = await fin(a, pid), L = (await a.get(`/api/ledger?project_id=${pid}`)).data.totals;
  assert.deepEqual([f.actual_expenses, f.result.materials_net, f.payables, L.open_out, L.out], [200, 200, 0, 0, 0]);
}));

test('review 7: kind and direction agree; a document with payments keeps a document kind', () => world(async (t, a) => {
  const { pid } = await signed(t);
  for (const [direction, tx_kind] of [['in', 'supplier_doc'], ['in', 'labour'], ['in', 'store'], ['in', 'fiscal'], ['in', 'bank_out'], ['out', 'client'], ['out', 'bank_in'], ['out', 'proforma']])
    assert.equal((await tx(a, { project_id: pid, direction, tx_kind, amount: 1, status: 'paid' })).status, 400, `${direction} ${tx_kind}`);
  const doc = await ok(tx(a, { project_id: pid, direction: 'out', tx_kind: 'supplier_doc', amount: 100, status: 'committed' }));
  await ok(tx(a, { project_id: pid, direction: 'out', tx_kind: 'bank_out', amount: 100, status: 'paid', document_id: doc.id }));
  assert.equal((await a.patch(`/api/transactions/${doc.id}`, { tx_kind: 'bank_out' })).status, 400);
}));

test('review 8, 9: income counts issued documents once; a partial invoice keeps the rest of its proforma; the ledger agrees', () => world(async (t, a) => {
  const { pid, pf } = await signed(t);
  await ok(tx(a, { project_id: pid, direction: 'in', tx_kind: 'client', amount: 999, status: 'planned' }));
  assert.equal((await fin(a, pid)).invoiced, 3720, 'a planned invoice is not issued');
  await ok(a.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-02' }));
  const inv = await ok(tx(a, { project_id: pid, direction: 'in', tx_kind: 'client', amount: 1200, status: 'committed', proforma_id: pf.id }));
  let f = await fin(a, pid);
  assert.deepEqual([f.invoiced, f.receivables, f.result.income_net], [3720, 0, 3100], 'part invoice: the rest of the proforma still counts');
  const row = (await a.get(`/api/ledger?project_id=${pid}`)).data.rows.find(x => x.id === inv.id);
  assert.equal(row.open_amount, 0, 'paid through its proforma');
}));

test('review 10: labour is net in the result block as in expenses', () => world(async (t, a) => {
  const { pid } = await signed(t);
  await ok(tx(a, { project_id: pid, direction: 'out', tx_kind: 'labour', amount: 120, has_vat: true, vat_amount: 20, labour_days: 1, status: 'paid' }));
  const f = await fin(a, pid);
  assert.deepEqual([f.result.labour, f.actual_expenses], [100, 100]);
}));
