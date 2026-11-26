// Договорът има един източник — редовете от КС: промяна на ред преди подписване пренаписва приложенията; ако договорът вече е изпратен, Договори и Управител научават.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

test('a changed КС line rewrites the draft appendices and tells Contracts and the Manager when the contract was already sent', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    await a.post(`/api/projects/${pid}/contract/submit`, { advance_pct: 50 });
    const line = t.db.prepare('SELECT * FROM project_lines WHERE project_id = ? ORDER BY sort LIMIT 1').get(pid);
    const cr = (await a.post('/api/change-requests', { entity_type: 'project_line', entity_id: line.id, kind: 'edit', payload: { qty: 120 }, reason: 'Замерване на място' })).data;
    assert.equal((await a.post(`/api/change-requests/${cr.id}/decide`, { decision: 'approve' })).status, 200);
    const c = t.db.prepare('SELECT id FROM contracts WHERE project_id = ?').get(pid);
    const a1 = t.db.prepare('SELECT body FROM contract_appendices WHERE contract_id = ? AND number = 1 AND contract_version = 0').get(c.id).body;
    assert.match(a1, /\| 120 \|/, 'appendix 1 shows the new quantity');
    t.sync();
    const n = t.db.prepare("SELECT department FROM notifications WHERE ref_type = 'contract' AND title LIKE 'Редовете на договора%'").all().map(x => x.department).sort();
    assert.deepEqual(n, ['contracts', 'management']);
  } finally { await t.stop(); }
});
