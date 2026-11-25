// Видимост: бригадирът вижда само своите обекти и никога пари — по всички маршрути, не само по картона.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

const SECRET = 'ЧУЖД-ОБЕКТ';
async function world(t) {
  const a = t.admin, R = {};
  for (const r of ['brigadier', 'logistics', 'technical', 'warehouse', 'accounting']) R[r] = await t.mkUser(r, r);
  const s = await seedOffer(t);
  await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
  const mine = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
  const o2 = (await a.post('/api/offers', { customer_id: s.cust.id, title: SECRET })).data;
  await a.put(`/api/offers/${o2.id}`, { lines: [{ description: SECRET, unit: 'м2', qty: 10, unit_price: 777, unit_cost: 555 }] });
  await a.post(`/api/offers/${o2.id}/confirm`); t.sync();
  const other = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
  await a.patch(`/api/projects/${mine}`, { brigadier_id: t.db.prepare("SELECT id FROM users WHERE username = 'brigadier'").get().id });
  for (const p of [mine, other]) {
    await a.post(`/api/projects/${p}/contract/submit`, { advance_pct: 50 }); await a.post(`/api/projects/${p}/contract/approve`);
    await a.post(`/api/projects/${p}/contract/sign`, { signed_on: '2026-11-20', install_start: '2026-12-01', install_deadline: '2026-12-20' });
    const so = (await R.logistics.post('/api/supplier-orders', { project_id: p, supplier: 'VINCI', total_eur: 10000, advance_eur: 4000, prod_days: 30, transport_days: 7 })).data;
    await a.post(`/api/supplier-orders/${so.id}/payments`, { stage: 'advance', amount: 4000, tx_date: '2026-11-15' });
    await a.post(`/api/projects/${p}/material-requests`, { items: [{ product_id: s.tile.id, qty: 1 }] });
    await a.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'issue', qty: 1, project_id: p });
  }
  const mr = t.db.prepare('SELECT id FROM material_requests WHERE project_id = ?').get(other).id;
  await a.post(`/api/material-requests/${mr}/approve`);
  const asset = (await a.post('/api/assets', { name: 'Бус', kind: 'van' })).data;
  await a.post('/api/asset-allocations', { asset_id: asset.id, project_id: other, date_from: '2026-11-01', date_to: '2026-12-31', status: 'active' });
  const task = (await a.post('/api/tasks', { title: SECRET, project_id: other })).data;
  t.sync();
  return { R, mine, other, task, s };
}

