// §14 operator spec: single-ledger views (document→payment pairing, person cards, companies,
// cost centers), supplier-order countdowns, contract milestones→computed deadline, dashboard buckets, reopen flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

const sign = async (t, pid) => {
  await t.admin.patch(`/api/projects/${pid}/contract`, { delivery_deadline: '2026-01-10', install_start: '2025-12-01', install_deadline: '2026-01-31' });
  await t.admin.post(`/api/projects/${pid}/contract/submit`, { advance_pct: 50 });
  await t.admin.post(`/api/projects/${pid}/contract/approve`);
  await t.admin.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2025-11-20' });
  await t.sync();
};

test('document -> partial settlements: open amount computed, payment cannot link to a payment', async () => {
  const t = await start();
  const doc = (await t.admin.post('/api/transactions', { direction: 'out', category: 'материали', amount: 13555, tx_date: '2026-06-15',
    tx_kind: 'supplier_doc', status: 'committed', counterparty: 'Vinci Play', document_ref: 'order 2026-7' })).data;
  assert.equal(doc.open_amount, 13555);
  const p1 = (await t.admin.post('/api/transactions', { direction: 'out', category: 'плащане', amount: 6500, tx_date: '2026-06-17',
    tx_kind: 'bank_out', document_id: doc.id, status: 'paid' })).data;
  const p2 = (await t.admin.post('/api/transactions', { direction: 'out', category: 'плащане', amount: 7055, tx_date: '2026-07-27',
    tx_kind: 'bank_out', document_id: doc.id, status: 'paid' })).data;
  assert.equal(p1.open_amount, null, 'a settlement row has no open amount of its own');
  const after = (await t.admin.get('/api/transactions')).data.find(r => r.id === doc.id);
  assert.equal(after.paid_sum, 13555);
  assert.equal(after.open_amount, 0);
  // a payment cannot be paid against (no chains)
  const bad = await t.admin.post('/api/transactions', { direction: 'out', category: 'x', amount: 1, tx_date: '2026-01-01', document_id: p2.id });
  assert.equal(bad.status, 400);
  // direction must match
  const bad2 = await t.admin.post('/api/transactions', { direction: 'in', category: 'x', amount: 1, tx_date: '2026-01-01', document_id: doc.id });
  assert.equal(bad2.status, 400);
  await t.stop();
});

test('ledger filters + company totals + cost centers', async () => {
  const t = await start();
  const cc = (await t.admin.post('/api/cost-centers', { name: 'Механизация', kind: 'fleet' })).data;
  await t.admin.post('/api/transactions', { direction: 'out', category: 'гориво', amount: 50, tx_date: '2026-01-05', tx_kind: 'fiscal', cost_center_id: cc.id, company: 'Синхро' });
  await t.admin.post('/api/transactions', { direction: 'out', category: 'гориво', amount: 70, tx_date: '2026-01-06', tx_kind: 'fiscal', cost_center_id: cc.id, company: 'Евроваг' });
  await t.admin.post('/api/transactions', { direction: 'out', category: 'канцелария', amount: 30, tx_date: '2026-01-07', tx_kind: 'no_doc', company: 'Синхро' });
  const all = (await t.admin.get('/api/ledger')).data;
  assert.equal(all.totals.out, 150);
  assert.equal(all.by_company['Синхро'].out, 80);
  assert.equal(all.by_company['Евроваг'].out, 70);
  const mine = (await t.admin.get(`/api/ledger?cost_center_id=${cc.id}`)).data;
  assert.equal(mine.rows.length, 2);
  assert.equal(mine.totals.out, 120);
  // invalid kind rejected
  assert.equal((await t.admin.post('/api/transactions', { direction: 'out', category: 'x', amount: 1, tx_date: '2026-01-01', tx_kind: 'bogus' })).status, 400);
  await t.stop();
});

