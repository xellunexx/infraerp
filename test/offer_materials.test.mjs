// Т.24: материалите и консумативите се задават в офертата за всеки ред и при потвърждаване стават рецепта на реда от КС.
// В обекта техникът може да ги промени с причина (записва се одит), а количествената сметка и заявката за материали ги ползват.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

test('offer line materials become the КС line recipe; the project can adjust them with a reason', async () => {
  const t = await start();
  try {
    const a = t.admin;
    const cust = (await a.post('/api/customers', { name: 'Клуб' })).data;
    const gr = (await a.post('/api/products', { code: 'EPDM', name: 'EPDM гранули', unit: 'кг', unit_cost: 2 })).data;
    const pu = (await a.post('/api/products', { code: 'PU', name: 'PU свързващо', unit: 'кг', unit_cost: 6 })).data;
    const o = (await a.post('/api/offers', { customer_id: cust.id, title: 'Площадка' })).data;
    const r = await a.put(`/api/offers/${o.id}`, { lines: [{ description: 'Ударопоглъщаща настилка 4 см', unit: 'м²', qty: 100, material_cost: 30,
      materials: [{ product_id: gr.id, norm_per_unit: 25, waste_pct: 5, note: 'Melos 1-3,5 мм' }, { product_id: pu.id, norm_per_unit: 4 }] }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const ol = r.data.versions.at(-1).lines[0];
    assert.deepEqual(ol.materials.map(m => [m.product_id, m.norm_per_unit, m.waste_pct]), [[gr.id, 25, 5], [pu.id, 4, 0]]);
    assert.equal((await a.put(`/api/offers/${o.id}`, { lines: [{ description: 'x', unit: 'м²', qty: 1, materials: [{ product_id: 999999, norm_per_unit: 1 }] }] })).status, 400, 'unknown product refused');
    await a.put(`/api/offers/${o.id}`, { lines: [{ description: 'Ударопоглъщаща настилка 4 см', unit: 'м²', qty: 100, material_cost: 30, materials: ol.materials }] });
    assert.equal((await a.post(`/api/offers/${o.id}/confirm`)).status, 200); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const cons = (await a.get(`/api/projects/${pid}/consumption`)).data.rows;
    const g = cons.find(x => x.product_id === gr.id);
    assert.equal(g.required, 2625, '100 м² × 25 кг × 1.05');
    const line = (await a.get(`/api/projects/${pid}`)).data.lines[0];
    assert.equal(line.materials.length, 2);
    // the project adjusts the recipe with a reason
    assert.equal((await a.put(`/api/project-lines/${line.id}/materials`, { items: [{ product_id: gr.id, norm_per_unit: 28, waste_pct: 5 }] })).status, 400, 'a reason is required');
    const ch = await a.put(`/api/project-lines/${line.id}/materials`, { items: [{ product_id: gr.id, norm_per_unit: 28, waste_pct: 5 }, { product_id: pu.id, norm_per_unit: 4 }], reason: 'Дебелина 4,5 см на място' });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    assert.equal((await a.get(`/api/projects/${pid}/consumption`)).data.rows.find(x => x.product_id === gr.id).required, 2940);
    assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'project_line' AND entity_id = ? AND action = 'materials'").get(line.id));
  } finally { await t.stop(); }
});
