// Реалните редове от „Таблица ексел" (имената са заменени с кодове) трябва да дадат числата на самата таблица, до стотинка.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { start, seedOffer } from './helpers.mjs';

const DATA = JSON.parse(fs.readFileSync(new URL('./fixtures/excel_ledger.json', import.meta.url), 'utf8'));
async function load(t, rows, target) {
  const ids = [];
  for (const r of rows) {
    const b = { ...target, direction: r.dir, tx_kind: r.kind, amount: r.amount, tx_date: r.date, category: r.kind, status: r.status || 'paid',
      ...(r.vat ? { has_vat: true, vat_amount: r.vat } : {}), ...(r.method ? { method: r.method } : {}), ...(r.labour_days != null ? { labour_days: r.labour_days } : {}),
      ...(r.doc != null ? { document_id: ids[r.doc] } : {}) };
    const x = await t.admin.post('/api/transactions', b);
    assert.equal(x.status, 200, JSON.stringify([r, x.data]));
    ids.push(x.data.id);
  }
}
const world = async fn => { const t = await start(); try { await fn(t, t.admin); } finally { await t.stop(); } };
async function project(t) { const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync(); return t.db.prepare('SELECT MAX(id) i FROM projects').get().i; }

test('project A gives the workbook result to the cent (14 548,82)', () => world(async (t, a) => {
  const pid = await project(t); await load(t, DATA.project_a, { project_id: pid });
  const r = (await a.get(`/api/projects/${pid}/finance`)).data.result;
  assert.deepEqual([r.income_net, r.materials_net, r.labour, r.total_cost, r.result_before, r.man_days, r.indirect_rate, r.indirect, r.result_after, r.unknown_days],
    [64897.4, 36600.45, 5648.13, 42248.58, 22648.82, 54, 150, 8100, 14548.82, 2]); // two real labour rows state no days; the workbook's 54 was typed by hand
}));
test('project B gives the workbook result to the cent (10 887,29)', () => world(async (t, a) => {
  const pid = await project(t); await load(t, DATA.project_b, { project_id: pid });
  const r = (await a.get(`/api/projects/${pid}/finance`)).data.result;
  assert.deepEqual([r.income_net, r.materials_net, r.labour, r.result_before, r.man_days, r.indirect, r.result_after], [27955.75, 13146.67, 1671.79, 13137.29, 15, 2250, 10887.29]);
  await a.put('/api/settings', { indirect_per_manday: '160' });
  assert.equal((await a.get(`/api/projects/${pid}/finance`)).data.result.indirect, 2400, 'the rate is a setting');
}));
test('the person card gives the workbook balance (118,80): fuel through ЕВРОВАГ is not the person\'s money', () => world(async (t, a) => {
  const p = (await a.post('/api/accountable-persons', { name: 'W1' })).data; await load(t, DATA.person, { person_id: p.id });
  const c = (await a.get(`/api/accountable-persons/${p.id}/card`)).data;
  assert.deepEqual([c.given, c.spent, c.returned, c.balance], [11006.84, 10888.04, 0, 118.8]);
  const e = (await a.post('/api/accountable-persons', { name: 'W2' })).data;
  assert.equal((await a.get(`/api/accountable-persons/${e.id}/card`)).data.balance, 0);
}));
test('fixture carries no names', () => {
  const text = JSON.stringify(DATA);
  assert.doesNotMatch(text, /[А-Яа-я]/, 'no Cyrillic text at all');
  const allowed = new Set(['amount', 'date', 'dir', 'doc', 'kind', 'labour_days', 'method', 'status', 'vat']);
  assert.deepEqual([...new Set(Object.values(DATA).flat().flatMap(Object.keys))].filter(k => !allowed.has(k)), []);
});
test('a labour row without days counts 0 days and is listed', () => world(async (t, a) => {
  const pid = await project(t);
  await a.post('/api/transactions', { project_id: pid, direction: 'out', tx_kind: 'labour', amount: 90, tx_date: '2026-11-01', category: 'труд', labour_days: 1 });
  await a.post('/api/transactions', { project_id: pid, direction: 'out', tx_kind: 'labour', amount: 90, tx_date: '2026-11-01', category: 'труд' });
  const r = (await a.get(`/api/projects/${pid}/finance`)).data.result;
  assert.deepEqual([r.labour, r.man_days, r.unknown_days, r.indirect], [180, 1, 1, 150]);
}));
