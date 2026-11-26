// Записите, показани извън своя модул (в картона на обекта), водят до мястото, където се управляват.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('project finance and logistics rows carry the link to their home', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const pr = (await a.post('/api/payment-requests', { project_id: pid, category: 'труд', amount: 100, payee: 'X' })).data;
    const f = (await a.get(`/api/projects/${pid}/finance`)).data;
    assert.equal(f.payment_requests.find(r => r.id === pr.id).link, `/accounting?tab=requests&focus=${pr.id}`);
    const prod = t.db.prepare('SELECT id FROM products LIMIT 1').get().id;
    const d = (await a.post('/api/deliveries', { project_id: pid, planned_date: '2026-12-01', items: [{ product_id: prod, qty: 1 }] })).data;
    const l = (await a.get(`/api/projects/${pid}/logistics`)).data;
    assert.equal(l.deliveries.find(x => x.id === d.id).link, `/logistics?tab=deliveries&pid=${pid}&focus=${d.id}`);
  } finally { await t.stop(); }
});
