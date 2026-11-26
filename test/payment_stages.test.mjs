// Т.7: разплащателният график има колкото етапа трябва (аванс, междинно №1, №2…, окончателно), задава се с договора
// и след подписване етапи не се добавят/махат. Плащане по междинно №2 не се брои за №1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { openDb } from '../server/db.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

test('a contract can have several interim payments, each counted on its own', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;   // value 6200 net
    const put = b => a.put(`/api/projects/${pid}/contract/payments`, b);
    assert.equal((await put({ kind: 'advance', amount: 1860 })).status, 200);
    const i1 = await put({ kind: 'interim', amount: 1500, label: 'Междинно №1 — след основата', due_note: 'след полагане на основата' });
    assert.equal(i1.status, 200, JSON.stringify(i1.data));
    const i2 = await put({ kind: 'interim', amount: 1500, due_on: '2026-12-15' });
    assert.equal(i2.status, 200);
    let c = (await a.get(`/api/projects/${pid}/contract`)).data;
    assert.deepEqual(c.payments.map(p => [p.kind, p.seq, p.label]), [['advance', 1, 'Аванс'], ['interim', 1, 'Междинно №1 — след основата'], ['interim', 2, 'Междинно плащане №2'], ['final', 1, 'Окончателно плащане']].slice(0, c.payments.length));
    for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 30 });
    assert.equal((await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' })).status, 200); t.sync();
    c = (await a.get(`/api/projects/${pid}/contract`)).data;
    assert.deepEqual(c.payments.map(p => [p.kind, p.seq, p.net]), [['advance', 1, 1860], ['interim', 1, 1500], ['interim', 2, 1500], ['final', 1, 1340]]);
    assert.equal(c.payments[2].due_on, '2026-12-15');
    assert.equal((await put({ kind: 'interim', amount: 100 })).status, 400, 'no new stage after signing (annex)');
    const m2 = c.payments[2];
    const pr = await a.post(`/api/projects/${pid}/payments`, { contract_payment_id: m2.id, amount: m2.gross, tx_date: '2026-11-25' }); assert.equal(pr.status, 200, JSON.stringify(pr.data));
    c = (await a.get(`/api/projects/${pid}/contract`)).data;
    assert.deepEqual([c.payments[1].paid, c.payments[2].paid, !!c.payments[2].paid_at], [0, m2.gross, true], 'interim №2 paid, №1 untouched');
  } finally { await t.stop(); }
});

test('existing databases keep their payment plans when the table learns about stages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-')), f = path.join(dir, 'old.db');
  const old = new DatabaseSync(f);
  old.exec(`CREATE TABLE contracts (id INTEGER PRIMARY KEY);
    CREATE TABLE contract_payments (id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id), kind TEXT NOT NULL,
    pct REAL, amount REAL, paid_at TEXT, note TEXT, vat_pct REAL, gross REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (contract_id, kind));
    INSERT INTO contracts(id) VALUES (7); INSERT INTO contract_payments(id, contract_id, kind, amount) VALUES (41, 7, 'advance', 100), (42, 7, 'interim', 50);`);
  old.close();
  const db = openDb(f);
  assert.deepEqual(db.prepare('SELECT id, kind, seq, amount FROM contract_payments ORDER BY id').all().map(r => ({ ...r })), [{ id: 41, kind: 'advance', seq: 1, amount: 100 }, { id: 42, kind: 'interim', seq: 1, amount: 50 }]);
  db.prepare("INSERT INTO contract_payments(contract_id, kind, seq, amount) VALUES (7, 'interim', 2, 30)").run();
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
