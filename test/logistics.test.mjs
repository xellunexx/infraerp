// Логистика: доставки до обект с артикели, техника (активи) и разпределение по обекти, портфолио и обеден изглед.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

/** offer -> confirm -> project exists (no contract needed for logistics). */
async function project(t) {
  const s = await seedOffer(t);
  const conf = await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
  assert.equal(conf.status, 200);
  t.sync();
  return { ...s, project: (await t.admin.get('/api/projects')).data[0] };
}

test('logistics: role gates — logistics rw, read-only roles cannot write, brigadier scope', async () => {
  const t = await start();
  try {
    const lg = await t.mkUser('logi1', 'logistics');
    const acc = await t.mkUser('acc1', 'accounting');
    const brig = await t.mkUser('brig1', 'brigadier');
    const { project: p, tile } = await project(t);

    assert.equal((await acc.get('/api/logistics')).status, 200, 'accounting has logistics read');
    assert.equal((await acc.post('/api/deliveries', { project_id: p.id, items: [{ product_id: tile.id, qty: 1 }] })).status, 403, 'accounting cannot write logistics');
    assert.equal((await acc.post('/api/assets', { name: 'X', kind: 'vehicle' })).status, 403, 'accounting cannot register assets');

    const port = (await brig.get('/api/logistics')).data;
    assert.equal(port.projects.length, 0, 'brigadier sees no unassigned projects');
    assert.equal((await brig.get(`/api/projects/${p.id}/logistics`)).status, 403, 'brigadier cannot open unassigned project logistics');

    assert.equal((await lg.get('/api/logistics')).status, 200);
    assert.equal((await lg.get(`/api/projects/${p.id}/logistics`)).status, 200);
    const d = await lg.post('/api/deliveries', { project_id: p.id, planned_date: '2026-02-01', carrier: 'Econt', items: [{ product_id: tile.id, qty: 10 }] });
    assert.equal(d.status, 200, 'logistics can plan a delivery');
  } finally { await t.stop(); }
});

test('deliveries: create with items, status flow, 409 guard, project bundle, notifications', async () => {
  const t = await start();
  try {
    const lg = await t.mkUser('logi1', 'logistics');
    const { project: p, tile, glue } = await project(t);

    assert.equal((await lg.post('/api/deliveries', { project_id: p.id, items: [] })).status, 400, 'delivery without items rejected');
    assert.equal((await lg.post('/api/deliveries', { project_id: 9999, items: [{ product_id: tile.id, qty: 1 }] })).status, 404, 'unknown project rejected');

    const d = (await lg.post('/api/deliveries', { project_id: p.id, planned_date: '2026-02-01', carrier: 'Speedy', pallets: 2, palletized: 1,
      items: [{ product_id: tile.id, qty: 10 }, { product_id: glue.id, qty: 25 }] })).data;
    assert.ok(d.code.startsWith('DLV-'), 'delivery gets DLV code');
    assert.equal(d.status, 'planned');
    assert.equal(d.items.length, 2, 'items attached to response');

    t.sync();
    const notes = t.db.prepare('SELECT department, title FROM notifications WHERE project_id = ?').all(p.id);
    assert.ok(notes.some(n => n.department === 'warehouse' && n.title.includes(d.code)), 'warehouse notified of new delivery');

    assert.equal((await lg.patch(`/api/deliveries/${d.id}`, { status: 'delivered', row_version: d.row_version })).status, 400, 'planned cannot jump to delivered');
    const t1 = (await lg.patch(`/api/deliveries/${d.id}`, { status: 'in_transit', row_version: d.row_version })).data;
    assert.equal(t1.status, 'in_transit');
    const t2 = (await lg.patch(`/api/deliveries/${d.id}`, { status: 'delivered', row_version: t1.row_version })).data;
    assert.equal(t2.status, 'delivered');
    assert.equal((await lg.patch(`/api/deliveries/${d.id}`, { status: 'planned', row_version: t2.row_version })).status, 400, 'delivered is terminal');
    assert.equal((await lg.patch(`/api/deliveries/${d.id}`, { carrier: 'X', row_version: d.row_version })).status, 409, 'stale row_version rejected');

    const rep = (await lg.patch(`/api/deliveries/${d.id}`, { items: [{ product_id: glue.id, qty: 5 }], row_version: t2.row_version })).data;
    assert.equal(rep.items.length, 1, 'items replaced atomically');
    assert.equal(rep.items[0].product_id, glue.id);

    const list = (await lg.get(`/api/deliveries?project_id=${p.id}`)).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].items_count, 1);
    assert.ok(list[0].items_summary.includes('Лепило'), 'items summary rendered');

    const bundle = (await lg.get(`/api/projects/${p.id}/logistics`)).data;
    assert.equal(bundle.deliveries.length, 1);
    assert.equal(bundle.deliveries[0].items.length, 1, 'project bundle carries items');
    assert.equal(bundle.logistics_fields.site_address, undefined, 'only logistics fields exposed');

    const port = (await lg.get('/api/logistics')).data;
    const pj = port.projects.find(x => x.id === p.id);
    assert.equal(pj.deliveries.delivered, 1);
    assert.equal(pj.deliveries.total, 1);
  } finally { await t.stop(); }
});

