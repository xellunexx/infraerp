import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

test('printable offer: customer columns and totals only, clauses, escaping, no cost breakdown, permission-checked', async () => {
  const t = await start();
  try {
    const a = t.admin;
    await a.patch('/api/users/1', { phone: '0884 445 490' });
    const cust = (await a.post('/api/customers', { name: 'Община <Тест> & син' })).data;
    const o = (await a.post('/api/offers', { customer_id: cust.id, title: 'Спортна площадка', attention_to: 'инж. Иванова', validity_months: 2 })).data;
    await a.put(`/api/offers/${o.id}`, { offer_date: '2026-11-15', validity_months: 2,
      sections: [{ key: 's', title: 'InfraSPORT 2E', description: 'Двупластова настилка <b>EPDM</b>' }, { key: 'v', title: 'Вариант', alternative: true }],
      lines: [{ section: 's', description: 'Полагане на настилка', unit: 'м²', qty: 648, material_cost: 6.4, delivery_cost: 2, install_cost: 9.26 },
        { section: 'v', description: 'Конструкция', unit: 'к-т', qty: 1, material_cost: 16400, delivery_cost: 2500, labour_days: 15, day_rate: 240 }] });
    const res = await fetch(t.base + `/api/offers/${o.id}/print`, { headers: { cookie: await cookieOf(t) } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    for (const s of ['Оферта № 1', 'инж. Иванова', 'Спортна площадка', '15.11.2026', '15.01.2027', '0884 445 490', 'InfraSPORT 2E', 'Полагане на настилка',
      '24,11', '15 623,28', '18 747,94', '30 712,50', 'Вариант — не се сумира', 'информативен характер', 'data:image/png;base64'])
      assert.ok(html.replace(/\u00a0/g, ' ').includes(s), `missing: ${s}`);
    assert.ok(html.includes('Двупластова настилка &lt;b&gt;EPDM&lt;/b&gt;'), 'text is escaped');
    assert.ok(!html.includes('<b>EPDM</b>'));
    for (const secret of ['16400', '16 400', '9,26', 'Себестойност', 'Печалба', 'Режийни']) assert.ok(!html.replace(/\u00a0/g, ' ').includes(secret), `cost data leaked: ${secret}`);
    assert.equal((await fetch(t.base + `/api/offers/${o.id}/print`)).status, 401);
    const wh = await t.mkUser('sklad', 'warehouse');
    assert.equal((await wh.get(`/api/offers/${o.id}/print`)).status, 403);
  } finally { await t.stop(); }
});
async function cookieOf(t) { const r = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'password123' }) }); return r.headers.get('set-cookie').split(';')[0]; }