test('scope: brigadier lists never contain another project; foreign writes are refused', async () => {
  const t = await start();
  try {
    const { R, mine, other, task, s } = await world(t), b = R.brigadier;
    for (const url of ['/api/supplier-orders', '/api/material-requests', '/api/warehouse/movements', '/api/warehouse/reservations', '/api/warehouse/fleet', '/api/assets',
      ...['project', 'project_line', 'task', 'schedule_item', 'project_stage', 'material_request', 'document', 'delivery', 'asset_allocation', 'issue', 'attendance'].map(x => `/api/change-requests/entities?type=${x}`)]) {
      const r = await b.get(url);
      assert.equal(r.status, 200, url);
      assert.ok(!JSON.stringify(r.data).includes(SECRET), `${url} leaks another project`);
      assert.ok(!r.data.some(x => x.project_id === other), `${url} leaks rows of another project`);
    }
    assert.ok((await b.get('/api/supplier-orders')).data.some(o => o.project_id === mine), 'own orders stay visible');
    assert.ok((await b.get('/api/change-requests/entities?type=project')).data.length === 1, 'own project stays requestable');
    assert.equal((await b.get(`/api/warehouse/demand?project_id=${other}`)).status, 403);
    assert.equal((await b.get(`/api/supplier-orders?project_id=${other}`)).data.length, 0);
    assert.equal((await b.post('/api/change-requests', { entity_type: 'project', entity_id: other, kind: 'edit', payload: { name: 'x' }, reason: 'x' })).status, 403);
    assert.equal((await b.post(`/api/tasks/${task.id}/done`)).status, 403);
    // an admin may widen a brigadier by module; the project boundary must still hold
    const uid = t.db.prepare("SELECT id FROM users WHERE username = 'brigadier'").get().id;
    await t.admin.put(`/api/users/${uid}/overrides`, { rows: ['contracts', 'projects', 'warehouse', 'finance'].map(resource => ({ resource, can_read: 1, can_write: 1, can_approve: 0 })) });
    assert.deepEqual((await b.get('/api/contracts')).data.map(c => c.project_id), [mine]);
    const ver = t.db.prepare('SELECT v.id FROM contract_versions v JOIN contracts c ON c.id = v.contract_id WHERE c.project_id = ?').get(other).id;
    assert.equal((await b.get(`/api/contract-versions/${ver}`)).status, 403);
    assert.equal((await b.patch(`/api/projects/${other}/contract`, { install_days: 1 })).status, 403);
    assert.equal((await b.post(`/api/projects/${other}/contract/submit`, { advance_pct: 50 })).status, 403);
    assert.equal((await b.post(`/api/projects/${other}/contract/sign`, {})).status, 403);
    assert.equal((await b.put(`/api/projects/${other}/contract/payments`, { kind: 'interim', pct: 1 })).status, 403);
    assert.equal((await b.patch(`/api/projects/${other}`, { name: 'x' })).status, 403);
    assert.equal((await b.post(`/api/projects/${other}/stages`, { code: 'schedule', status: 'done' })).status, 403);
    assert.equal((await b.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'issue', qty: 1, project_id: other })).status, 403);
    assert.equal((await b.post('/api/material-requests', { project_id: other, items: [{ product_id: s.tile.id, qty: 1 }] })).status, 403);
    const mr = t.db.prepare('SELECT id FROM material_requests WHERE project_id = ?').get(other).id;
    assert.equal((await b.post(`/api/material-requests/${mr}/cancel`)).status, 403);
    for (const url of ['/api/proformas', '/api/transactions', '/api/payment-requests', '/api/accommodations'])
      assert.ok(!(await b.get(url)).data.some(x => x.project_id === other), `${url} leaks rows of another project`);
    assert.ok(!(await b.get('/api/ledger')).data.rows.some(x => x.project_id === other));
  } finally { await t.stop(); }
});

test('money: timeline, audit, order register and change-request detail hide amounts from roles without access', async () => {
  const t = await start();
  try {
    const { R, mine } = await world(t), b = R.brigadier;
    const MONEY = /"(amount|cost|margin|gross|net|vat|total_with_vat|total_eur|advance_eur|unit_price|unit_cost)\\?":\s*-?\d/;
    for (const url of [`/api/projects/${mine}/timeline`, `/api/projects/${mine}/audit`]) {
      const rows = (await b.get(url)).data;
      assert.ok(rows.length, url);
      assert.doesNotMatch(JSON.stringify(rows), MONEY, `${url} leaks money`);
      assert.match(JSON.stringify((await R.accounting.get(url)).data), MONEY, 'finance keeps the figures');
    }
    // business facts survive the mask
    assert.match(JSON.stringify((await b.get(`/api/projects/${mine}/timeline`)).data), /install_start/);
    const o = (await b.get('/api/supplier-orders')).data[0];
    assert.deepEqual([o.total_eur, o.advance_eur, o.final_eur], [null, null, null]);
    assert.equal(o.ready_date, '2026-12-15'); assert.equal(o.computed_status, 'in_production');
    for (const role of ['logistics', 'accounting']) assert.equal((await R[role].get('/api/supplier-orders')).data[0].total_eur, 10000);
    const line = t.db.prepare('SELECT id FROM project_lines WHERE project_id = ?').get(mine).id;
    const cr = (await b.post('/api/change-requests', { entity_type: 'project_line', entity_id: line, kind: 'edit', reason: 'x' })).data;
    const cur = (await b.get(`/api/change-requests/${cr.id}`)).data.current;
    assert.deepEqual([cur.unit_price, cur.unit_cost, cur.qty], [null, null, 100]);
    // operator decision 2026-11-25: Technical keeps its contract view
    assert.equal((await R.technical.get(`/api/projects/${mine}/contract`)).data.total, 6200);
  } finally { await t.stop(); }
});
