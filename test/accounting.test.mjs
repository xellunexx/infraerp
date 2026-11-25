// Phase 4 slice — Счетоводство: proformas, transactions, payment requests with approval, accommodations, finance views.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

/** offer -> confirm -> contract draft -> submit -> approve -> sign. Returns project + clients. */
async function signedProject(t, dates = { install_start: '2026-01-05', install_deadline: '2026-12-20', delivery_deadline: '2025-12-28' }) {
  const s = await seedOffer(t);
  const conf = await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
  assert.equal(conf.status, 200);
  t.sync();
  const p = (await t.admin.get('/api/projects')).data[0];
  const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
  const upd = await t.admin.patch(`/api/projects/${p.id}/contract`, { ...dates, row_version: c0.row_version });
  assert.equal(upd.status, 200);
  await t.admin.post(`/api/projects/${p.id}/contract/submit`, { advance_pct: 50 });
  await t.admin.post(`/api/projects/${p.id}/contract/approve`);
  const sign = await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29' });
  assert.equal(sign.status, 200);
  t.sync();
  return { ...s, project: (await t.admin.get(`/api/projects/${p.id}`)).data, admin: t.admin };
}

test('signing seeds the 50/30/20 schedule + advance proforma; paying it marks the milestone and starts deadlines', async () => {
  const t = await start();
  try {
    const acc = await t.mkUser('acc1', 'accounting');
    const { project } = await signedProject(t, { install_start: '2026-01-05', install_deadline: '2026-12-20', delivery_deadline: '2025-12-28', prod_delivery_days: 30, install_days: 10 });

    const c = (await t.admin.get(`/api/projects/${project.id}/contract`)).data;
    const pay = Object.fromEntries(c.payments.map(p => [p.kind, p]));
    assert.equal(pay.advance.pct, 50, 'the agreed advance');
    assert.equal(pay.interim.pct, 30);
    assert.equal(pay.final.pct, 20, 'final is the remainder');
    assert.equal(pay.advance.amount, Math.round(c.total * 0.5 * 100) / 100);
    assert.equal(c.advance_paid_at, null, 'calendar does not start before money arrives');

    const pf = t.db.prepare("SELECT * FROM proformas WHERE project_id = ? AND kind = 'advance'").get(project.id);
    assert.ok(pf, 'advance proforma is issued on signing');
    assert.equal(pf.amount, pay.advance.amount);
    assert.equal(pf.status, 'issued');

    const paid = await acc.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-20' });
    assert.equal(paid.status, 200);
    const c2 = (await t.admin.get(`/api/projects/${project.id}/contract`)).data;
    const adv = c2.payments.find(p => p.kind === 'advance');
    assert.ok(adv.paid_at, 'paid proforma marks the advance milestone');
    assert.equal(c2.advance_paid_at, adv.paid_at, 'advance_paid_at derives from the milestone row');
    const expectedFinal = new Date(Date.parse(adv.paid_at) + 40 * 86400000).toISOString().slice(0, 10);
    assert.equal(c2.final_deadline, expectedFinal, 'final deadline = paid date + production + install days');

    const pf2 = (await acc.post('/api/proformas', { project_id: project.id, kind: 'advance', amount: 10 })).data;
    await acc.post(`/api/proformas/${pf2.id}/paid`, { paid_at: '2026-11-21' });
    const adv2 = (await t.admin.get(`/api/projects/${project.id}/contract`)).data.payments.find(p => p.kind === 'advance');
    assert.equal(adv2.paid_at, adv.paid_at, 'a second advance payment does not move the recorded date');
    const interim = (await t.admin.get(`/api/projects/${project.id}/contract`)).data.payments.find(p => p.kind === 'interim');
    assert.equal(interim.paid_at, null, 'unrelated milestones stay unmarked');

    const pf3 = (await acc.post('/api/proformas', { project_id: project.id, kind: 'other', amount: 10 })).data;
    await acc.post(`/api/proformas/${pf3.id}/paid`, { paid_at: '2026-11-21', separate: true });
    assert.equal((await t.admin.get(`/api/projects/${project.id}/contract`)).data.payments.filter(p => p.paid_at).length, 1,
      'proformas of kind "other" do not touch the schedule');
  } finally { await t.stop(); }
});

