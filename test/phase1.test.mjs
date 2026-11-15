import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { processEvent, emit, on } from '../server/core.js';

test('Phase 1: offer -> contract -> Project Card through the sync engine', async () => {
  const t = await start();
  try {
    const { offer, saved, cust } = await seedOffer(t);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.versions[0].totals.net, 6200);

    // revision keeps the old version and locks it
    await t.admin.post(`/api/offers/${offer.id}/send`);
    const locked = await t.admin.put(`/api/offers/${offer.id}`, { lines: [] });
    assert.equal(locked.status, 400);
    const rev = await t.admin.post(`/api/offers/${offer.id}/revise`, { reason: 'Клиентът иска отстъпка' });
    assert.equal(rev.data.current_version, 2);
    assert.equal(rev.data.versions.length, 2);
    await t.admin.put(`/api/offers/${offer.id}`, { discount_pct: 10 });

    // confirm: only the event is written synchronously, nothing else yet
    const conf = await t.admin.post(`/api/offers/${offer.id}/confirm`);
    assert.equal(conf.status, 200);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM projects').get().n, 0);
    assert.equal((await t.admin.post(`/api/offers/${offer.id}/confirm`)).status, 400, 'double confirm rejected');
    t.sync();

    const projects = (await t.admin.get('/api/projects')).data;
    assert.equal(projects.length, 1);
    const p = (await t.admin.get(`/api/projects/${projects[0].id}`)).data;
    assert.match(p.code, /^PRJ-\d{4}-001$/);
    assert.equal(p.customer.id, cust.id);
    assert.equal(p.lines.length, 2);
    assert.equal(p.finance.contract_value, 5580, 'discount carried into КС prices');
    assert.equal(p.finance.offer_value, 5580);
    assert.equal(p.finance.cost_price, 3700);
    assert.equal(p.contract.status, 'draft');
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM project_line_recipe').get().n, 4, 'recipes copied to project lines');
    assert.equal(p.stages.find(s => s.code === 'contract_generation').status, 'active');
    const ev = t.db.prepare("SELECT * FROM events WHERE type = 'offer.confirmed'").get();
    assert.equal(ev.status, 'processed');
    assert.equal(ev.project_id, p.id);
    assert.equal(t.db.prepare("SELECT COUNT(*) n FROM event_effects WHERE event_id = ? AND status = 'ok'").get(ev.id).n, 3);
    const depts = t.db.prepare('SELECT department FROM notifications WHERE event_id = ?').all(ev.id).map(n => n.department).sort();
    assert.deepEqual(depts, ['contracts', 'management', 'technical']);

    // duplicate event protection: same dedupe key is ignored, re-processing does not repeat handlers
    assert.equal(emit(t.db, null, { type: 'offer.confirmed', origin: 'offers', entity_type: 'offer', entity_id: offer.id, dedupe_key: `offer.confirmed:${offer.id}` }), null);
    processEvent(t.db, ev.id);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM projects').get().n, 1);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM contracts').get().n, 1);

    // contract: cannot sign before approval; approval creates immutable version 1 with 3 appendices
    assert.equal((await t.admin.post(`/api/projects/${p.id}/contract/sign`)).status, 400);
    const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
    const upd = await t.admin.patch(`/api/projects/${p.id}/contract`, { install_start: '2026-12-01', install_deadline: '2026-12-20', delivery_deadline: '2026-11-28', advance_pct: 30, row_version: c0.row_version });
    assert.equal(upd.status, 200);
    const stale = await t.admin.patch(`/api/projects/${p.id}/contract`, { advance_pct: 40, row_version: c0.row_version });
    assert.equal(stale.status, 409, 'concurrent edit with stale version rejected');
    await t.admin.post(`/api/projects/${p.id}/contract/submit`);
    const appr = (await t.admin.post(`/api/projects/${p.id}/contract/approve`)).data;
    assert.equal(appr.active_version, 1);
    assert.equal(appr.appendices.length, 3);
    assert.equal(appr.versions[0].total_value, 5580);
    assert.equal((await t.admin.patch(`/api/projects/${p.id}/contract`, { advance_pct: 50 })).status, 400, 'approved contract is not silently editable');

    const sign = await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2026-11-20' });
    assert.equal(sign.status, 200);
    t.sync();
    const p2 = (await t.admin.get(`/api/projects/${p.id}`)).data;
    assert.equal(p2.status, 'preparation');
    assert.equal(p2.planned_start, '2026-12-01');
    assert.equal(p2.baseline_version, 1);
    const sched = t.db.prepare('SELECT start_date, end_date FROM schedule_items WHERE project_id = ? ORDER BY sort').all(p.id);
    assert.deepEqual(sched.map(s => [s.start_date, s.end_date]), [['2026-12-01', '2026-12-05'], ['2026-12-06', '2026-12-07']]);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM tasks WHERE project_id = ?').get(p.id).n, 2);
    assert.equal((await t.admin.get(`/api/projects/${p.id}/timeline`)).data.length >= 3, true);
    assert.equal((await t.admin.get('/api/search?q=' + encodeURIComponent('Настилка'))).data.some(r => r.kind === 'project'), true);
  } finally { await t.stop(); }
});

