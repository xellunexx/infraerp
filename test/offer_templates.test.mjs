import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

test('offer templates from the Excel are loaded once and priced with the template formula when used', async () => {
  const t = await start();
  try {
    const list = (await t.admin.get('/api/offer-templates')).data;
    assert.equal(list.length, 23);
    const tour = list.find(x => x.title === 'TOUR COURT');
    assert.equal(tour.alternative, 1);
    const retop = list.find(x => x.title === 'InfraSPORT Retop');
    assert.equal(retop.lines[0].overhead_pct, 2);
    // use a template in an offer the way the editor does: section + its lines
    const cust = (await t.admin.post('/api/customers', { name: 'Клуб' })).data;
    const o = (await t.admin.post('/api/offers', { customer_id: cust.id, title: 'Тенис корт' })).data;
    const r = await t.admin.put(`/api/offers/${o.id}`, { sections: [{ key: 'a', title: tour.title, description: tour.description, alternative: false }], lines: tour.lines.map(l => ({ ...l, section: 'a' })) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const lines = r.data.versions[0].lines;
    assert.equal(lines[0].unit_price, 24.11, 'TOUR COURT line: 6.40 + 2.00 + 9.26 -> 24.11 as in the Excel');
    assert.equal(lines[1].unit_price, 1132.95, 'tennis marking 830 -> 1132.95');
    // a second start does not load the templates twice
    const { bootstrap } = await import('../server/core.js');
    bootstrap(t.db);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM offer_templates').get().n, 23);
    const brig = await t.mkUser('br', 'brigadier');
    assert.equal((await brig.get('/api/offer-templates')).status, 403);
  } finally { await t.stop(); }
});