test('person card: given - spent - returned = balance; labour rows structure days x rate', async () => {
  const t = await start();
  const per = (await t.admin.post('/api/accountable-persons', { name: 'Хюсеин' })).data;
  await t.admin.post('/api/transactions', { direction: 'out', category: 'аванс', amount: 300, tx_date: '2026-08-26', tx_kind: 'card', person_id: per.id, method: 'card' });
  await t.admin.post('/api/transactions', { direction: 'out', category: 'куриер', amount: 42.42, tx_date: '2026-09-09', tx_kind: 'no_doc', person_id: per.id });
  // labour: amount defaults to days x rate
  const lab = (await t.admin.post('/api/transactions', { direction: 'out', category: 'труд', tx_date: '2026-09-30', tx_kind: 'labour',
    person_id: per.id, labour_worker: 'Ереджеб Хамза', labour_days: 4, labour_rate: 90 })).data;
  assert.equal(lab.amount, 360);
  await t.admin.post('/api/transactions', { direction: 'in', category: 'върнато', amount: 100, tx_date: '2026-10-01', tx_kind: 'other', person_id: per.id });
  const card = (await t.admin.get(`/api/accountable-persons/${per.id}/card`)).data;
  assert.equal(card.given, 300);
  assert.equal(card.spent, 402.42);       // 42.42 + 360
  assert.equal(card.returned, 100);
  assert.equal(card.balance, -202.42);    // company owes the person
  await t.stop();
});

test('supplier orders: advance date drives production countdown, final payment drives delivery date', async () => {
  const t = await start();
  const { offer } = await seedOffer(t);
  await t.admin.post(`/api/offers/${offer.id}/send`);
  await t.admin.post(`/api/offers/${offer.id}/confirm`, {});
  await t.sync();
  const prj = (await t.admin.get('/api/projects')).data[0];
  const line = (await t.admin.get(`/api/projects/${prj.id}`)).data.lines[0];
  const so = (await t.admin.post('/api/supplier-orders', { project_id: prj.id, project_line_id: line.id, supplier: 'VINCI PLAY',
    order_doc_no: '1045/12.11.2026', total_eur: 10000, advance_eur: 5000, prod_days: 30, transport_days: 7 })).data;
  assert.equal(so.computed_status, 'ordered');
  assert.equal(so.ready_date, null, 'no countdown before the advance is actually paid');
  assert.equal(so.final_eur, 5000);
  const paid = (await t.admin.post(`/api/supplier-orders/${so.id}/payments`, { stage: 'advance', vat_pct: 0, amount: 5000, tx_date: '2026-10-15' }), (await t.admin.get('/api/supplier-orders')).data[0]);
  assert.equal(paid.computed_status, 'in_production');
  assert.equal(paid.ready_date, '2026-11-14');                    // 15.10 + 30 days
  assert.equal(paid.expected_delivery, '2026-11-21');             // forecast: ready + 7 transport days
  assert.equal(paid.delivery_forecast, true);
  const done = (await t.admin.post(`/api/supplier-orders/${so.id}/payments`, { stage: 'final', vat_pct: 0, amount: 5000, tx_date: '2026-11-15' }), (await t.admin.get('/api/supplier-orders')).data[0]);
  assert.equal(done.computed_status, 'in_transit');
  assert.equal(done.expected_delivery, '2026-11-22');             // real: final paid + 7 days
  assert.equal(done.delivery_forecast, false);
  // invalid manual status rejected; delivered allowed
  assert.equal((await t.admin.patch(`/api/supplier-orders/${so.id}`, { status: 'in_transit', row_version: done.row_version })).status, 400);
  const del = (await t.admin.patch(`/api/supplier-orders/${so.id}`, { status: 'delivered', row_version: done.row_version })).data;
  assert.equal(del.computed_status, 'delivered');
  await t.stop();
});

