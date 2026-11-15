import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

test('offer template: cost breakdown, sections, alternatives, header fields, revision copy, confirmation of a chosen variant', async () => {
  const t = await start();
  try {
    const a = t.admin;
    const cust = (await a.post('/api/customers', { name: 'Община Тест' })).data;
    const offer = (await a.post('/api/offers', { customer_id: cust.id, title: 'Падел корт', attention_to: 'инж. Петров', validity_months: 2 })).data;
    const body = {
      attention_to: 'инж. Петров', offer_date: '2026-11-15', validity_months: 2,
      sections: [
        { key: 'base', title: 'Подготовка', description: 'Обща част' },
        { key: 'v1', title: 'Вариант 1', description: 'Супер панорамен корт', alternative: true, footer: 'Допълнителни опции' },
        { key: 'v2', title: 'Вариант 2', description: 'Корт с регулиране на височината', alternative: true },
      ],
      lines: [
        { section: 'base', description: 'Разчертаване', unit: 'бр', qty: 1, material_cost: 830 },
        { section: 'v1', description: 'Конструкция Steel Vision', unit: 'к-т', qty: 1, material_cost: 16400, delivery_cost: 2500, labour_days: 15, day_rate: 240 },
        { section: 'v2', description: 'Конструкция Steel Vision', unit: 'к-т', qty: 1, material_cost: 13680, delivery_cost: 2500, labour_days: 15, day_rate: 240 },
        { description: 'Плочи Inno PRO', unit: 'м²', qty: 400, unit_price: 22.75, unit_cost: 15 },
      ],
    };
    const saved = await a.put(`/api/offers/${offer.id}`, body);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const v = saved.data.versions[0];
    assert.equal(v.sections.length, 3);
    assert.equal(v.attention_to, 'инж. Петров');
    assert.equal(v.totals.valid_until, '2027-01-15');
    const byDesc = d => v.lines.filter(l => l.description === d);
    // 830 -> O=830, P=29.05, T=249, V=24.9 -> 1132.95
    assert.equal(byDesc('Разчертаване')[0].unit_price, 1132.95);
    assert.equal(byDesc('Конструкция Steel Vision')[0].unit_price, 30712.5);
    // 13680+2500+3600=19780 -> P=692.3, T=5934, V=593.4 -> 26999.7
    assert.equal(byDesc('Конструкция Steel Vision')[1].unit_price, 26999.7);
    assert.equal(byDesc('Плочи Inno PRO')[0].manual_price, 22.75);
    assert.equal(byDesc('Плочи Inno PRO')[0].unit_cost, 15);
    // alternatives are not in the offer total: 1132.95 + 400 x 22.75
    assert.equal(v.totals.net, 10232.95);
    assert.deepEqual(v.totals.sections.map(s => s.net), [1132.95, 30712.5, 26999.7]);
    assert.equal((await a.put(`/api/offers/${offer.id}`, { lines: [{ section: 'nope', description: 'x', unit: 'бр', qty: 1, unit_price: 1 }] })).status, 400);

    // a revision carries sections, breakdown and header over
    await a.post(`/api/offers/${offer.id}/send`);
    const rev = (await a.post(`/api/offers/${offer.id}/revise`, { reason: 'нова цена' })).data;
    const v2 = rev.versions[1];
    assert.equal(v2.sections.length, 3);
    assert.equal(v2.lines.length, 4);
    assert.equal(v2.lines.find(l => l.material_cost === 13680).labour_days, 15);
    assert.equal(v2.attention_to, 'инж. Петров');
    assert.equal(v2.totals.net, 10232.95);

    // confirming needs a chosen variant; only its lines become the contract scope
    assert.equal((await a.post(`/api/offers/${offer.id}/confirm`)).status, 400);
    const chosen = v2.sections.find(s => s.title === 'Вариант 2').id;
    assert.equal((await a.post(`/api/offers/${offer.id}/confirm`, { sections: [chosen] })).status, 200);
    t.sync();
    const p = (await a.get('/api/projects/1')).data;
    assert.equal(p.lines.length, 3);
    assert.equal(p.finance.contract_value, 37232.65);   // 1132.95 + 26999.70 + 9100.00
    assert.equal(p.finance.offer_value, 37232.65);
    assert.equal(p.lines.some(l => l.unit_price === 30712.5), false, 'the variant that was not chosen is not in the project');
  } finally { await t.stop(); }
});