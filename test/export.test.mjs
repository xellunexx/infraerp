import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { start } from './helpers.mjs';

const login = async (t, u) => (await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'password123' }) })).headers.get('set-cookie').split(';')[0];
const load = async (t, url, cookie) => { const r = await fetch(t.base + url, { headers: { cookie } }); const wb = new ExcelJS.Workbook(); if (r.status === 200) await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, type: r.headers.get('content-type'), disp: r.headers.get('content-disposition') }; };
const cells = ws => { const out = []; ws.eachRow(r => r.eachCell(c => out.push(c.value))); return out; };

test('Excel export: customer sheet with formulas and totals; cost sheet only for users allowed to see costs', async () => {
  const t = await start();
  try {
    const a = t.admin;
    const cust = (await a.post('/api/customers', { name: 'Клуб' })).data;
    const o = (await a.post('/api/offers', { customer_id: cust.id, title: 'Тенис корт', attention_to: 'г-н Петров' })).data;
    await a.put(`/api/offers/${o.id}`, { sections: [{ key: 's', title: 'TOUR COURT', description: 'Трипластова акрилна система' }],
      lines: [{ section: 's', description: 'Полагане на акрилна настилка', unit: 'м²', qty: 648, material_cost: 6.4, delivery_cost: 2, install_cost: 9.26 }, { section: 's', description: 'Разчертаване', unit: 'бр', qty: 1, material_cost: 830 }] });
    const x = await load(t, `/api/offers/${o.id}/export.xlsx`, await login(t, 'admin'));
    assert.equal(x.status, 200);
    assert.match(x.type, /spreadsheetml/);
    assert.match(x.disp, /Oferta_1_v1\.xlsx/);
    assert.deepEqual(x.wb.worksheets.map(w => w.name), ['Оферта', 'Калкулация']);
    const offer = cells(x.wb.getWorksheet('Оферта'));
    for (const s of ['На вниманието на:', 'г-н Петров', 'TOUR COURT', 'Полагане на акрилна настилка', 'Общо, € без ДДС:']) assert.ok(offer.includes(s), `missing ${s}`);
    assert.ok(offer.includes(24.11));
    const f = offer.filter(v => v && typeof v === 'object' && v.formula);
    assert.ok(f.some(v => /^D\d+\*E\d+$/.test(v.formula) && v.result === 15623.28), 'line total is a formula with the right result');
    assert.ok(f.some(v => /^SUM\(F\d+:F\d+\)$/.test(v.formula) && v.result === 16756.23), 'section total 15623.28 + 1132.95');
    assert.ok(!offer.includes(9.26) && !offer.includes(830), 'no cost inputs on the customer sheet');
    const costs = cells(x.wb.getWorksheet('Калкулация'));
    for (const v of [6.4, 9.26, 830, 'Марж']) assert.ok(costs.includes(v), `cost sheet missing ${v}`);

    // Technical can read offers but not finance: no cost sheet. Warehouse cannot read offers at all.
    await t.mkUser('tech', 'technical'); await t.mkUser('sklad', 'warehouse');
    const y = await load(t, `/api/offers/${o.id}/export.xlsx`, await login(t, 'tech'));
    assert.deepEqual(y.wb.worksheets.map(w => w.name), ['Оферта']);
    assert.equal((await load(t, `/api/offers/${o.id}/export.xlsx`, await login(t, 'sklad'))).status, 403);
    assert.equal((await fetch(t.base + `/api/offers/${o.id}/export.xlsx`)).status, 401);
  } finally { await t.stop(); }
});