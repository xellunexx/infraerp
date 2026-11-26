// т.45: urgency is calculated with its reasons and the Manager may set it by hand (with a reason) until he clears it.
// т.21: every КС line carries its origin in the offer (offer, version, line №, section).
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('urgency: calculated with reasons; the Manager sets and clears it; others may not', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    let u = (await a.get(`/api/projects/${pid}`)).data.urgency;
    assert.equal(u.level, 'normal');
    assert.deepEqual(u.reasons, []);
    await a.put(`/api/projects/${pid}/contract/payments`, { kind: 'interim', amount: 1000, due_on: '2020-01-01' });   // long overdue
    u = (await a.get(`/api/projects/${pid}`)).data.urgency;
    assert.equal(u.calculated, 'very_urgent');
    assert.ok(u.reasons.some(r => /просрочено/.test(r.text)), JSON.stringify(u.reasons));

    const ctr = await t.mkUser('ctr', 'contracts'), boss = await t.mkUser('boss', 'manager');
    assert.equal((await ctr.put(`/api/projects/${pid}/urgency`, { level: 'normal', reason: 'x' })).status, 403, 'only the Manager');
    assert.equal((await boss.put(`/api/projects/${pid}/urgency`, { level: 'normal' })).status, 400, 'a manual level needs a reason');
    assert.equal((await boss.put(`/api/projects/${pid}/urgency`, { level: 'normal', reason: 'Клиентът отложи плащането писмено' })).status, 200);
    t.sync();
    u = (await a.get(`/api/projects/${pid}`)).data.urgency;
    assert.deepEqual([u.level, u.calculated, u.manual.reason, u.manual.by], ['normal', 'very_urgent', 'Клиентът отложи плащането писмено', 'boss']);
    assert.ok(t.db.prepare("SELECT 1 FROM events WHERE type = 'project.urgency_set' AND project_id = ?").get(pid), 'the change is an event (Д1)');
    assert.equal((await boss.put(`/api/projects/${pid}/urgency`, { level: null })).status, 200);
    u = (await a.get(`/api/projects/${pid}`)).data.urgency;
    assert.deepEqual([u.level, u.manual], ['very_urgent', null], 'cleared back to the calculated level');
  } finally { await t.stop(); }
});

test('a КС line shows where it comes from in the offer', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const lines = (await a.get(`/api/projects/${pid}`)).data.lines;
    assert.ok(lines.length >= 2);
    assert.deepEqual(lines.map(l => [l.offer_id, l.offer_version, l.offer_line_no]), lines.map((_, i) => [s.offer.id, 1, i + 1]));
    assert.ok(lines.every(l => l.offer_code), 'offer number on every line');
  } finally { await t.stop(); }
});
