// Бележката към плащане се вижда в разплащателния график, на реда на етапа (едно място, без да се преписва).
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('a payment note shows on its milestone in the schedule', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 50 });
    await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' }); t.sync();
    const m = (await a.get(`/api/projects/${pid}/contract`)).data.payments.find(p => p.kind === 'advance');
    const r = await a.post(`/api/projects/${pid}/payments`, { contract_payment_id: m.id, amount: 1000, tx_date: '2026-11-20', note: 'Платено на две части, втората до петък' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const m2 = (await a.get(`/api/projects/${pid}/contract`)).data.payments.find(p => p.kind === 'advance');
    assert.deepEqual(m2.payment_notes, [{ date: '2026-11-20', amount: 1000, note: 'Платено на две части, втората до петък' }]);
  } finally { await t.stop(); }
});
