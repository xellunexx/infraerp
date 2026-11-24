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

test('warehouse: project transfer writes the pair — on_site shifts, warehouse stock untouched', async () => {
  const t = await start();
  try {
    const mkProject = async () => {
      const s = await seedOffer(t);
      await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
      t.sync();
      const list = (await t.admin.get('/api/projects')).data;
      return list[0].id;
    };
    const pidA = await mkProject(), pidB = await mkProject();
    const tile = (await t.admin.get('/api/warehouse/stock')).data[0];
    await t.admin.post('/api/warehouse/movements', { product_id: tile.id, kind: 'receipt', qty: 100 });
    await t.admin.post('/api/warehouse/movements', { product_id: tile.id, kind: 'issue', qty: 60, project_id: pidA });

    // валидации
    assert.equal((await t.admin.post('/api/warehouse/movements', { product_id: tile.id, kind: 'transfer_out', qty: 5, project_id: pidA })).status, 400, 'без целеви обект');
    assert.equal((await t.admin.post('/api/warehouse/movements', { product_id: tile.id, kind: 'transfer_out', qty: 5, project_id: pidA, to_project_id: pidA })).status, 400, 'към същия обект');

    const tr = await t.admin.post('/api/warehouse/movements', { product_id: tile.id, kind: 'transfer_out', qty: 20, project_id: pidA, to_project_id: pidB, note: 'пренос' });
    assert.equal(tr.status, 200, JSON.stringify(tr.data));

    const stock = (await t.admin.get('/api/warehouse/stock')).data.find(s => s.id === tile.id);
    assert.equal(stock.on_hand, 40, 'складовото количество не се променя от преноса');
    const consA = (await t.admin.get(`/api/warehouse/demand?project_id=${pidA}`)).data.find(d => d.product_id === tile.id);
    const consB = (await t.admin.get(`/api/warehouse/demand?project_id=${pidB}`)).data.find(d => d.product_id === tile.id);
    assert.equal(consA.issued, 40, 'на А остават 40 на обекта');
    assert.equal(consB.issued, 20, 'на Б пристигат 20');
    const moves = (await t.admin.get(`/api/warehouse/movements?product_id=${tile.id}`)).data;
    assert.ok(moves.some(m => m.kind === 'transfer_out' && m.project_id === pidA && m.to_project_id === pidB));
    assert.ok(moves.some(m => m.kind === 'transfer_in' && m.project_id === pidB && m.to_project_id === pidA));
  } finally { await t.stop(); }
});

test('warehouse: request items carry the СМР line into the issue movement', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t);
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
    t.sync();
    const project = (await t.admin.get('/api/projects')).data[0];
    const line = (await t.admin.get(`/api/projects/${project.id}`)).data.lines.find(l => l.smr_type_id);
    await t.admin.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'receipt', qty: 50 });
    const mr = await t.admin.post('/api/material-requests', { project_id: project.id,
      items: [{ product_id: s.tile.id, qty: 10, project_line_id: line.id }] });
    assert.equal(mr.status, 200, JSON.stringify(mr.data));
    await t.admin.post(`/api/material-requests/${mr.data.id}/approve`);
    await t.admin.post(`/api/material-requests/${mr.data.id}/fulfil`);
    const moves = (await t.admin.get(`/api/warehouse/movements?product_id=${s.tile.id}`)).data;
    const issue = moves.find(m => m.kind === 'issue');
    assert.equal(issue.project_line_id, line.id, 'изписването носи КС реда от заявката');
  } finally { await t.stop(); }
});

test('warehouse: module-origin request — technical files it from the project, lands in the queue', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t);
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
    t.sync();
    const project = (await t.admin.get('/api/projects')).data[0];
    const tech = await t.mkUser('tech1', 'technical');
    const acc = await t.mkUser('acc1', 'accounting');

    const r = await tech.post(`/api/projects/${project.id}/material-requests`, { needed_by: '2026-12-10',
      items: [{ product_id: s.tile.id, qty: 15 }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.origin, 'technical');
    const queue = (await t.admin.get('/api/material-requests')).data;
    assert.ok(queue.some(m => m.id === r.data.id && m.status === 'submitted'), 'заявката влиза в складовата опашка');

    assert.equal((await acc.post(`/api/projects/${project.id}/material-requests`, { items: [{ product_id: s.tile.id, qty: 1 }] })).status, 403,
      'счетоводството не подава заявки');
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

test('warehouse: gates — issue/return need a project, transfer cannot exceed on-site, request line must be of the project', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t);
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
    t.sync();
    const project = (await t.admin.get('/api/projects')).data[0];
    const s2 = await seedOffer(t);
    await t.admin.post(`/api/offers/${s2.offer.id}/confirm`);
    t.sync();
    const pidB = (await t.admin.get('/api/projects')).data[0].id;
    const lineA = (await t.admin.get(`/api/projects/${project.id}`)).data.lines.find(l => l.smr_type_id);

    assert.equal((await t.admin.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'issue', qty: 5 })).status, 400, 'изписване без обект');
    assert.equal((await t.admin.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'return', qty: 5 })).status, 400, 'връщане без обект');
    assert.equal((await t.admin.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'issue', qty: 5, project_id: project.id })).status, 200);
    assert.equal((await t.admin.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'transfer_out', qty: 6, project_id: project.id, to_project_id: pidB })).status, 400, 'пренос над наличното на обекта');

    const mr = await t.admin.post('/api/material-requests', { project_id: pidB, items: [{ product_id: s.tile.id, qty: 1, project_line_id: lineA.id }] });
    assert.equal(mr.status, 400, 'ред от чужд обект в заявка');
  } finally { await t.stop(); }
});

test('warehouse: approve snapshots to_purchase; module feed shows pending; notifications reach warehouse + requester', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t);
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
    t.sync();
    const project = (await t.admin.get('/api/projects')).data[0];
    const tech = await t.mkUser('tech1', 'technical');
    const wh = await t.mkUser('wh1', 'warehouse');
    await t.admin.post('/api/warehouse/movements', { product_id: s.tile.id, kind: 'receipt', qty: 3 });

    const mr = await tech.post(`/api/projects/${project.id}/material-requests`, { items: [{ product_id: s.tile.id, qty: 10 }] });
    assert.equal(mr.status, 200);
    t.sync();
    assert.ok((await wh.get('/api/notifications')).data.some(n => n.title.includes(mr.data.code)), 'складът чува за заявката');

    const feed = (await tech.get(`/api/projects/${project.id}/material-requests`)).data;
    assert.ok(feed.some(m => m.id === mr.data.id && m.items[0].qty === 10), 'модулският списък показва висящата заявка');
    const brig = await t.mkUser('brig1', 'brigadier');
    assert.equal((await brig.get(`/api/projects/${project.id}/material-requests`)).status, 403, 'бригадир без възложен обект не вижда заявките му');

    await t.admin.post(`/api/material-requests/${mr.data.id}/approve`);
    const item = (await t.admin.get('/api/material-requests')).data.find(m => m.id === mr.data.id).items[0];
    assert.equal(item.to_purchase_qty, 7, 'за покупка = 10 заявени − 3 налични при одобрение');
    await t.admin.post(`/api/material-requests/${mr.data.id}/fulfil`);
    t.sync();
    assert.ok((await tech.get('/api/notifications')).data.some(n => n.title.includes(mr.data.code) && n.title.includes('изпълнена')), 'заявителят чува изхода');
  } finally { await t.stop(); }
});
