import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

test('offer number: running number + preparer letter; next number can only move forward', async () => {
  const t = await start();
  try {
    const a = t.admin;
    const cust = (await a.post('/api/customers', { name: 'Клиент' })).data;
    // admin has no letter yet: plain running number
    assert.equal((await a.post('/api/offers', { customer_id: cust.id, title: 'A' })).data.code, '1');
    // the company is already at offer 38: continue from 39
    assert.equal((await a.put('/api/settings', { offer_next_number: 39 })).status, 200);
    assert.equal((await a.put('/api/settings', { offer_next_number: 5 })).status, 400, 'cannot go back onto used numbers');
    await a.post('/api/users', { username: 'georgi', full_name: 'Георги', role: 'commercial', password: 'password123', offer_letter: 'g', office: 'Бургас', phone: '0884445490' });
    await a.post('/api/users', { username: 'teodora', full_name: 'Теодора', role: 'commercial', password: 'password123', offer_letter: 'T' });
    assert.equal((await a.post('/api/users', { username: 'bad', full_name: 'x', role: 'commercial', password: 'password123', offer_letter: 'G1' })).status, 400);
    const g = t.client(), th = t.client();
    await g.login('georgi'); await th.login('teodora');
    const o1 = (await g.post('/api/offers', { customer_id: cust.id, title: 'Падел' })).data;
    assert.equal(o1.code, '39G');
    assert.equal((await th.post('/api/offers', { customer_id: cust.id, title: 'Площадка' })).data.code, '40T');
    assert.equal((await g.post('/api/offers', { customer_id: cust.id, title: 'Трева' })).data.code, '41G');
    // "Съставил" + phone on the offer come from the preparer's user record
    const view = (await g.get(`/api/offers/${o1.id}`)).data;
    assert.deepEqual([view.owner.full_name, view.owner.phone, view.owner.offer_letter, view.owner.office], ['Георги', '0884445490', 'G', 'Бургас']);
    assert.equal((await a.get('/api/auth/state')).data.settings.offer_last_number, '41');
    assert.equal((await a.get('/api/search?q=39G')).data.some(r => r.kind === 'offer' && r.code === '39G'), true);
  } finally { await t.stop(); }
});