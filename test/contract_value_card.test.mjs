// Картата „Договорна стойност" в обекта се вижда само от Счетоводство, Логистика и Управител (т.44).
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('contract value card: accounting, logistics and management only', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const card = async c => (await c.get(`/api/projects/${pid}`)).data.contract_value_card;
    for (const [u, role, sees] of [['acc', 'accounting', true], ['log', 'logistics', true], ['boss', 'manager', true], ['com', 'commercial', false], ['tech', 'technical', false]]) {
      const c = await t.mkUser(u, role);
      const v = await card(c);
      assert.equal(!!v, sees, `${role}`);
      if (sees) assert.equal(v.value, 6200);
    }
  } finally { await t.stop(); }
});
