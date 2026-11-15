// Склад: складови движения → наличност, материални заявки → одобрение → резервации → изписване,
// заявка-помощник (потребност vs наличност). Справки: каталог, dwell, variance, exceptions, finance, attendance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('warehouse: movements drive stock; request → approve → fulfil issues stock and closes reservations', async () => {
  const t = await start();
  try {
    const { tile, project } = await (async () => {
      const s = await seedOffer(t);
      // направи обект чрез стандартния поток
      const conf = await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
      assert.equal(conf.status, 200);
      t.sync();
      return { ...s, project: (await t.admin.get('/api/projects')).data[0] };
    })();
    const pid = project.id;

    // приемане на 100бр. в склада
    const mv = await t.admin.post('/api/warehouse/movements', { product_id: tile.id, kind: 'receipt', qty: 100, document_ref: 'Ф-1' });
    assert.equal(mv.status, 200, JSON.stringify(mv.data));
    let stock = (await t.admin.get('/api/warehouse/stock')).data.find(s => s.id === tile.id);
    assert.equal(stock.on_hand, 100);
    assert.equal(stock.free, 100);

    // заявка за 60бр. към обекта
    const mr = await t.admin.post('/api/material-requests', { project_id: pid, needed_by: '2026-12-01',
      items: [{ product_id: tile.id, qty: 60 }] });
    assert.equal(mr.status, 200, JSON.stringify(mr.data));
    const mrid = mr.data.id;

    // помощникът вижда нуждата (не е нужно нищо — нямаме КС/рецепти към този продукт? имаме: рецептата на СМР съдържа плочите)
    const demand = (await t.admin.get(`/api/warehouse/demand?project_id=${pid}`)).data;
    const dRow = demand.find(d => d.product_id === tile.id);
    assert.ok(dRow, 'продуктът фигурира в потребността');

    // одобрение → резервации
    await t.admin.post(`/api/material-requests/${mrid}/approve`);
    let res = (await t.admin.get('/api/warehouse/reservations?status=active')).data;
    assert.equal(res.length, 1);
    assert.equal(res[0].qty, 60);
    stock = (await t.admin.get('/api/warehouse/stock')).data.find(s => s.id === tile.id);
    assert.equal(stock.free, 40, 'свободното количество намалява с резервацията');

    // изписване → складът спада, резервацията се затваря
    await t.admin.post(`/api/material-requests/${mrid}/fulfil`);
    stock = (await t.admin.get('/api/warehouse/stock')).data.find(s => s.id === tile.id);
    assert.equal(stock.on_hand, 40, '60бр. изписани от склада');
    res = (await t.admin.get('/api/warehouse/reservations?status=active')).data;
    assert.equal(res.length, 0, 'резервацията е изпълнена');
    const movements = (await t.admin.get(`/api/warehouse/movements?product_id=${tile.id}`)).data;
    assert.ok(movements.some(m => m.kind === 'issue' && m.qty === 60 && m.project_id === pid), 'изписване към обекта записано');
    // повторно действие е забранено
    assert.equal((await t.admin.post(`/api/material-requests/${mrid}/approve`)).status, 400);
  } finally { await t.stop(); }
});

test('warehouse: permissions — warehouse role writes, commercial reads only', async () => {
  const t = await start();
  try {
    const { tile } = await seedOffer(t);
    const wh = await t.mkUser('wh1', 'warehouse');
    const com = await t.mkUser('com1', 'commercial');
    assert.equal((await com.get('/api/warehouse/stock')).status, 200, 'commercial чете склада');
    assert.equal((await com.post('/api/warehouse/movements', { product_id: tile.id, kind: 'receipt', qty: 5 })).status, 403, 'commercial няма warehouse write');
    assert.equal((await wh.post('/api/warehouse/movements', { product_id: tile.id, kind: 'receipt', qty: 5 })).status, 200);
    assert.equal((await com.post('/api/material-requests', { project_id: 1, items: [{ product_id: tile.id, qty: 1 }] })).status, 403);
  } finally { await t.stop(); }
});

test('reports: catalog gated, dwell answers pending+reminders, variance/finance/attendance run', async () => {
  const t = await start();
  try {
    const { project } = await (async () => {
      const s = await seedOffer(t);
      await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
      t.sync();
      return { project: (await t.admin.get('/api/projects')).data[0], s };
    })();
    const pid = project.id;

    // задача с падеж в миналото → dwell я вижда с напомняне
    const task = await t.admin.post('/api/tasks', { project_id: pid, title: 'Забавена', due_date: '2020-01-01', assignee_dept: 'technical' });
    t.db.prepare("UPDATE tasks SET created_at = datetime('now', '-2 days') WHERE id = ?").run(task.data.id);
    const { sweepReminders } = await import('../server/reminders.js');
    sweepReminders(t.db);

    const catalog = (await t.admin.get('/api/reports')).data;
    assert.ok(catalog.length >= 5, `справки: ${catalog.map(r => r.id).join(',')}`);
    const com = await t.mkUser('rep-com', 'commercial');
    assert.equal((await com.get('/api/reports')).status, 200, 'commercial има reports read');
    const wh = await t.mkUser('rep-wh', 'warehouse');
    assert.equal((await wh.get('/api/reports')).status, 403, 'warehouse няма reports право');

    // dwell — задачата с напомняне
    const dwell = (await t.admin.get('/api/reports/dwell?entity=task')).data;
    const row = dwell.rows.find(r => r.ref === task.data.code);
    assert.ok(row, 'задачата е в dwell отчета');
    assert.ok(row.reminders >= 1, 'напомнянето е отчетено');
    assert.ok(row.age_h >= 24, 'възрастта е измерена');

    // variance — няма прогрес → нулеви работни дни, планираните от офертата са видими
    const variance = (await t.admin.get(`/api/reports/variance?project_id=${pid}`)).data;
    assert.ok(variance.rows.length >= 2, 'КС редовете присъстват');
    assert.ok(variance.sections?.length === 1, 'секция с екипи');

    // finance — парични колони
    const fin = (await t.admin.get(`/api/reports/finance?project_id=${pid}`)).data;
    assert.ok(fin.rows[0].contract_value > 0, 'договорната стойност е изчислена');
    // attendance — празна таблица, но endpoint-ът работи
    const att = (await t.admin.get('/api/reports/attendance')).data;
    assert.ok(Array.isArray(att.rows));
    // exceptions — поне нашата задача/проблеми
    const exc = (await t.admin.get('/api/reports/exceptions?min_hours=0')).data;
    assert.ok(exc.rows.length >= 1, 'exceptions не е празен');
  } finally { await t.stop(); }
});
