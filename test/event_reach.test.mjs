// Всяко събитие стига до засегнатите: без отделен обработчик → отделите в „affected"; смяна на отговорник → новият и старият човек.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { emit } from '../server/core.js';

test('an event with no handler of its own still reaches the affected departments, with a link to the record', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    emit(t.db, { id: 1 }, { type: 'proforma.issued', origin: 'accounting', project_id: pid, entity_type: 'proforma', entity_id: 77, next: { code: 'PF-1', amount: 100 }, affected: ['accounting', 'management'] });
    t.sync();
    const n = t.db.prepare("SELECT * FROM notifications WHERE ref_type = 'proforma' AND ref_id = 77").all();
    assert.deepEqual(n.map(x => x.department).sort(), ['accounting', 'management']);
    assert.match(n[0].title, /Издадена проформа/);
    assert.equal(n[0].link, '/accounting?tab=proformas&focus=77');
  } finally { await t.stop(); }
});

test('a new technician and the one replaced are both told', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const a1 = await t.mkUser('ivan', 'technical'), a2 = await t.mkUser('petar', 'technical');
    const id = u => t.db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
    let row = (await t.admin.get(`/api/projects/${pid}`)).data;
    await t.admin.patch(`/api/projects/${pid}`, { technical_id: id('ivan'), row_version: row.row_version }); t.sync();
    row = (await t.admin.get(`/api/projects/${pid}`)).data;
    await t.admin.patch(`/api/projects/${pid}`, { technical_id: id('petar'), row_version: row.row_version }); t.sync();
    const mine = async c => (await c.get('/api/notifications')).data.filter(x => x.ref_type === 'project' && x.user_id != null);
    assert.ok((await mine(a2)).some(x => /Петър|petar|отговорник/i.test(x.title + x.body)), 'the new one');
    assert.ok((await mine(a1)).length >= 2, 'the old one hears about the change too');
  } finally { await t.stop(); }
});
