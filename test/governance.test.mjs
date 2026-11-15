// Управление: заявки за промяна (редакция/изтриване → админ решение), admin-only настройки,
// per-user module overrides, автоматични напомняния >12h с история в reminders_log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { sweepReminders } from '../server/reminders.js';

test('change requests: non-admin files edit, only admin decides, change applies atomically', async () => {
  const t = await start();
  try {
    const { cust } = await seedOffer(t);
    const u = await t.mkUser('req1', 'commercial');

    const cr = await u.post('/api/change-requests', { entity_type: 'customer', entity_id: cust.id, kind: 'edit',
      payload: { phone: '0888999777', notes: 'променено' }, reason: 'Грешен телефон в клиентската карта' });
    assert.equal(cr.status, 200, JSON.stringify(cr.data));
    assert.match(cr.data.code, /^CRQ-/);

    // нищо не се променя, преди админът да реши
    const before = (await t.admin.get('/api/customers')).data.find(c => c.id === cust.id);
    assert.equal(before.phone, '0888');

    // не-админ няма достъп до опашката и до вземането на решение
    assert.equal((await u.get('/api/change-requests?scope=queue')).status, 403);
    assert.equal((await u.post(`/api/change-requests/${cr.data.id}/decide`, { decision: 'approve' })).status, 403);

    // заявителят вижда собствената заявка
    const mine = (await u.get('/api/change-requests?scope=mine')).data;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'pending');

    // админ вижда опашката и одобрява → промяната се прилага
    const queue = (await t.admin.get('/api/change-requests?scope=queue')).data;
    assert.equal(queue.length, 1);
    const dec = await t.admin.post(`/api/change-requests/${cr.data.id}/decide`, { decision: 'approve', note: 'ок' });
    assert.equal(dec.status, 200);
    const after = (await t.admin.get('/api/customers')).data.find(c => c.id === cust.id);
    assert.equal(after.phone, '0888999777');
    assert.equal(after.notes, 'променено');

    const done = (await t.admin.get(`/api/change-requests/${cr.data.id}`)).data;
    assert.equal(done.status, 'approved');
    assert.ok(done.applied_at, 'applied_at записан');
    assert.equal(done.decider_name, 'Админ');
    // одит следа: заявка + прилагане + решение
    const auditRows = t.db.prepare("SELECT action FROM audit_log WHERE entity_type = 'change_request' ORDER BY id").all().map(r => r.action);
    assert.deepEqual(auditRows, ['request', 'applied', 'approve']);
    // повторно решение е отказано
    assert.equal((await t.admin.post(`/api/change-requests/${cr.data.id}/decide`, { decision: 'reject' })).status, 400);
  } finally { await t.stop(); }
});

