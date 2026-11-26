// Т.40: офисът отбелязва файлове „за бригадира" и ги изпраща; бригадирът получава известие към своя таб „Документи".
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('office marks files for the brigadier, who is told and sees them first', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const brig = await t.mkUser('brig', 'brigadier');
    const bid = t.db.prepare("SELECT id FROM users WHERE username = 'brig'").get().id;
    const row = (await a.get(`/api/projects/${pid}`)).data;
    await a.patch(`/api/projects/${pid}`, { brigadier_id: bid, row_version: row.row_version });
    const cookie = (await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'password123' }) })).headers.get('set-cookie').split(';')[0];
    const up = async name => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from(name)], { type: 'application/pdf' }), name);
      return (await fetch(t.base + `/api/projects/${pid}/documents`, { method: 'POST', headers: { cookie }, body: fd })).json(); };
    const d1 = await up('чертеж.pdf'), d2 = await up('спецификация.pdf');
    const r = await a.post(`/api/projects/${pid}/documents/brigade`, { ids: [d2.id], share: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    t.sync();
    const docs = (await brig.get(`/api/projects/${pid}/documents`)).data;
    assert.deepEqual(docs.map(d => [d.id, d.shared_with_brigade]), [[d2.id, 1], [d1.id, 0]], 'shared first, all visible');
    const n = (await brig.get('/api/notifications')).data.find(x => x.ref_type === 'document' && x.ref_id === d2.id);
    assert.ok(n, 'brigadier is notified');
    assert.equal(n.link, `/brigade/${pid}?tab=docs&focus=${d2.id}`);
    assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'document' AND entity_id = ? AND action = 'share_brigade'").get(d2.id), 'audited');
    await a.post(`/api/projects/${pid}/documents/brigade`, { ids: [d2.id], share: false });
    assert.equal((await brig.get(`/api/projects/${pid}/documents`)).data.find(d => d.id === d2.id).shared_with_brigade, 0);
    assert.equal((await brig.post(`/api/projects/${pid}/documents/brigade`, { ids: [d1.id], share: true })).status, 403, 'the office decides, not the brigadier');
  } finally { await t.stop(); }
});
