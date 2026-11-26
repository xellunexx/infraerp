// Един етап на обекта (в договаряне / предстоящ / в изпълнение), смятан на едно място: таблото и списъкът с обекти го показват еднакво.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('every project has one stage, the same on the dashboard and in the projects list', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const stage = async () => (await a.get('/api/projects')).data.find(p => p.id === pid).stage;
    assert.equal(await stage(), 'negotiating');
    for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 50 });
    await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' }); t.sync();
    assert.equal(await stage(), 'upcoming');
    const d = (await a.get('/api/dashboard')).data;
    assert.deepEqual([d.negotiating.length, d.upcoming.map(p => p.id), d.executing.length], [0, [pid], 0]);
  } finally { await t.stop(); }
});