test('accounting: role gates — finance read vs write vs approvals', async () => {
  const t = await start();
  try {
    const acc = await t.mkUser('acc1', 'accounting');
    const tech = await t.mkUser('tech1', 'technical');
    const comm = await t.mkUser('comm1', 'commercial');
    const { project } = await signedProject(t);

    assert.equal((await tech.get('/api/accounting')).status, 403, 'technical has no finance read');
    assert.equal((await tech.get('/api/proformas')).status, 403);
    assert.equal((await comm.get('/api/accounting')).status, 200, 'commercial has finance read');
    assert.equal((await comm.post('/api/transactions', { direction: 'in', category: 'x', amount: 1, tx_date: '2026-01-01' })).status, 403, 'commercial cannot write finance');

    assert.equal((await acc.get('/api/accounting')).status, 200);
    assert.equal((await acc.get(`/api/projects/${project.id}/finance`)).status, 200);
    const pf = await acc.post('/api/proformas', { project_id: project.id, amount: 100 });
    assert.equal(pf.status, 200, 'accounting can issue proforma');
    const txr = await acc.post('/api/transactions', { project_id: project.id, direction: 'out', category: 'test', amount: 10, tx_date: '2026-01-01' });
    assert.equal(txr.status, 200, 'accounting can record transaction');
    const pr = await acc.post('/api/payment-requests', { project_id: project.id, category: 'materialy', amount: 500, payee: 'Deliver OOD' });
    assert.equal(pr.status, 200, 'accounting can file payment request');
    assert.equal((await acc.post(`/api/payment-requests/${pr.data.id}/approve`)).status, 403, 'accounting cannot approve own request');
  } finally { await t.stop(); }
});

test('proformas: issue against contract, mark paid posts one receipt, cancel rules, finance moves', async () => {
  const t = await start();
  try {
    const acc = await t.mkUser('acc1', 'accounting');
    const { project } = await signedProject(t);

    const bad = await acc.post('/api/proformas', { project_id: project.id, amount: 0 });
    assert.equal(bad.status, 400, 'zero amount rejected');
    const missing = await acc.post('/api/proformas', { project_id: 9999, amount: 10 });
    assert.equal(missing.status, 404, 'unknown project rejected');

    const autoPf = t.db.prepare("SELECT * FROM proformas WHERE project_id = ? AND kind = 'advance'").get(project.id);
    assert.ok(autoPf, 'signing auto-issues the advance proforma');

    const pf = (await acc.post('/api/proformas', { project_id: project.id, kind: 'advance', amount: 1200, issued_on: '2026-01-10', due_on: '2026-01-20', note: 'Аванс 30%' })).data;
    assert.equal(pf.status, 'issued');
    assert.equal(pf.code, 'PF-0002', 'manual proforma takes the next number after the auto one');
    assert.equal(pf.vat_pct, 20, 'vat defaults from settings');

    const list = (await acc.get(`/api/proformas?project_id=${project.id}`)).data;
    assert.equal(list.length, 2);
    assert.equal(list[0].project_code, project.code);

    const fin0 = (await acc.get(`/api/projects/${project.id}/finance`)).data;
    assert.equal(fin0.invoiced, 1440 + autoPf.amount * 1.2);
    assert.equal(fin0.receivables, 1440 + autoPf.amount * 1.2, 'unpaid proformas = receivable');

    const paid = await acc.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-20' });
    assert.equal(paid.status, 200);
    const tx = paid.data.transaction;
    assert.equal(tx.direction, 'in');
    assert.equal(tx.status, 'paid');
    assert.equal(tx.amount, 1440);
    assert.equal(tx.proforma_id, pf.id);
    assert.equal(tx.project_id, project.id);
    assert.equal(tx.counterparty, 'Тест Клиент ООД', 'receipt counterparty = customer');

    const again = await acc.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-20' });
    assert.equal(again.status, 200);
    assert.equal(again.data.transaction.id, tx.id, 'second paid call returns same transaction');
    const txCount = t.db.prepare('SELECT COUNT(*) n FROM transactions WHERE proforma_id = ?').get(pf.id).n;
    assert.equal(txCount, 1, 'no double-posted receipt');

    const fin1 = (await acc.get(`/api/projects/${project.id}/finance`)).data;
    assert.equal(fin1.payments_received, 1440);
    assert.equal(fin1.receivables, autoPf.amount * 1.2, 'the auto advance proforma is still owed');

    const cancelPaid = await acc.post(`/api/proformas/${pf.id}/cancel`);
    assert.equal(cancelPaid.status, 400, 'paid proforma cannot be cancelled');

    const pf2 = (await acc.post('/api/proformas', { project_id: project.id, kind: 'final', amount: 500 })).data;
    const cx = await acc.post(`/api/proformas/${pf2.id}/cancel`);
    assert.equal(cx.status, 200);
    assert.equal(cx.data.status, 'cancelled');
    const fin2 = (await acc.get(`/api/projects/${project.id}/finance`)).data;
    assert.equal(fin2.invoiced, 1440 + autoPf.amount * 1.2, 'cancelled proforma excluded from invoiced');
  } finally { await t.stop(); }
});