test('assets and allocations: registry, overlap guard, lifecycle, portfolio', async () => {
  const t = await start();
  try {
    const lg = await t.mkUser('logi1', 'logistics');
    const { project: p } = await project(t);

    assert.equal((await lg.post('/api/assets', { name: '', kind: 'vehicle' })).status, 400, 'asset name required');
    const van = (await lg.post('/api/assets', { name: 'Фургон Мерцедес', kind: 'vehicle', plate: 'CB 1234 AB' })).data;
    assert.ok(van.code.startsWith('AST-'), 'asset gets AST code');
    assert.equal(van.status, 'available');

    const badDates = await lg.post('/api/asset-allocations', { asset_id: van.id, project_id: p.id, date_from: '2026-03-01', date_to: '2026-02-01' });
    assert.equal(badDates.status, 400, 'date_to before date_from rejected');

    const al = (await lg.post('/api/asset-allocations', { asset_id: van.id, project_id: p.id, date_from: '2026-02-01', date_to: '2026-03-01' })).data;
    assert.equal(al.status, 'planned');
    const overlap = await lg.post('/api/asset-allocations', { asset_id: van.id, project_id: p.id, date_from: '2026-02-15', date_to: '2026-02-20' });
    assert.equal(overlap.status, 400, 'overlapping allocation rejected');
    const later = await lg.post('/api/asset-allocations', { asset_id: van.id, project_id: p.id, date_from: '2026-04-01', date_to: '2026-04-10' });
    assert.equal(later.status, 200, 'non-overlapping allocation allowed');

    const al2 = (await lg.patch(`/api/asset-allocations/${al.id}`, { status: 'active', row_version: al.row_version })).data;
    assert.equal(al2.status, 'active');
    assert.equal((await lg.patch(`/api/asset-allocations/${al.id}`, { status: 'bogus', row_version: al2.row_version })).status, 400, 'bad status rejected');
    const done = (await lg.patch(`/api/asset-allocations/${al.id}`, { status: 'completed', row_version: al2.row_version })).data;
    assert.equal(done.status, 'completed');

    const bundle = (await lg.get(`/api/projects/${p.id}/logistics`)).data;
    assert.equal(bundle.allocations.length, 2);
    assert.equal(bundle.allocations.find(a => a.id === al.id).asset_name, 'Фургон Мерцедес');

    const assets = (await lg.get('/api/assets')).data;
    const vanRow = assets.find(a => a.id === van.id);
    assert.ok(vanRow.allocated_project, 'asset list shows current allocation');

    const port = (await lg.get('/api/logistics')).data;
    assert.ok(port.fleet.available >= 1);
    assert.ok(port.projects.find(x => x.id === p.id).active_allocations >= 1);
  } finally { await t.stop(); }
});

test('supplier orders: logistics reads and updates the shared order record; consumption statement per project', async () => {
  const t = await start();
  try {
    const lg = await t.mkUser('logi1', 'logistics');
    const { project: p } = await project(t);

    // логистикът създава поръчка към доставчик (споделеният запис, преди само finance го виждаше)
    const cr = await lg.post('/api/supplier-orders', { project_id: p.id, supplier: 'VINCI PLAY', total_eur: 12000, advance_eur: 6000, prod_days: 30, transport_days: 7 });
    assert.equal(cr.status, 200, JSON.stringify(cr.data));
    const oid = cr.data.id;
    assert.equal(cr.data.computed_status, 'ordered');

    // платен аванс → статусът се извежда „в производство“, готовността се смята от реалната дата
    { await t.admin.post(`/api/supplier-orders/${oid}/payments`, { stage: 'advance', amount: 6000, tx_date: '2026-01-10' }); }
    const p1 = { status: 200, data: (await lg.get('/api/supplier-orders')).data[0] };
    assert.equal(p1.status, 200, JSON.stringify(p1.data));
    assert.equal(p1.data.computed_status, 'in_production');
    assert.equal(p1.data.ready_date, '2026-02-09', 'готовност = аванс + дни производство');

    // доплащане → „в път“; доставена → крайно състояние
    { await t.admin.post(`/api/supplier-orders/${oid}/payments`, { stage: 'final', amount: 6000, tx_date: '2026-02-05' }); }
    const p2 = { status: 200, data: (await lg.get('/api/supplier-orders')).data[0] };
    assert.equal(p2.status, 200);
    assert.equal(p2.data.computed_status, 'in_transit');
    assert.equal(p2.data.expected_delivery, '2026-02-12', 'доставка = доплащане + дни транспорт');
    const p3 = await lg.patch(`/api/supplier-orders/${oid}`, { status: 'delivered', row_version: p2.data.row_version });
    assert.equal(p3.data.computed_status, 'delivered');

    // логистикът вижда поръчките по обект
    const list = (await lg.get(`/api/supplier-orders?project_id=${p.id}`)).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].supplier, 'VINCI PLAY');

    // количествената сметка по обект е четима от логистика
    const cons = await lg.get(`/api/projects/${p.id}/consumption`);
    assert.equal(cons.status, 200, 'logistics reads the quantity statement');
    assert.ok(Array.isArray(cons.data.rows));

    // ролевата матрица: brigadier има logistics само за четене — пишещите му заявки се отхвърлят
    const brig = await t.mkUser('brig1', 'brigadier');
    assert.equal((await brig.get('/api/supplier-orders')).status, 200, 'brigadier reads orders (logistics read)');
    assert.equal((await brig.patch(`/api/supplier-orders/${oid}`, { status: 'ordered', row_version: p3.data.row_version })).status, 403, 'read-only role cannot write');
    assert.equal((await t.admin.get('/api/supplier-orders')).status, 200, 'finance lane unaffected');
  } finally { await t.stop(); }
});