test('engine: a failing handler is retried, earlier handlers are not repeated, then the event is marked failed', async () => {
  const t = await start();
  try {
    let first = 0, second = 0, fail = true;
    on('test.flaky', 'first', () => { first++; return { n: first }; });
    on('test.flaky', 'second', () => { second++; if (fail) throw new Error('boom'); return { ok: true }; });
    const id = emit(t.db, null, { type: 'test.flaky', origin: 'test' });
    assert.equal(processEvent(t.db, id), 'pending');
    assert.equal(processEvent(t.db, id), 'pending');
    assert.equal(first, 1, 'successful handler ran once');
    assert.equal(second, 2);
    fail = false;
    assert.equal(processEvent(t.db, id), 'processed');
    assert.equal(first, 1);
    const id2 = emit(t.db, null, { type: 'test.flaky', origin: 'test' });
    fail = true;
    let st; for (let i = 0; i < 5; i++) st = processEvent(t.db, id2);
    assert.equal(st, 'failed');
    assert.match(t.db.prepare('SELECT last_error FROM events WHERE id = ?').get(id2).last_error, /second: boom/);
    fail = false;
    assert.equal((await t.admin.post(`/api/events/${id2}/retry`)).status, 200);
    t.sync();
    assert.equal(t.db.prepare('SELECT status FROM events WHERE id = ?').get(id2).status, 'processed');
  } finally { await t.stop(); }
});

test('permissions: roles are enforced on the server', async () => {
  const t = await start();
  try {
    await seedOffer(t);
    const wh = await t.mkUser('sklad', 'warehouse');
    const br = await t.mkUser('brig', 'brigadier');
    const com = await t.mkUser('tyrg', 'commercial');
    assert.equal((await wh.get('/api/offers')).status, 403);
    assert.equal((await wh.post('/api/customers', { name: 'X' })).status, 403);
    assert.equal((await br.post('/api/users', { username: 'x', full_name: 'x', role: 'admin', password: 'password123' })).status, 403);
    assert.equal((await com.get('/api/offers')).status, 200);
    assert.equal((await t.client().get('/api/offers')).status, 401);
    await com.post('/api/offers/1/confirm'); t.sync();
    assert.equal((await br.get('/api/projects')).data.length, 0, 'brigadier sees only assigned projects');
    assert.equal((await br.get('/api/projects/1')).status, 403);
    await t.admin.patch('/api/projects/1', { brigadier_id: t.db.prepare("SELECT id FROM users WHERE username = 'brig'").get().id });
    const seen = (await br.get('/api/projects/1')).data;
    assert.equal(seen.finance, null, 'no financial data for brigadier');
    assert.equal(seen.lines[0].unit_price, null);
    assert.equal((await wh.get('/api/projects')).data[0].contract_value, null);
  } finally { await t.stop(); }
});