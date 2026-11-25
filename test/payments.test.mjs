// Едно плащане — един запис: етап, проформа, срок и финанси се четат от книгата.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, seedOffer } from './helpers.mjs';
import { splitSchedule, paidState } from '../server/payments.js';
import { sweepReminders } from '../server/reminders.js';

async function signed(t, { advance_pct = 50, days = true } = {}) {
  const a = t.admin, s = await seedOffer(t);
  await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
  if (days) await a.patch(`/api/projects/${pid}/contract`, { prod_delivery_days: 30, install_days: 15 });
  assert.equal((await a.post(`/api/projects/${pid}/contract/submit`, { advance_pct })).status, 200);
  await a.post(`/api/projects/${pid}/contract/approve`);
  const r = await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); t.sync();
  const contract = async () => (await a.get(`/api/projects/${pid}/contract`)).data;
  const fin = async () => (await a.get(`/api/projects/${pid}/finance`)).data;
  return { pid, s, contract, fin, adv: async () => (await contract()).payments[0], pf: t.db.prepare('SELECT * FROM proformas WHERE project_id = ?').get(pid) };
}
const world = async fn => { const t = await start(); try { await fn(t, t.admin); } finally { await t.stop(); } };

test('schedule split adds up, net and gross', () => {
  for (const [net, pct] of [[100.01, 50], [6200, 50], [0.03, 50], [999.99, 33], [500, 0], [500, 100]]) {
    const p = splitSchedule(net, 20, pct), sum = k => Math.round(p.reduce((s, x) => s + x[k], 0) * 100) / 100;
    assert.equal(sum('net'), net); assert.equal(sum('gross'), Math.round(net * 120) / 100); assert.equal(sum('pct'), 100);
  }
  const rows = [{ id: 2, tx_date: '2026-11-12', amount: 720 }, { id: 1, tx_date: '2026-11-10', amount: 3000 }];
  assert.deepEqual(paidState(rows, 3720), { paid: 3720, paid_at: '2026-11-12', over: 0 });
  assert.equal(paidState([{ id: 1, tx_date: 'd', amount: 4000 }], 3720).over, 280);
  assert.equal(paidState([], 0).paid_at, null);
});

test('each expense document counts once, through finance and ledger', () => world(async (t, a) => {
  const { pid, fin } = await signed(t);
  const tx = b => a.post('/api/transactions', { project_id: pid, direction: 'out', category: 'м', tx_date: '2026-11-01', ...b }).then(r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; });
  const check = async (paid, open, net) => { const f = await fin(), L = (await a.get(`/api/ledger?project_id=${pid}`)).data.totals;
    assert.deepEqual([f.payments_made, f.payables, f.actual_expenses, L.open_out, L.out], [paid, open, net, open, paid]); };
  await tx({ amount: 500, status: 'paid' }); await check(500, 0, 500);
  const d = await tx({ amount: 1200, status: 'committed', has_vat: true, vat_amount: 200 }); await check(500, 1200, 1500);
  await tx({ amount: 400, status: 'paid', document_id: d.id }); await check(900, 800, 1500);
  // guards on a partly paid document
  assert.equal((await a.patch(`/api/transactions/${d.id}`, { amount: 300 })).status, 400);
  assert.equal((await a.patch(`/api/transactions/${d.id}`, { status: 'voided' })).status, 400);
  await tx({ amount: 800, status: 'paid', document_id: d.id }); await check(1700, 0, 1500);
  await a.patch(`/api/transactions/${d.id}`, { status: 'paid' }); await check(1700, 0, 1500);
  assert.equal((await fin()).result_to_date, -1500);
}));

