// т.4, 5, 14: one calendar of the contract — every stage, payment, delivery and activity on its date, from the records themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('the contract calendar shows the contract, every payment stage, deliveries and activities — amounts only for money roles', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;   // 6200 net
    const put = b => a.put(`/api/projects/${pid}/contract/payments`, b);
    await put({ kind: 'interim', amount: 1500, label: 'След основата', due_on: '2026-12-15' });
    await put({ kind: 'interim', amount: 1500, due_on: '2020-01-10' });                              // long overdue
    for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 30 });
    assert.equal((await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' })).status, 200); t.sync();
    await a.patch(`/api/projects/${pid}/contract`, { prod_delivery_days: 20, install_days: 15 });
    const adv = (await a.get(`/api/projects/${pid}/contract`)).data.payments.find(p => p.kind === 'advance');
    await a.post(`/api/projects/${pid}/payments`, { contract_payment_id: adv.id, amount: adv.gross, tx_date: '2026-10-05' }); t.sync();
    await a.post('/api/deliveries', { project_id: pid, planned_date: '2026-11-20', items: [{ product_id: s.tile.id, qty: 1 }] }); t.sync();

    const cal = (await a.get(`/api/projects/${pid}/calendar`)).data;
    const lane = k => cal.lanes.find(l => l.key === k);
    assert.deepEqual(cal.lanes.map(l => l.key), ['contract', 'payments', 'deliveries', 'activities']);
    const c = Object.fromEntries(lane('contract').items.map(i => [i.id, i]));
    assert.equal(c.signed.date, '2026-10-01');
    assert.equal(c.advance.date, '2026-10-05');
    assert.deepEqual([c.production.start, c.production.end], ['2026-10-05', '2026-10-25'], 'advance + 20 days');
    assert.equal(c.final.date, '2026-11-09', 'advance + 20 + 15 days');
    const pay = lane('payments').items;
    assert.deepEqual(pay.map(p => [p.label, p.date ?? null, p.state]), [
      ['Аванс', '2026-10-05', 'done'], ['След основата', '2026-12-15', 'pending'], ['Междинно плащане №2', '2020-01-10', 'late'], ['Окончателно плащане', null, 'pending']]);
    assert.equal(pay[3].kind, 'undated', 'a stage with no date is listed, not dropped');
    assert.ok(pay[0].amount > 0, 'amount for money roles');
    assert.equal(lane('deliveries').items[0].date, '2026-11-20');
    assert.ok(lane('activities').items.length >= 1 && lane('activities').items.every(i => i.start && i.end), 'schedule activities on their dates');
    assert.ok(cal.lanes.flatMap(l => l.items).every(i => i.link), 'every item opens its record');

    // Logistics: no contract or payment lanes (no right to contracts/finance); the brigadier sees deliveries and activities
    const lg = await t.mkUser('lg', 'logistics'), br = await t.mkUser('br', 'brigadier');
    await a.patch(`/api/projects/${pid}`, { brigadier_id: t.db.prepare("SELECT id FROM users WHERE username = 'br'").get().id });
    assert.deepEqual((await lg.get(`/api/projects/${pid}/calendar`)).data.lanes.map(l => l.key), ['deliveries', 'activities']);
    assert.deepEqual((await br.get(`/api/projects/${pid}/calendar`)).data.lanes.map(l => l.key), ['deliveries', 'activities']);
    // the project technician reads contracts, so he sees the payment dates too
    const tech = await t.mkUser('tc', 'technical');
    await a.patch(`/api/projects/${pid}`, { technical_id: t.db.prepare("SELECT id FROM users WHERE username = 'tc'").get().id });
    const tp = (await tech.get(`/api/projects/${pid}/calendar`)).data.lanes.find(l => l.key === 'payments');
    assert.ok(tp, 'technician sees the payment dates');
  } finally { await t.stop(); }
});