test('contract milestones + dashboard buckets + reopen flow', async () => {
  const t = await start();
  const { offer } = await seedOffer(t);
  await t.admin.post(`/api/offers/${offer.id}/send`);
  await t.admin.post(`/api/offers/${offer.id}/confirm`, {});
  await t.sync();
  const prj = (await t.admin.get('/api/projects')).data[0];
  // milestones exist before signing too — put the terms in the draft
  await t.admin.patch(`/api/projects/${prj.id}/contract`, { contract_kind: 'standard', prod_delivery_days: 30, install_days: 15 });
  await sign(t, prj.id);
  let dash = (await t.admin.get('/api/dashboard')).data;
  assert.equal(dash.negotiating.length, 0);
  assert.equal(dash.upcoming.length, 1);
  assert.equal(dash.upcoming[0].awaiting_advance, true, 'signed without paid advance -> чака аванс');
  // record the advance milestone -> deadline computes
  const m = (await t.admin.get(`/api/projects/${prj.id}/contract`)).data.payments[0];
  await t.admin.post(`/api/projects/${prj.id}/payments`, { amount: m.gross, tx_date: '2026-11-24', contract_payment_id: m.id });
  const c = (await t.admin.get(`/api/projects/${prj.id}/contract`)).data;
  assert.equal(c.advance_paid_at, '2026-11-24');
  assert.equal(c.final_deadline, '2027-01-08', 'advance 2026-11-24 + 30 prod + 15 install days');
  await t.sync();
  dash = (await t.admin.get('/api/dashboard')).data;
  assert.equal(dash.upcoming[0].awaiting_advance, false);
  // execution starts -> moves to executing bucket
  const line = (await t.admin.get(`/api/projects/${prj.id}`)).data.lines[0];
  const prog = (await t.admin.post(`/api/projects/${prj.id}/progress`, { project_line_id: line.id, work_date: '2025-12-02', qty: 5, uid: 'u-1' })).status;
  assert.equal(prog, 200);
  await t.sync();
  dash = (await t.admin.get('/api/dashboard')).data;
  assert.equal(dash.executing.length, 1);
  assert.equal(dash.upcoming.length, 0);
  // reopen: complete everything, request reopen as non-approver -> creates pending approval; decide -> stage back
  const stages = (await t.admin.get(`/api/projects/${prj.id}`)).data.stages;
  for (const s of stages.filter(s => !['done', 'skipped'].includes(s.status))) await t.admin.post(`/api/projects/${prj.id}/stages`, { code: s.code, status: 'done' });
  const after = (await t.admin.get(`/api/projects/${prj.id}`)).data;
  assert.equal(after.status, 'completed');
  const reqR = await t.admin.post(`/api/projects/${prj.id}/reopen-request`, { stage_code: 'execution', reason: 'нов проблем на обекта' });
  assert.equal(reqR.status, 200);
  const dup = await t.admin.post(`/api/projects/${prj.id}/reopen-request`, { reason: 'още веднъж' });
  assert.equal(dup.status, 400, 'second pending request blocked');
  const contractsUser = await t.mkUser('ctr', 'contracts');
  const denied = await contractsUser.post(`/api/projects/${prj.id}/reopen-decide`, { action: 'approve' });
  assert.equal(denied.status, 403, 'decision needs approvals permission');
  const dec = await t.admin.post(`/api/projects/${prj.id}/reopen-decide`, { action: 'approve', note: 'да се върне' });
  assert.equal(dec.status, 200);
  await t.sync();
  const final = (await t.admin.get(`/api/projects/${prj.id}`)).data;
  assert.equal(final.status, 'execution', 'status re-derived to execution');
  assert.equal(final.stages.find(s => s.code === 'execution').status, 'active');
  const evs = (await t.admin.get(`/api/projects/${prj.id}/timeline`)).data;
  assert.ok(evs.some(e => e.type === 'project.reopened'), 'project.reopened event emitted');
  await t.stop();
});

test('notifications carry project, author and linked-task status', async () => {
  const t = await start();
  const { offer } = await seedOffer(t);
  await t.admin.post(`/api/offers/${offer.id}/send`);
  await t.admin.post(`/api/offers/${offer.id}/confirm`, {});
  await t.sync();
  const prj = (await t.admin.get('/api/projects')).data[0];
  const task = (await t.admin.post('/api/tasks', { project_id: prj.id, title: 'Провери доставката', assignee_dept: 'technical' })).data;
  assert.ok(task?.id, 'task created');
  await t.sync();
  const techUser = await t.mkUser('teche', 'technical');
  const notes = (await techUser.get('/api/notifications')).data;
  const tn = notes.find(x => x.ref_type === 'task' && x.ref_id === task.id);
  assert.ok(tn, 'task.assigned produced a task-linked notification');
  assert.equal(tn.author_name, 'Админ', 'author is the user who caused the event');
  assert.equal(tn.ref_status, 'open');
  assert.equal(tn.project_code, prj.code);
  await t.admin.post(`/api/tasks/${task.id}/done`);
  const tn2 = (await techUser.get('/api/notifications')).data.find(x => x.ref_type === 'task' && x.ref_id === task.id);
  assert.equal(tn2.ref_status, 'done', 'task status resolves live — done state visible');
  await t.stop();
});