test('change requests: reject leaves record untouched; delete removes it; flag-only closes manually', async () => {
  const t = await start();
  try {
    const { tile } = await seedOffer(t);
    const u = await t.mkUser('req2', 'technical');

    // отхвърляне
    const rej = await u.post('/api/change-requests', { entity_type: 'product', entity_id: tile.id, kind: 'edit', payload: { unit_price: 999 }, reason: 'тест отхвърляне' });
    await t.admin.post(`/api/change-requests/${rej.data.id}/decide`, { decision: 'reject', note: 'не е основателно' });
    const p1 = (await t.admin.get('/api/products')).data.find(p => p.id === tile.id);
    assert.equal(p1.unit_price, 30, 'отказаната заявка не пипа записа');
    assert.equal((await t.admin.get(`/api/change-requests/${rej.data.id}`)).data.status, 'rejected');

    // изтриване — нов продукт без връзки (seed-натият е рефериран от рецептата → FK го пази, което е правилно)
    const extra = await t.admin.post('/api/products', { code: 'M-999', name: 'Временен продукт', unit: 'бр' });
    const del = await u.post('/api/change-requests', { entity_type: 'product', entity_id: extra.data.id, kind: 'delete', reason: 'дублиран продукт' });
    assert.equal(del.status, 200);
    await t.admin.post(`/api/change-requests/${del.data.id}/decide`, { decision: 'approve' });
    assert.equal((await t.admin.get('/api/products')).data.find(p => p.id === extra.data.id), undefined, 'продуктът е изтрит');
    // рефериран запис не може да се изтрие — заявката остава pending с грешка
    const blocked = await u.post('/api/change-requests', { entity_type: 'product', entity_id: tile.id, kind: 'delete', reason: 'опит за изтриване на използван' });
    const bd = await t.admin.post(`/api/change-requests/${blocked.data.id}/decide`, { decision: 'approve' });
    assert.equal(bd.status, 400, 'FK защитата отхвърля изтриването');
    assert.equal((await t.admin.get(`/api/change-requests/${blocked.data.id}`)).data.status, 'pending', 'заявката остава за преглед');

    // само сигнализация (без payload) — админът затваря ръчно
    const flag = await u.post('/api/change-requests', { entity_type: 'customer', entity_id: (await t.admin.get('/api/customers')).data[0].id, kind: 'edit', reason: 'описание грешно, оправете го' });
    assert.equal(flag.status, 200);
    await t.admin.post(`/api/change-requests/${flag.data.id}/decide`, { decision: 'approve' });
    const fd = (await t.admin.get(`/api/change-requests/${flag.data.id}`)).data;
    assert.equal(fd.status, 'approved');
    assert.equal(fd.result.applied, 'manual', 'без payload → ръчно затваряне');
  } finally { await t.stop(); }
});

test('change requests: validation — unknown entity/col, missing reason, non-admin queue', async () => {
  const t = await start();
  try {
    const { cust } = await seedOffer(t);
    const u = await t.mkUser('req3', 'commercial');
    assert.equal((await u.post('/api/change-requests', { entity_type: 'nope', entity_id: 1, kind: 'edit', reason: 'x' })).status, 400);
    assert.equal((await u.post('/api/change-requests', { entity_type: 'customer', entity_id: cust.id, kind: 'edit', payload: { role: 'admin' }, reason: 'x' })).status, 400, 'колона извън бял списък');
    assert.equal((await u.post('/api/change-requests', { entity_type: 'customer', entity_id: cust.id, kind: 'edit', payload: { phone: '1' }, reason: ' ' })).status, 400, 'празна причина');
    assert.equal((await u.post('/api/change-requests', { entity_type: 'customer', entity_id: 99999, kind: 'edit', reason: 'x' })).status, 404);
    // meta достъпна за всеки логнат потребител
    const meta = (await u.get('/api/change-requests/meta')).data;
    assert.ok(meta.length >= 15, `registry покрива записи: ${meta.length}`);
    assert.ok(meta.some(m => m.type === 'project_line'), 'КС ред е в регистъра');
  } finally { await t.stop(); }
});

test('admin gate: users/permissions/settings only for admin role', async () => {
  const t = await start();
  try {
    const mgr = await t.mkUser('mgr-gate', 'manager');
    const com = await t.mkUser('com-gate', 'commercial');
    // manager преди имаше users:'r' + settings:'r' — сега всички мутации са admin-only
    assert.equal((await mgr.post('/api/users', { username: 'x1', full_name: 'X', role: 'technical', password: 'password123' })).status, 403);
    assert.equal((await mgr.patch('/api/users/1', { full_name: 'Hacked' })).status, 403);
    assert.equal((await mgr.get('/api/permissions')).status, 403, 'permissions вече не е четим за manager');
    assert.equal((await mgr.put('/api/permissions', { rows: [] })).status, 403);
    assert.equal((await mgr.put('/api/settings', { company_name: 'X' })).status, 403);
    assert.equal((await com.put('/api/settings', { company_name: 'X' })).status, 403);
    // админът работи
    assert.equal((await t.admin.get('/api/permissions')).status, 200);
    assert.equal((await t.admin.put('/api/settings', { company_name: 'Тест' })).status, 200);
    // директорията с потребители остава четима (използва се от падащи менюта)
    assert.equal((await com.get('/api/users')).status, 200);
  } finally { await t.stop(); }
});

