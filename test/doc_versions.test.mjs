// Един и същ файл не става втори документ: еднакъв → отказ; променен със същото име на същото място → нова версия.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('uploading a file again: identical is refused, changed becomes the next version of the same document', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const cid = t.db.prepare('SELECT id FROM contracts WHERE project_id = ?').get(pid).id;
    const cookie = (await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'password123' }) })).headers.get('set-cookie').split(';')[0];
    const up = async (bytes, name, entity = { entity_type: 'contract', entity_id: String(cid) }) => {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from(bytes)], { type: 'application/pdf' }), name);
      fd.append('category', 'contract'); for (const [k, v] of Object.entries(entity)) fd.append(k, v);
      const r = await fetch(t.base + `/api/projects/${pid}/documents`, { method: 'POST', headers: { cookie }, body: fd });
      return { status: r.status, data: await r.json() };
    };
    const a = await up('%PDF v1', 'ОУ Иван Вазов КСС №4.pdf');
    assert.equal(a.status, 200);
    const same = await up('%PDF v1', 'ОУ Иван Вазов КСС №4.pdf');
    assert.equal(same.status, 400, 'identical file refused');
    assert.match(same.data.error || same.data.message || JSON.stringify(same.data), /вече е качен/);
    const changed = await up('%PDF v2 changed', 'ОУ Иван Вазов КСС №4.pdf');
    assert.equal(changed.status, 200);
    assert.equal(changed.data.id, a.data.id, 'same document');
    assert.equal(changed.data.current_version, 2);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM documents WHERE project_id = ?').get(pid).n, 1);
    const other = await up('%PDF v2 changed', 'ОУ Иван Вазов КСС №4.pdf', {});
    assert.equal(other.status, 200, 'a different place (no contract link) is a document of its own');
    assert.notEqual(other.data.id, a.data.id);
  } finally { await t.stop(); }
});