test('transactions: manual entry, edit with 409 guard, voided excluded from totals', async () => {
  const t = await start();
  try {
    const acc = await t.mkUser('acc1', 'accounting');
    const { project } = await signedProject(t);

    assert.equal((await acc.post('/api/transactions', { direction: 'sideways', category: 'x', amount: 1, tx_date: '2026-01-01' })).status, 400);
    assert.equal((await acc.post('/api/transactions', { direction: 'in', category: 'x', amount: -5, tx_date: '2026-01-01' })).status, 400);
    assert.equal((await acc.post('/api/transactions', { direction: 'in', category: 'x', amount: 5, tx_date: 'not-a-date' })).status, 400);
    assert.equal((await acc.post('/api/transactions', { direction: 'in', amount: 5, tx_date: '2026-01-01' })).status, 400, 'category required');

    const tx = (await acc.post('/api/transactions', { project_id: project.id, direction: 'out', category: 'materialy', amount: 300, tx_date: '2026-01-15', counterparty: 'Trader EOOD', status: 'planned' })).data;
    assert.equal(tx.code, 'TXN-0001');
    assert.equal(tx.status, 'planned');

    const fin = (await acc.get(`/api/projects/${project.id}/finance`)).data;
    assert.equal(fin.planned_out, 300);
    assert.equal(fin.payments_made, 0, 'planned is not paid');

    const upd = await acc.patch(`/api/transactions/${tx.id}`, { amount: 320, status: 'paid', row_version: tx.row_version });
    assert.equal(upd.status, 200);
    const stale = await acc.patch(`/api/transactions/${tx.id}`, { amount: 1, row_version: tx.row_version });
    assert.equal(stale.status, 409, 'stale row_version rejected');

    const fin2 = (await acc.get(`/api/projects/${project.id}/finance`)).data;
    assert.equal(fin2.payments_made, 320);

    const v = await acc.patch(`/api/transactions/${tx.id}`, { status: 'voided', row_version: tx.row_version + 1 });
    assert.equal(v.status, 200);
    const fin3 = (await acc.get(`/api/projects/${project.id}/finance`)).data;
    assert.equal(fin3.payments_made, 0, 'voided transaction excluded');
    assert.equal(fin3.payables, 0);

    const all = (await acc.get('/api/transactions')).data;
    assert.ok(all.some(r => r.id === tx.id), 'global transaction list works');
  } finally { await t.stop(); }
});