test('user overrides: per-module visibility limits enforced server-side, persist across requests', async () => {
  const t = await start();
  try {
    const tech = await t.mkUser('lim1', 'technical');
    const uid = (await t.admin.get('/api/users')).data.find(u => u.username === 'lim1').id;
    // technical има logistics rw по подразбиране → преди ограничението трябва да работи
    assert.equal((await tech.get('/api/deliveries')).status, 200, 'преди: logistics четим');

    const put = await t.admin.put(`/api/users/${uid}/overrides`, { rows: [
      { resource: 'logistics', can_read: 0, can_write: 0, can_approve: 0 },
      { resource: 'projects', can_read: 1, can_write: 0, can_approve: 0 }] });
    assert.equal(put.status, 200);

    // caps: нови заявки ползват променените права веднага (per-request зареждане)
    assert.equal((await tech.get('/api/deliveries')).status, 403, 'logistics скрит → 403');
    assert.equal((await tech.post('/api/deliveries', { project_id: 1 })).status, 403);
    assert.equal((await tech.get('/api/projects')).status, 200, 'projects четим');
    assert.equal((await tech.patch('/api/projects/1', { name: 'x' })).status, 403, 'projects запис забранен');

    // не-админ не може да пипа overrides; админ не може да ограничава админ
    assert.equal((await tech.put(`/api/users/${uid}/overrides`, { rows: [] })).status, 403);
    const adminId = (await t.admin.get('/api/users')).data.find(u => u.username === 'admin').id;
    assert.equal((await t.admin.put(`/api/users/${adminId}/overrides`, { rows: [{ resource: 'settings', can_read: 0 }] })).status, 400);

    // махане на ограничението → правата се връщат към ролята
    await t.admin.put(`/api/users/${uid}/overrides`, { rows: [] });
    assert.equal((await tech.get('/api/deliveries')).status, 200, 'след изчистване → ролята пак управлява');
  } finally { await t.stop(); }
});

test('reminders: >12h pending cases notify once per day and log for reports', async () => {
  const t = await start();
  try {
    // отворена задача с падеж в миналото и създадена преди >12h
    const task = await t.admin.post('/api/tasks', { title: 'Стара задача', due_date: '2020-01-01', assignee_dept: 'technical' });
    assert.equal(task.status, 200);
    const tid = task.data.id;
    t.db.prepare("UPDATE tasks SET created_at = datetime('now', '-2 days') WHERE id = ?").run(tid);

    const sent1 = sweepReminders(t.db);
    assert.ok(sent1.some(s => s.kind === 'task_open' && s.id === tid), 'задачата генерира напомняне');
    const logs1 = t.db.prepare("SELECT * FROM reminders_log WHERE entity_type = 'task' AND entity_id = ?").all(tid);
    assert.equal(logs1.length, 1, 'reminders_log записан');
    const notif = t.db.prepare("SELECT * FROM notifications WHERE title LIKE '⏰%'").all();
    assert.ok(notif.length >= 1, 'известие е създадено');

    // втората sweep в същия ден не дублира
    const sent2 = sweepReminders(t.db);
    assert.ok(!sent2.some(s => s.kind === 'task_open' && s.id === tid), 'дедупликация по bucket');
    assert.equal(t.db.prepare("SELECT COUNT(*) n FROM reminders_log WHERE entity_type = 'task' AND entity_id = ?").get(tid).n, 1);

    // щом случаят излезе от чакащо състояние → не се напомня more
    await t.admin.post(`/api/tasks/${tid}/done`);
    t.db.prepare("UPDATE reminders_log SET bucket = bucket - 1 WHERE entity_type = 'task' AND entity_id = ?").run(tid); // симулирай нов ден
    const sent3 = sweepReminders(t.db);
    assert.ok(!sent3.some(s => s.kind === 'task_open' && s.id === tid), 'завършената задача не се напомня');
  } finally { await t.stop(); }
});
