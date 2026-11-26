// Графикът дава на техника и бригадира целия ред от КС (с инструкцията), без цени.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('schedule lines carry the instruction and the done quantity, never prices', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    t.db.prepare("UPDATE project_lines SET tech_note = 'Лепило C2, фуга 3 мм' WHERE project_id = ? AND sort = 1").run(pid);
    const r = await t.admin.get(`/api/projects/${pid}/schedule`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const l = r.data.lines[0];
    assert.equal(l.tech_note, 'Лепило C2, фуга 3 мм');
    assert.equal(l.done_qty, 0);
    assert.ok(!('unit_price' in l) && !('unit_cost' in l), 'no prices');
  } finally { await t.stop(); }
});