test('payment requests: file -> management notified -> approve/reject, no auto money', async () => {
  const t = await start();
  try {
    const acc = await t.mkUser('acc1', 'accounting');
    const mgr = await t.mkUser('boss1', 'manager');
    const { project } = await signedProject(t);

    assert.equal((await acc.post('/api/payment-requests', { project_id: project.id, category: 'trud', amount: 10, payee: '' })).status, 400, 'payee required');
    const req = (await acc.post('/api/payment-requests', { project_id: project.id, category: 'materialy', amount: 5000, payee: 'Supplier OOD', reason: 'materials for object' })).data;
    assert.equal(req.status, 'pending');
    assert.equal(req.code, 'PAY-0001');
    assert.equal(req.exceptional, 1, 'above exceptional_expense_limit auto-flagged');

    const appr = t.db.prepare("SELECT * FROM approvals WHERE entity_type = 'payment_request' AND entity_id = ?").get(req.id);
    assert.ok(appr, 'approval row created');
    assert.equal(appr.status, 'pending');

    t.sync();
    const note = t.db.prepare("SELECT * FROM notifications WHERE event_id IS NOT NULL AND department = 'management' ORDER BY id DESC LIMIT 1").get();
    assert.ok(note, 'management notified of new request');

    const txBefore = t.db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
    const ok = await mgr.post(`/api/payment-requests/${req.id}/approve`, { note: 'ok' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, 'approved');
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM transactions').get().n, txBefore, 'approval does not auto-post money');

    t.sync();
    const note2 = t.db.prepare("SELECT * FROM notifications WHERE department = 'accounting' ORDER BY id DESC LIMIT 1").get();
    assert.ok(note2, 'accounting notified of decision');

    const req2 = (await acc.post('/api/payment-requests', { project_id: project.id, category: 'uslugi', amount: 100, payee: 'Service OOD' })).data;
    const no = await mgr.post(`/api/payment-requests/${req2.id}/reject`, { note: 'няма нужда' });
    assert.equal(no.status, 200);
    assert.equal(no.data.status, 'rejected');
    const again = await mgr.post(`/api/payment-requests/${req2.id}/approve`);
    assert.equal(again.status, 400, 'decided request cannot be re-decided');
  } finally { await t.stop(); }
});

test('accommodations + portfolio + per-project finance bundle', async () => {
  const t = await start();
  try {
    const acc = await t.mkUser('acc1', 'accounting');
    const { project } = await signedProject(t);

    assert.equal((await acc.post('/api/accommodations', { place: 'Hotel', cost_per_night: 50 })).status, 400, 'project_id required');
    const acco = (await acc.post('/api/accommodations', { project_id: project.id, place: 'Hotel', address: 'София', date_from: '2026-01-05', date_to: '2026-01-20', beds: 4, cost_per_night: 60, payment_method: 'invoice', workers: '4' })).data;
    assert.equal(acco.place, 'Hotel');
    const accoUpd = await acc.patch(`/api/accommodations/${acco.id}`, { beds: 6, row_version: acco.row_version });
    assert.equal(accoUpd.status, 200);
    const accoStale = await acc.patch(`/api/accommodations/${acco.id}`, { beds: 1, row_version: acco.row_version });
    assert.equal(accoStale.status, 409);

    const autoAmt = t.db.prepare("SELECT amount FROM proformas WHERE project_id = ? AND kind = 'advance' AND status != 'cancelled'").get(project.id)?.amount || 0;
    await acc.post('/api/proformas', { project_id: project.id, amount: 6000 });
    const pf = (await acc.get('/api/proformas?project_id=' + project.id)).data[0];
    await acc.post(`/api/proformas/${pf.id}/paid`, { paid_at: '2026-11-20' });
    await acc.post('/api/transactions', { project_id: project.id, direction: 'out', category: 'materialy', amount: 800, tx_date: '2026-01-20', status: 'committed' });

    const fin = (await acc.get(`/api/projects/${project.id}/finance`)).data;
    for (const k of ['contract_value', 'offer_value', 'invoiced', 'payments_received', 'payments_made', 'receivables', 'payables', 'planned_expenses', 'actual_expenses', 'remaining_budget', 'planned_result', 'result_to_date', 'forecast_result', 'earned_value', 'earned_cost', 'progress_pct', 'work_not_invoiced', 'cost_variance'])
      assert.ok(k in fin, `finance.${k} present`);
    assert.equal(fin.invoiced, 7200 + autoAmt * 1.2);
    assert.equal(fin.payments_received, 7200);
    assert.equal(fin.payables, 800);
    assert.equal(fin.proformas.length, 2, 'manual proforma + auto advance proforma');
    assert.equal(fin.transactions.length, 2, 'proforma receipt + manual expense');
    assert.deepEqual(fin.transactions.map(x => x.direction).sort(), ['in', 'out']);
    assert.equal(fin.accommodations.length, 1);

    const port = (await acc.get('/api/accounting')).data;
    assert.ok(Array.isArray(port.projects));
    const row = port.projects.find(p => p.id === project.id);
    assert.ok(row, 'project in portfolio');
    assert.equal(row.invoiced, 7200 + autoAmt * 1.2);
    assert.ok(port.totals.invoiced >= 6000 + autoAmt);
  } finally { await t.stop(); }
});
