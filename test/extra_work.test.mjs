// Т.26: дейност извън договора → анекс → одобрение (до 500 € двуфакторно от Оферти/Договори, над 500 € Управител)
// → нов ред в КС (маркиран), нова версия на договора, проформа към Счетоводство. Т.20: линейният график дава човекодни и хора на ден.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

async function signed(t) {
  const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
  for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 50 });
  await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' }); t.sync();
  return pid;
}
const extra = (c, pid, b) => c.post(`/api/projects/${pid}/schedule`, { name: 'Демонтаж на стара ограда', start_date: '2026-12-02', end_date: '2026-12-03', outside_contract: true, unit: 'м', qty: 40, unit_price: 10, note: 'по искане на клиента', ...b });

test('small extra work: two different people from Offers/Contracts; then КС line, contract version, proforma', async () => {
  const t = await start();
  try {
    const pid = await signed(t);
    const tech = await t.mkUser('tech', 'technical'), c1 = await t.mkUser('dog1', 'contracts'), c2 = await t.mkUser('dog2', 'contracts');
    assert.equal((await extra(tech, pid, { unit_price: undefined })).status, 400, 'price is required for work outside the contract');
    const r = await extra(tech, pid, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const am = t.db.prepare('SELECT * FROM amendments WHERE project_id = ?').get(pid);
    assert.deepEqual([am.status, am.amount, am.kind], ['pending', 400, 'extra_work']);
    assert.equal((await tech.post(`/api/amendments/${am.id}/approve`)).status, 403, 'technical does not approve');
    const c1r = await c1.post(`/api/amendments/${am.id}/approve`);
    assert.equal(c1r.status, 200, JSON.stringify(c1r.data));
    assert.equal(t.db.prepare('SELECT status FROM amendments WHERE id = ?').get(am.id).status, 'pending', 'first confirmation only');
    assert.equal((await c1.post(`/api/amendments/${am.id}/approve`)).status, 400, 'the same person cannot confirm twice');
    assert.equal((await c2.post(`/api/amendments/${am.id}/approve`)).status, 200);
    const a2 = t.db.prepare('SELECT * FROM amendments WHERE id = ?').get(am.id);
    assert.equal(a2.status, 'approved');
    const line = t.db.prepare('SELECT * FROM project_lines WHERE project_id = ? AND outside_contract = 1').get(pid);
    assert.deepEqual([line.description, line.unit, line.qty, line.unit_price], ['Демонтаж на стара ограда', 'м', 40, 10]);
    assert.equal(t.db.prepare('SELECT project_line_id FROM schedule_items WHERE id = ?').get(r.data.id).project_line_id, line.id);
    const v = t.db.prepare('SELECT * FROM contract_versions WHERE amendment_id = ?').get(am.id);
    assert.ok(v && v.version === 2, 'annex = new contract version');
    const pf = t.db.prepare('SELECT * FROM proformas WHERE amendment_id = ?').get(am.id);
    assert.equal(pf.amount, 400);
  } finally { await t.stop(); }
});

test('large extra work is the Manager\'s; rejected work leaves the schedule', async () => {
  const t = await start();
  try {
    const pid = await signed(t);
    const tech = await t.mkUser('tech', 'technical'), c1 = await t.mkUser('dog1', 'contracts'), boss = await t.mkUser('boss', 'manager');
    const r = await extra(tech, pid, { qty: 100, unit_price: 20 });
    const am = t.db.prepare('SELECT * FROM amendments WHERE project_id = ?').get(pid);
    assert.equal(am.amount, 2000);
    assert.equal((await c1.post(`/api/amendments/${am.id}/approve`)).status, 403, 'over 500 €: the Manager');
    assert.equal((await boss.post(`/api/amendments/${am.id}/reject`, { note: 'не е договорено' })).status, 200);
    assert.ok(!t.db.prepare('SELECT 1 FROM schedule_items WHERE id = ?').get(r.data.id), 'rejected work is taken off the schedule');
  } finally { await t.stop(); }
});

test('linear schedule: man-days from the offer labour, people per day', async () => {
  const t = await start();
  try {
    const a = t.admin;
    const cust = (await a.post('/api/customers', { name: 'К' })).data;
    const o = (await a.post('/api/offers', { customer_id: cust.id, title: 'Площадка' })).data;
    await a.put(`/api/offers/${o.id}`, { lines: [{ description: 'Бордюри', unit: 'м', qty: 574, labour_days: 0.1, day_rate: 150 }] });
    await a.post(`/api/offers/${o.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const it = (await a.get(`/api/projects/${pid}/schedule`)).data.items[0];
    await a.patch(`/api/schedule-items/${it.id}`, { start_date: '2026-12-01', end_date: '2026-12-20', row_version: it.row_version });
    const s = (await a.get(`/api/projects/${pid}/schedule`)).data.items[0];
    assert.deepEqual([s.man_days, s.duration_days, s.workers, s.qty_per_day], [57.4, 20, 2.87, 28.7]);
  } finally { await t.stop(); }
});