test('proforma payment: gross, bank date, deadline; void and date edits follow through', () => world(async (t, a) => {
  const { pid, pf, contract, fin, adv } = await signed(t);
  assert.equal(pf.amount, 3100);
  assert.deepEqual([(await fin()).invoiced, (await fin()).receivables], [3720, 3720]);
  assert.equal((await a.post(`/api/proformas/${pf.id}/paid`)).status, 400, 'bank date is required');
  await a.put('/api/settings', { vat_pct: '9' }); // a later rate change must not move what was issued
  const r = await a.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-10' });
  assert.deepEqual([r.data.transaction.amount, r.data.transaction.has_vat, r.data.transaction.vat_amount, r.data.transaction.tx_date], [3720, 1, 620, '2026-11-10']);
  assert.deepEqual([(await adv()).paid, (await adv()).paid_at, (await adv()).gross], [3720, '2026-11-10', 3720]);
  assert.equal((await contract()).final_deadline, '2026-12-25');
  assert.deepEqual([(await fin()).payments_received, (await fin()).receivables, (await fin()).result_to_date], [3720, 0, 3100]);
  assert.equal((await a.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-10' })).data.deduped, true);
  assert.equal((await a.post(`/api/proformas/${pf.id}/cancel`)).status, 400);
  // the edit form echoes the old VAT share; a corrected amount must not keep it
  await a.patch(`/api/transactions/${r.data.transaction.id}`, { amount: 1200, vat_amount: '620', has_vat: true });
  assert.equal((await fin()).result_to_date, 1000);
  await a.patch(`/api/transactions/${r.data.transaction.id}`, { amount: 3720 });
  assert.equal((await fin()).result_to_date, 3100);
  await a.patch(`/api/transactions/${r.data.transaction.id}`, { tx_date: '2026-11-05' });
  assert.equal((await contract()).final_deadline, '2026-12-20');
  await a.patch(`/api/transactions/${r.data.transaction.id}`, { status: 'voided' });
  assert.deepEqual([(await adv()).paid_at, (await contract()).final_deadline, (await a.get('/api/proformas')).data[0].status, (await fin()).payments_received], [null, null, 'issued', 0]);
  const again = await a.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-12' });
  assert.equal(again.status, 200); assert.equal((await adv()).paid_at, '2026-11-12');
}));

test('partial, over and multiple payments; a payment linked both ways counts once', () => world(async (t, a) => {
  const { pid, pf, contract, adv } = await signed(t), m = await adv();
  const pay = (amount, tx_date, x = {}) => a.post(`/api/projects/${pid}/payments`, { amount, tx_date, ...x });
  await pay(1000, '2026-10-05', { contract_payment_id: m.id, proforma_id: pf.id });
  assert.deepEqual([(await adv()).paid, (await adv()).paid_at, (await contract()).final_deadline], [1000, null, null]);
  await pay(2720, '2026-10-20', { proforma_id: pf.id });
  assert.deepEqual([(await adv()).paid, (await adv()).paid_at], [3720, '2026-10-20']);
  const pf2 = (await a.post('/api/proformas', { project_id: pid, kind: 'advance', amount: 100 })).data;
  await a.post(`/api/proformas/${pf2.id}/paid`, { paid_at: '2026-10-25' });
  assert.deepEqual([(await adv()).paid, (await adv()).over], [3840, 120]);
  const fin = (await a.post('/api/proformas', { project_id: pid, kind: 'final', amount: (await contract()).payments[2].net })).data;
  await a.post(`/api/proformas/${fin.id}/paid`, { paid_at: '2026-10-26' });
  assert.equal((await contract()).payments[2].paid_at, '2026-10-26');
}));

test('advance percent is explicit, one number everywhere; zero means no advance', () => world(async (t, a) => {
  const s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  const url = '/api/projects/1/contract';
  assert.equal((await a.post(`${url}/submit`)).status, 400);
  for (const bad of [150, -1, 'x']) assert.equal((await a.patch(url, { advance_pct: bad })).status, 400, String(bad));
  assert.equal((await a.patch(url, { advance_pct: 40 })).status, 200);
  assert.equal((await a.post(`${url}/submit`)).status, 200); await a.post(`${url}/approve`);
  assert.equal((await a.post(`${url}/sign`, { signed_on: 'xx', install_start: '2026-12-01', install_deadline: '2026-12-20' })).status, 400);
  await a.post(`${url}/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' });
  const c = (await a.get(url)).data;
  assert.match(c.appendices.find(x => x.number === 3).body, /Аванс: 40%/);
  assert.deepEqual(c.payments.map(p => [p.pct, p.net, p.gross]), [[40, 2480, 2976], [30, 1860, 2232], [30, 1860, 2232]]);
  assert.equal((await a.put(`${url}/payments`, { kind: 'advance', paid_at: '2026-11-01' })).status, 400);
}));
test('zero advance: no proforma, deadline from signing, not waiting for an advance', () => world(async (t, a) => {
  const { pid, pf, contract } = await signed(t, { advance_pct: 0 });
  assert.equal(pf, undefined);
  assert.equal((await contract()).final_deadline, '2026-11-15'); assert.equal((await contract()).advance_paid_at, null);
  assert.equal((await a.get('/api/dashboard')).data.upcoming.find(p => p.id === pid).awaiting_advance, false);
}));
test('a contract approved before the rule can still be signed: the percent is given then and versioned', () => world(async (t, a) => {
  const s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  await a.post('/api/projects/1/contract/submit', { advance_pct: 0 }); await a.post('/api/projects/1/contract/approve');
  t.db.exec('UPDATE contracts SET advance_set = 0');
  const b = { install_start: '2026-12-01', install_deadline: '2026-12-20', signed_on: '2026-10-01' };
  assert.equal((await a.post('/api/projects/1/contract/sign', b)).status, 400);
  assert.equal((await a.post('/api/projects/1/contract/sign', { ...b, advance_pct: 50 })).status, 200);
  const c = (await a.get('/api/projects/1/contract')).data;
  assert.equal(c.active_version, 2); assert.match(c.appendices.find(x => x.number === 3).body, /Аванс: 50%/); assert.equal(c.payments[0].gross, 3720);
}));

test('Contracts reports: nothing moves until Accounting confirms', () => world(async (t, a) => {
  const { pid, contract, fin, adv } = await signed(t);
  const con = await t.mkUser('con', 'contracts'), acc = await t.mkUser('acc', 'accounting'), tech = await t.mkUser('tech', 'technical');
  const m = await adv(), url = `/api/projects/${pid}/payments`, body = { uid: 'u1', amount: 3700, tx_date: '2026-11-08', contract_payment_id: m.id, status: 'paid' };
  const before = JSON.stringify([await fin(), (await contract()).final_deadline].map(x => ({ ...x, transactions: 0 })));
  const r = await con.post(url, body); assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.payment.status, 'reported');
  assert.equal((await con.post(url, body)).data.payment.id, r.data.payment.id, 'same uid is one row');
  assert.equal(JSON.stringify([await fin(), (await contract()).final_deadline].map(x => ({ ...x, transactions: 0 }))), before);
  assert.deepEqual([(await adv()).paid, (await adv()).reported], [0, 3700]); t.sync();
  assert.ok((await acc.get('/api/notifications')).data.some(n => /Докладвано плащане/.test(n.title)));
  const id = r.data.payment.id, rv = r.data.payment.row_version;
  for (const x of ['confirm', 'reject', 'merge']) assert.equal((await con.post(`/api/payments/${id}/${x}`, { reason: 'x', row_version: rv })).status, 403, x);
  assert.equal((await con.patch(`/api/transactions/${id}`, { status: 'voided' })).status, 403);
  assert.equal((await acc.patch(`/api/transactions/${id}`, { status: 'paid' })).status, 400, 'a report is decided only by confirm or reject');
  assert.equal((await tech.post(url, { ...body, uid: 'u9' })).status, 403);
  const ok = await acc.post(`/api/payments/${id}/confirm`, { amount: 3720, tx_date: '2026-11-07', row_version: rv });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await acc.post(`/api/payments/${id}/confirm`, { row_version: rv })).status, 409, 'second decision is refused');
  assert.deepEqual([(await adv()).paid_at, (await contract()).final_deadline, (await fin()).payments_received], ['2026-11-07', '2026-12-22', 3720]);
  const log = t.db.prepare("SELECT before, after FROM audit_log WHERE action = 'payment_confirm'").get();
  assert.match(log.before, /3700/); assert.match(log.after, /3720/);
  // reject
  const q = (await con.post(url, { uid: 'u2', amount: 10, tx_date: '2026-11-09', contract_payment_id: m.id })).data.payment;
  assert.equal((await acc.post(`/api/payments/${q.id}/reject`, { row_version: q.row_version })).status, 400);
  assert.equal((await acc.post(`/api/payments/${q.id}/reject`, { row_version: q.row_version, reason: 'няма в банката' })).status, 200); t.sync();
  assert.ok((await con.get('/api/notifications')).data.some(n => /отхвърлено/.test(n.title) && /няма в банката/.test(n.body)));
  assert.equal(t.db.prepare('SELECT status FROM transactions WHERE id = ?').get(q.id).status, 'voided');
}));

test('the same transfer entered twice is caught and merged by a person', () => world(async (t, a) => {
  const { pid, pf, fin, adv } = await signed(t);
  const con = await t.mkUser('con', 'contracts'), acc = await t.mkUser('acc', 'accounting');
  const rep = (await con.post(`/api/projects/${pid}/payments`, { amount: 3720, tx_date: '2026-11-08', proforma_id: pf.id })).data.payment;
  const dup = await acc.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-10' });
  assert.equal(dup.status, 409); assert.equal(dup.data.similar[0].id, rep.id);
  const direct = (await acc.post(`/api/projects/${pid}/payments`, { amount: 3720, tx_date: '2026-11-10', separate: true })).data.payment;
  assert.equal((await acc.post(`/api/payments/${rep.id}/confirm`, { row_version: rep.row_version })).status, 409);
  assert.equal((await acc.get('/api/payments/queue')).data.reported[0].similar[0].id, direct.id);
  assert.equal((await acc.post(`/api/payments/${rep.id}/merge`, { into: direct.id, row_version: rep.row_version })).status, 200);
  assert.deepEqual([(await fin()).payments_received, (await adv()).paid_at], [3720, '2026-11-10'], 'the kept row takes over the link');
  const two = (await con.post(`/api/projects/${pid}/payments`, { amount: 3720, tx_date: '2026-11-11', contract_payment_id: (await adv()).id })).data.payment;
  assert.equal((await acc.post(`/api/payments/${two.id}/confirm`, { row_version: two.row_version, separate: true })).status, 200);
  assert.equal((await fin()).payments_received, 7440);
}));

test('bad input writes nothing; scope; late payments; daily reminder', () => world(async (t, a) => {
  const { pid, adv } = await signed(t), m = await adv(), con = await t.mkUser('con', 'contracts'), brig = await t.mkUser('brig', 'brigadier');
  const url = `/api/projects/${pid}/payments`, n = () => t.db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  for (const x of [{ amount: '3 720,00' }, { amount: -1 }, { amount: 0 }, { amount: true }, { amount: null }, { tx_date: '2026-13-01' }, { tx_date: '2026-02-30' }, { tx_date: tomorrow }, { tx_date: '' }])
    assert.equal((await con.post(url, { amount: 5, tx_date: '2026-11-01', contract_payment_id: m.id, ...x })).status, 400, JSON.stringify(x));
  assert.equal((await con.post(url, { amount: 5, tx_date: '2026-11-01' })).status, 400, 'Contracts must name what is paid');
  const o = await seedOffer2(t, a);
  assert.equal((await con.post(`/api/projects/${o}/payments`, { amount: 5, tx_date: '2026-11-01', contract_payment_id: m.id })).status, 400);
  const uid = t.db.prepare("SELECT id FROM users WHERE username = 'brig'").get().id;
  await a.put(`/api/users/${uid}/overrides`, { rows: [{ resource: 'contracts', can_read: 1, can_write: 1, can_approve: 0 }] });
  assert.equal((await brig.post(url, { amount: 5, tx_date: '2026-11-01', contract_payment_id: m.id })).status, 403);
  assert.equal(n(), 0);
  await a.post(`/api/projects/${pid}/archive`, { archived: true });
  assert.equal((await con.post(url, { amount: 5, tx_date: '2026-11-01', contract_payment_id: m.id })).status, 200, 'clients pay late');
  t.db.exec("UPDATE transactions SET created_at = datetime('now', '-13 hours')");
  assert.equal(sweepReminders(t.db).filter(x => x.kind === 'payment_reported').length, 1);
  assert.equal(sweepReminders(t.db).filter(x => x.kind === 'payment_reported').length, 0);
}));
async function seedOffer2(t, a) {
  const cust = t.db.prepare('SELECT id FROM customers').get().id, o = (await a.post('/api/offers', { customer_id: cust, title: 'Втори' })).data;
  await a.put(`/api/offers/${o.id}`, { lines: [{ description: 'x', unit: 'м', qty: 1, unit_price: 10 }] });
  await a.post(`/api/offers/${o.id}/confirm`); t.sync();
  return t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
}

test('paid proformas stop reminding; old stored dates are listed, never turned into money', () => world(async (t, a) => {
  const { pid, pf, contract } = await signed(t), acc = await t.mkUser('acc', 'accounting');
  t.db.exec("UPDATE proformas SET due_on = '2026-10-10'");
  const due = () => sweepReminders(t.db).filter(x => x.kind === 'proforma_due').length, clear = () => t.db.exec('DELETE FROM reminders_log');
  assert.equal(due(), 1); clear();
  await a.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-10' }); assert.equal(due(), 0);
  t.db.exec("UPDATE contract_payments SET paid_at = '2026-09-01' WHERE kind = 'interim'");
  const n = t.db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  const q = (await acc.get('/api/payments/queue')).data.unmatched;
  assert.deepEqual(q.map(x => [x.project_id, x.kind, x.unmatched_date]), [[pid, 'interim', '2026-09-01']]);
  assert.equal((await contract()).payments[1].paid_at, null);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM transactions').get().n, n);
  assert.equal((await acc.post(`/api/payments/unmatched/${q[0].id}/clear`)).status, 200);
  assert.equal((await acc.get('/api/payments/queue')).data.unmatched.length, 0);
}));

test('supplier order: countdown runs from confirmed transfers (the Тъмния_2 example)', () => world(async (t, a) => {
  const { pid, fin } = await signed(t), lg = await t.mkUser('lg', 'logistics'), acc = await t.mkUser('acc', 'accounting');
  const o = (await lg.post('/api/supplier-orders', { project_id: pid, supplier: 'VINCI PLAY', total_eur: 10000, advance_eur: 5000, prod_days: 30, transport_days: 7 })).data;
  const get = async () => (await acc.get('/api/supplier-orders')).data[0], url = `/api/supplier-orders/${o.id}`;
  assert.equal((await lg.patch(url, { advance_paid_at: '2026-11-15' })).status, 400);
  assert.equal((await lg.patch(url, { advance_eur: 10001 })).status, 400);
  assert.equal((await lg.patch(url, { total_eur: '' })).status, 400);
  const other = await seedOffer2(t, a), line = t.db.prepare('SELECT id FROM project_lines WHERE project_id = ?').get(other).id;
  assert.equal((await lg.patch(url, { project_line_id: line })).status, 400);
  const rep = (await lg.post(`${url}/payments`, { stage: 'advance', amount: 5000, tx_date: '2026-11-15' })).data.payment;
  assert.equal(rep.status, 'reported'); assert.equal((await get()).ready_date, null); assert.equal((await fin()).payments_made, 0);
  assert.equal((await acc.post(`/api/payments/${rep.id}/confirm`, { row_version: rep.row_version })).status, 200);
  let v = await get(); assert.deepEqual([v.advance_paid_at, v.ready_date, v.expected_delivery, v.delivery_forecast, v.computed_status], ['2026-11-15', '2026-12-15', '2026-12-22', true, 'in_production']);
  t.db.exec("UPDATE transactions SET tx_date = '2026-09-15'"); // the final transfer of the example lies in the future, so the pair is moved back
  assert.equal((await acc.post(`${url}/payments`, { stage: 'final', amount: 5000, tx_date: '2026-10-16' })).data.payment.status, 'paid');
  v = await get(); assert.deepEqual([v.ready_date, v.final_paid_at, v.expected_delivery, v.delivery_forecast, v.computed_status], ['2026-10-15', '2026-10-16', '2026-10-23', false, 'in_transit']);
  assert.equal((await fin()).payments_made, 10000);
}));

test('change requests cannot edit around a payment or a signed contract, at filing or at decision', () => world(async (t, a) => {
  const s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  const con = await t.mkUser('con', 'contracts'), file = (entity_type, entity_id, payload, kind = 'edit') => con.post('/api/change-requests', { entity_type, entity_id, kind, payload, reason: 'x' });
  const line = t.db.prepare('SELECT id FROM project_lines').get().id;
  const early = (await file('project_line', line, { qty: 500 })).data;
  await a.post('/api/projects/1/contract/submit', { advance_pct: 50 }); await a.post('/api/projects/1/contract/approve');
  await a.post('/api/projects/1/contract/sign', { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' });
  assert.equal((await a.post(`/api/change-requests/${early.id}/decide`, { decision: 'approve' })).status, 400);
  assert.equal((await file('project_line', line, { unit_price: 1 })).status, 400);
  assert.equal((await file('project_line', line, null, 'delete')).status, 400);
  assert.equal((await file('project_line', line, { tech_note: 'може' })).status, 200);
  assert.equal((await file('contract', 1, { advance_pct: 10 })).status, 400);
  const pf = t.db.prepare('SELECT id FROM proformas').get().id, tx = (await a.post(`/api/proformas/${pf}/paid`, { paid_at: '2026-11-10' })).data.transaction.id;
  assert.equal((await file('proforma', pf, { status: 'paid' })).status, 400);
  assert.equal((await file('proforma', pf, { amount: 1 })).status, 400);
  for (const p of [{ amount: 1 }, { direction: 'out' }, { status: 'voided' }, { tx_date: '2026-01-01' }]) assert.equal((await file('transaction', tx, p)).status, 400, JSON.stringify(p));
  assert.equal((await file('transaction', tx, null, 'delete')).status, 400);
  assert.equal((await file('transaction', tx, { note: 'може' })).status, 200);
}));

test('the stored milestone date has a single reader', () => {
  const dir = path.resolve(import.meta.dirname, '..', 'server');
  const hits = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'db.js' && f !== 'payments.js').flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map((l, i) => [f, i + 1, l])
    .filter(([, , l]) => /contract_payments/.test(l) && /\bpaid_at\b/.test(l) && !/paid_at = NULL/.test(l)).map(([x, i]) => `${x}:${i}`));
  assert.deepEqual(hits, []);
});

test('a payment named by milestone also settles the oldest open proforma of that kind', () => world(async (t, a) => {
  const { pid, pf, adv } = await signed(t), m = await adv();
  const con = await t.mkUser('con', 'contracts'), acc = await t.mkUser('acc', 'accounting');
  const rep = (await con.post(`/api/projects/${pid}/payments`, { amount: 3720, tx_date: '2026-11-08', contract_payment_id: m.id })).data.payment;
  assert.equal((await acc.post(`/api/payments/${rep.id}/confirm`, { row_version: rep.row_version })).status, 200);
  assert.equal((await acc.get('/api/proformas')).data.find(x => x.id === pf.id).status, 'paid');
  assert.equal((await adv()).paid, 3720, 'counted once');
}));
