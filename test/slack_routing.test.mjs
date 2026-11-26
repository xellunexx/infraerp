// Д1 (т.39): every action reaches exactly the people it affects (server/routing.js) — the project's own technician and
// brigadier instead of their whole departments, never the author, money hidden from those who may not see it, once per event.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

async function world() {
  const t = await start(), a = t.admin, db = t.db;
  const u = {};
  for (const [name, role] of [['tech', 'technical'], ['tech2', 'technical'], ['brig', 'brigadier'], ['brig2', 'brigadier'], ['acc', 'accounting'], ['acc2', 'accounting'],
    ['ctr', 'contracts'], ['lg', 'logistics'], ['wh', 'warehouse'], ['boss', 'manager'], ['com', 'commercial']]) u[name] = await t.mkUser(name, role);
  const id = name => db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  const cust = (await a.post('/api/customers', { name: 'Клуб' })).data;
  const gr = (await a.post('/api/products', { code: 'EPDM', name: 'EPDM гранули', unit: 'кг', unit_cost: 2 })).data;
  const mkProject = async title => {
    const o = (await a.post('/api/offers', { customer_id: cust.id, title })).data;
    await a.put(`/api/offers/${o.id}`, { lines: [{ description: 'Настилка', unit: 'м²', qty: 100, material_cost: 30, materials: [{ product_id: gr.id, norm_per_unit: 25 }] }] });
    await a.post(`/api/offers/${o.id}/confirm`); t.sync();
    return { pid: db.prepare('SELECT MAX(id) i FROM projects').get().i, offer: o };
  };
  const { pid } = await mkProject('Площадка');
  await a.patch(`/api/projects/${pid}`, { technical_id: id('tech'), brigadier_id: id('brig') });
  await a.post('/api/warehouse/movements', { product_id: gr.id, kind: 'receipt', qty: 5000 });
  for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 30 });
  assert.equal((await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' })).status, 200);
  t.sync();
  const mark = () => db.prepare('SELECT COALESCE(MAX(id), 0) m FROM notifications').get().m;
  const name = uid => db.prepare('SELECT username FROM users WHERE id = ?').get(uid)?.username;
  /** run an action, drain the events, return who was notified: 'dept:x' / 'user:name' */
  const who = async fn => {
    const m = mark(); const r = await fn(); t.sync();
    assert.ok(r == null || r.status === 200, `action failed: ${r?.status} ${JSON.stringify(r?.data)}`);
    const rows = db.prepare('SELECT department, user_id FROM notifications WHERE id > ?').all(m);
    return rows.map(n => n.department ? `dept:${n.department}` : `user:${name(n.user_id)}`).sort();
  };
  return { t, a, db, u, id, pid, gr, cust, mkProject, who, mark };
}

test('each action reaches exactly the people it affects', async () => {
  const w = await world(), { t, a, db, u, id, pid, gr, who } = w;
  const SITE_ALL = ['dept:accounting', 'dept:logistics', 'dept:management', 'dept:warehouse', 'user:brig', 'user:tech'];
  try {
    const stages = (await a.get(`/api/projects/${pid}/contract`)).data.payments;
    const cases = [];
    const check = async (label, fn, expected) => cases.push([label, await who(fn), [...expected].sort()]);

    await check('chat message: timeline only (Д3 adds @)', () => u.tech.post('/api/messages', { project_id: pid, body: 'Утре няма достъп' }), []);
    await check('payment plan changed after signing', () => u.acc.put(`/api/projects/${pid}/contract/payments`, { id: stages.find(p => p.kind === 'interim').id, amount: 1000 }),
      ['dept:accounting', 'dept:contracts', 'dept:management']);
    await check('contract days changed after signing', () => u.ctr.patch(`/api/projects/${pid}/contract`, { install_days: 40 }), SITE_ALL);
    await check('advance paid: the contract clock starts', () => u.acc.post(`/api/projects/${pid}/payments`, { contract_payment_id: stages.find(p => p.kind === 'advance').id, amount: stages.find(p => p.kind === 'advance').gross, tx_date: '2026-11-20' }),
      ['dept:contracts', 'dept:logistics', 'dept:management', 'dept:warehouse', 'user:brig', 'user:tech']);
    const tx = db.prepare("SELECT id FROM transactions WHERE status = 'paid' ORDER BY id DESC").get().id;
    await check('a paid payment corrected', () => u.acc.patch(`/api/transactions/${tx}`, { note: 'поправка', amount: 100 }), ['dept:contracts', 'dept:management']);
    await check('site address changed', () => u.ctr.patch(`/api/projects/${pid}`, { site_address: 'Пловдив, ул. Нова 5' }), ['dept:logistics', 'user:brig', 'user:tech']);
    const task = (await a.post('/api/tasks', { project_id: pid, title: 'Провери', assignee_dept: 'technical' })).data; t.sync();
    await check('task done: the one who gave it', () => u.tech.post(`/api/tasks/${task.id}/done`), ['user:admin']);
    await check('task reopened: the assignee (the project technician)', () => a.post(`/api/tasks/${task.id}/reopen`), ['user:tech']);
    const mr = (await u.tech.post(`/api/projects/${pid}/material-requests`, { items: [{ product_id: gr.id, qty: 100 }] })).data; t.sync();
    await check('material request approved: requester, site, logistics', () => u.wh.post(`/api/material-requests/${mr.id}/approve`), ['dept:logistics', 'user:brig', 'user:tech']);
    let van;
    await check('new equipment: the Technical department', async () => { const r = await u.lg.post('/api/assets', { name: 'Фургон', kind: 'vehicle', plate: 'CB 1 AB' }); van = r.data; return r; }, ['dept:technical']);
    const al = (await u.lg.post('/api/asset-allocations', { asset_id: van.id, project_id: pid, date_from: '2026-12-01', date_to: '2026-12-10' })).data; t.sync();
    await check('equipment status changed while booked: logistics + that site', () => u.lg.patch(`/api/assets/${van.id}`, { status: 'maintenance' }), ['dept:logistics', 'user:brig', 'user:tech']);
    await check('allocation moved', () => u.lg.patch(`/api/asset-allocations/${al.id}`, { date_to: '2026-12-12' }), ['dept:logistics', 'user:brig', 'user:tech']);
    const dl = (await u.lg.post('/api/deliveries', { project_id: pid, items: [{ product_id: gr.id, qty: 1 }] })).data; t.sync();
    await check('delivery date moved', () => u.lg.patch(`/api/deliveries/${dl.id}`, { planned_date: '2026-12-03' }), ['dept:warehouse', 'user:brig', 'user:tech']);
    // the author's own department keeps its row (only the author is hidden, on read)
    await check('supplier order created: + warehouse', () => u.lg.post('/api/supplier-orders', { project_id: pid, supplier: 'VINCI PLAY', total_eur: 1200, advance_eur: 600, prod_days: 30, transport_days: 7 }),
      ['dept:accounting', 'dept:logistics', 'dept:warehouse']);
    const soId = db.prepare('SELECT MAX(id) i FROM supplier_orders').get().i;
    await check('supplier order changed', () => u.lg.patch(`/api/supplier-orders/${soId}`, { prod_days: 40 }), ['dept:accounting', 'dept:logistics', 'dept:warehouse']);
    const iss = (await u.brig.post('/api/issues', { project_id: pid, kind: 'problem', severity: 'high', title: 'Липсва достъп', assigned_dept: 'technical' })).data; t.sync();
    await check('issue given to another department: that department + the reporter', () => u.tech.patch(`/api/issues/${iss.id}`, { assigned_dept: 'logistics' }), ['dept:logistics', 'user:brig']);
    await check('settings changed: the Manager knows', () => a.put('/api/settings', { company_name: 'СИНХРО' }), ['dept:management']);
    const draft = (await u.com.post('/api/offers', { customer_id: w.cust.id, title: 'Нова площадка' })).data;
    await u.com.put(`/api/offers/${draft.id}`, { lines: [{ description: 'Настилка', unit: 'м²', qty: 10, material_cost: 30 }] }); t.sync();
    await check('offer sent: the Manager knows', () => u.com.post(`/api/offers/${draft.id}/send`), ['dept:management']);
    await check('project archived', () => u.ctr.post(`/api/projects/${pid}/archive`, { archived: true }), SITE_ALL);
    await check('project back from the archive', () => u.ctr.post(`/api/projects/${pid}/archive`, { archived: false }), SITE_ALL);

    const bad = cases.filter(([, got, exp]) => JSON.stringify(got) !== JSON.stringify(exp));
    assert.deepEqual(bad.map(([l, got, exp]) => ({ l, got, exp })), []);
    // a chat message is in the project timeline
    assert.ok((await a.get(`/api/projects/${pid}/timeline`)).data.some(e => e.type === 'message.created'), 'timeline has the message');
  } finally { await t.stop(); }
});

test('the author is not told; the replaced brigadier is; money stays hidden; one notice per event', async () => {
  const w = await world(), { t, a, db, u, id, pid } = w;
  try {
    // own action: the accounting author does not see the notice his department got; a colleague does
    const stages = (await a.get(`/api/projects/${pid}/contract`)).data.payments;
    await u.acc.put(`/api/projects/${pid}/contract/payments`, { id: stages.find(p => p.kind === 'interim').id, amount: 1111 }); t.sync();
    const plan = n => n.title.startsWith('Променен етап от графика за плащане');
    assert.equal((await u.acc.get('/api/notifications')).data.filter(plan).length, 0, 'author not told');
    assert.equal((await u.acc2.get('/api/notifications')).data.filter(plan).length, 1, 'colleague told');
    // the project's technician gets it, another technician of the department does not
    await u.ctr.patch(`/api/projects/${pid}`, { access_notes: 'Вход от север' }); t.sync();
    const site = n => n.title.startsWith('Променени данни на обекта');
    assert.equal((await u.tech.get('/api/notifications')).data.filter(site).length, 1, 'project technician told');
    assert.equal((await u.tech2.get('/api/notifications')).data.filter(site).length, 0, 'other technicians not pinged');
    // a project without a technician: the whole department
    const { pid: p2 } = await w.mkProject('Без техник');
    await u.ctr.patch(`/api/projects/${p2}`, { access_notes: 'Портал' }); t.sync();
    assert.ok(db.prepare("SELECT 1 FROM notifications WHERE project_id = ? AND department = 'technical' AND title LIKE 'Променени данни%'").get(p2), 'department when nobody is assigned');
    // the replaced brigadier sees the change although he lost the project
    await a.patch(`/api/projects/${pid}`, { brigadier_id: id('brig2') }); t.sync();
    assert.ok((await u.brig.get('/api/notifications')).data.some(n => /Смяна/.test(n.title)), 'replaced brigadier is told');
    // money: the plan amount reaches Accounting, never the brigadier's text
    const acco = (await u.acc.post('/api/accommodations', { project_id: pid, place: 'Хотел', address: 'София', date_from: '2026-12-01', date_to: '2026-12-10', beds: 4, cost_per_night: 60, payment_method: 'invoice', workers: '4' })).data; t.sync();
    await u.acc.patch(`/api/accommodations/${acco.id}`, { cost_per_night: 987 }); t.sync();
    const brigNote = (await u.brig2.get('/api/notifications')).data.find(n => n.title.startsWith('Променено настаняване'));
    assert.ok(brigNote, 'brigadier told about the accommodation');
    assert.ok(!/987/.test(brigNote.body), `no price for the brigadier: ${brigNote.body}`);
    // one notice per person / department per event, across everything above
    assert.deepEqual(db.prepare(`SELECT event_id, COALESCE(department, 'u' || user_id) k, COUNT(*) n FROM notifications WHERE event_id IS NOT NULL GROUP BY event_id, k HAVING n > 1`).all(), []);
  } finally { await t.stop(); }
});
