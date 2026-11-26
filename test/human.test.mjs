// Хронологията и одитът са изречения на български, без суров JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { changes } from '../server/human.js';

test('changes read as "Поле: старо → ново"', () => {
  assert.deepEqual(changes(null, '{"status":"draft","note":null}', '{"status":"approved","note":"ок"}'), ['Статус: чернова → одобрена', 'Бележка: — → ок']);
  assert.deepEqual(changes(null, null, '{"planned_date":"2026-12-01"}'), ['Планирана дата: 01.12.2026']);
});

test('project timeline and audit come as sentences', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const tech = await t.mkUser('tech', 'technical');
    const tid = t.db.prepare("SELECT id FROM users WHERE username = 'tech'").get().id;
    const row = (await t.admin.get(`/api/projects/${pid}`)).data;
    assert.equal((await t.admin.patch(`/api/projects/${pid}`, { technical_id: tid, row_version: row.row_version })).status, 200);
    const tl = (await t.admin.get(`/api/projects/${pid}/timeline`)).data;
    assert.ok(tl.every(e => typeof e.sentence === 'string' && !/[{}]/.test(e.sentence)));
    assert.ok(tl.some(e => e.sentence.includes('потвърдена оферта')));
    const au = (await t.admin.get(`/api/projects/${pid}/audit`)).data;
    const a = au.find(x => (x.changes || []).some(c => c.startsWith('Техник:')));
    assert.ok(a, 'technician change reads as a sentence with names: ' + JSON.stringify(au.map(x => x.changes)));
    assert.ok(a.changes.some(c => c.includes('tech')), 'the user name, not the id');
  } finally { await t.stop(); }
});
