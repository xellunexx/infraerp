// 4.3: заявка (по КС и извън КС), одобрение от друг човек, доставка = изписване, вградено по норма.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

async function project(t) {
  const a = t.admin;
  const cust = (await a.post('/api/customers', { name: 'Клуб' })).data;
  const gr = (await a.post('/api/products', { code: 'EPDM', name: 'EPDM гранули', unit: 'кг', unit_cost: 2 })).data;
  const glue = (await a.post('/api/products', { code: 'GLUE', name: 'Лепило', unit: 'кг', unit_cost: 5 })).data;
  const o = (await a.post('/api/offers', { customer_id: cust.id, title: 'Площадка' })).data;
  await a.put(`/api/offers/${o.id}`, { lines: [{ description: 'Настилка', unit: 'м²', qty: 100, material_cost: 30, materials: [{ product_id: gr.id, norm_per_unit: 25 }] }] });
  await a.post(`/api/offers/${o.id}/confirm`); t.sync();
  const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
  await a.post('/api/warehouse/movements', { product_id: gr.id, kind: 'receipt', qty: 5000 });
  await a.post('/api/warehouse/movements', { product_id: glue.id, kind: 'receipt', qty: 100 });
  return { pid, gr, glue, line: t.db.prepare('SELECT * FROM project_lines WHERE project_id = ?').get(pid) };
}

test('a material outside the КС needs a reason and the Manager; nobody approves their own request', async () => {
  const t = await start();
  try {
    const { pid, gr, glue } = await project(t);
    const tech = await t.mkUser('tech', 'technical'), wh = await t.mkUser('sklad', 'warehouse'), boss = await t.mkUser('boss', 'manager');
    assert.equal((await tech.post(`/api/projects/${pid}/material-requests`, { items: [{ product_id: glue.id, qty: 10 }] })).status, 400, 'outside КС without a reason');
    const r = (await tech.post(`/api/projects/${pid}/material-requests`, { items: [{ product_id: gr.id, qty: 1000 }, { product_id: glue.id, qty: 10, reason: 'Ремонт на основата' }] })).data;
    const items = t.db.prepare('SELECT product_id, outside_contract, reason FROM request_items WHERE request_id = ? ORDER BY id').all(r.id);
    assert.deepEqual(items.map(i => [i.product_id, i.outside_contract]), [[gr.id, 0], [glue.id, 1]]);
    assert.equal((await tech.post(`/api/material-requests/${r.id}/approve`)).status, 403, 'not your own request');
    assert.equal((await wh.post(`/api/material-requests/${r.id}/approve`)).status, 403, 'outside КС: the Manager decides');
    assert.equal((await boss.post(`/api/material-requests/${r.id}/approve`)).status, 200);
    const r2 = (await tech.post(`/api/projects/${pid}/material-requests`, { items: [{ product_id: gr.id, qty: 500 }] })).data;
    assert.equal((await wh.post(`/api/material-requests/${r2.id}/approve`)).status, 200, 'within КС: the warehouse approves');
  } finally { await t.stop(); }
});

test('a delivered delivery issues its request; built-in follows the daily reports by the norm', async () => {
  const t = await start();
  try {
    const a = t.admin, { pid, gr, line } = await project(t);
    const tech = await t.mkUser('tech', 'technical');
    const r = (await tech.post(`/api/projects/${pid}/material-requests`, { items: [{ product_id: gr.id, qty: 1000 }] })).data;
    await a.post(`/api/material-requests/${r.id}/approve`);
    const d = (await a.post('/api/deliveries', { project_id: pid, planned_date: '2026-12-01', request_id: r.id, items: [{ product_id: gr.id, qty: 1000 }] })).data;
    let row = (await a.get(`/api/deliveries?project_id=${pid}`)).data[0];
    row = (await a.patch(`/api/deliveries/${d.id}`, { status: 'in_transit', row_version: row.row_version })).data;
    await a.patch(`/api/deliveries/${d.id}`, { status: 'delivered', row_version: row.row_version });
    assert.equal(t.db.prepare('SELECT status FROM material_requests WHERE id = ?').get(r.id).status, 'fulfilled', 'delivery closes the request');
    let c = (await a.get(`/api/projects/${pid}/consumption`)).data.rows.find(x => x.product_id === gr.id);
    assert.deepEqual([c.issued, c.consumed, c.on_site], [1000, 0, 1000]);
    const e = (await a.post(`/api/projects/${pid}/progress`, { project_line_id: line.id, work_date: '2026-11-20', qty: 10 })).data.entry;
    c = (await a.get(`/api/projects/${pid}/consumption`)).data.rows.find(x => x.product_id === gr.id);
    assert.deepEqual([c.consumed, c.on_site, c.basis], [250, 750, 'norm'], '10 м² × 25 кг');
    assert.equal((await a.post(`/api/progress-entries/${e.id}/void`, { reason: 'грешка' })).status, 200);
    c = (await a.get(`/api/projects/${pid}/consumption`)).data.rows.find(x => x.product_id === gr.id);
    assert.equal(c.consumed, 0, 'a voided report takes its consumption back');
  } finally { await t.stop(); }
});
