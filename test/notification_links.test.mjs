// Известието води до самия запис (страница + таб), не до началото на модула — иначе записът „изчезва“.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { recordLink } from '../server/links.js';

test('record links: each kind of record opens on its own tab', () => {
  assert.equal(recordLink('payment_request', 7, 3), '/accounting?tab=requests&focus=7');
  assert.equal(recordLink('proforma', 2, 3), '/accounting?tab=proformas&focus=2');
  assert.equal(recordLink('document', 5, 3), '/projects/3?tab=docs');
  assert.equal(recordLink('document', 5, 3, 'brigadier'), '/brigade/3?tab=docs&focus=5');
  assert.equal(recordLink('material_request', 9, 3), '/warehouse?tab=requests&focus=9');
  assert.equal(recordLink('delivery', 4, 3), '/logistics?tab=deliveries&pid=3&focus=4');
  assert.equal(recordLink('issue', 2, 3, 'brigadier'), '/brigade/3?tab=issues&focus=2');
  assert.equal(recordLink('schedule_item', 6, 3), '/technical/3?tab=schedule&focus=6');
  assert.equal(recordLink('contract', 1, 3), '/projects/3?tab=contract');
  assert.equal(recordLink('document', 5, null), null, 'no project, no project tab');
  assert.equal(recordLink('something_else', 1, 3), null, 'unknown kinds keep the link the handler gave');
});

test('a payment-request notification opens the request, also for notifications written before', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const mgr = await t.mkUser('mgr', 'manager');
    const req = (await t.admin.post('/api/payment-requests', { project_id: pid, category: 'труд', amount: 1200, payee: 'Марин' })).data;
    t.sync();
    const n = (await mgr.get('/api/notifications')).data.find(x => x.ref_type === 'payment_request' && x.ref_id === req.id);
    assert.ok(n, 'management is notified');
    assert.equal(n.link, `/accounting?tab=requests&focus=${req.id}`);
    const q = (await mgr.get('/api/management')).data;
    const a = (q.approvals || []).find(x => x.type === 'payment_request.created');
    if (a) assert.equal(a.link, `/accounting?tab=requests&focus=${req.id}`, 'the management queue opens it too');
  } finally { await t.stop(); }
});
