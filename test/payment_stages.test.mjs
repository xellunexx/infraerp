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

test('an interim stage is removed only before signing, only when nothing was paid on it; advance/final never', async () => {
  const t = await start();
  try {
    const a = t.admin, s = await seedOffer(t); await a.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT MAX(id) i FROM projects').get().i;
    const put = b => a.put(`/api/projects/${pid}/contract/payments`, b), stages = async () => (await a.get(`/api/projects/${pid}/contract`)).data.payments;
    await put({ kind: 'advance', amount: 1860 });
    await put({ kind: 'interim', amount: 1500 });
    const added = await put({ kind: 'interim' });                     // the screen's "+" adds an empty stage №2
    assert.equal(added.status, 200, JSON.stringify(added.data));
    let ps = await stages();
    const i2 = ps.find(p => p.kind === 'interim' && p.seq === 2);
    assert.ok(i2 && i2.amount == null, 'empty stage №2 exists');
    assert.equal((await put({ id: i2.id, label: 'След монтажа', due_on: '2026-12-20', due_note: 'след монтажа' })).status, 200, 'name and due are saved by id');
    ps = await stages();
    assert.deepEqual(['label', 'custom_label', 'due_on', 'due_note'].map(k => ps.find(p => p.id === i2.id)[k]), ['След монтажа', 'След монтажа', '2026-12-20', 'след монтажа']);
    const i1d = ps.find(p => p.kind === 'interim' && p.seq === 1);
    assert.deepEqual([i1d.label, i1d.custom_label], ['Междинно плащане №1', null], 'the screen tells a typed name from the default one');
    const last = JSON.parse(t.db.prepare("SELECT after FROM audit_log WHERE action = 'payment_plan' ORDER BY id DESC").get().after);
    assert.deepEqual([last.kind, last.seq], ['interim', 2], 'a save by id is audited with its stage');
    assert.equal((await put({ id: i2.id, due_on: '20.12.2026' })).status, 400, 'a due date is ISO');
    const adv = ps.find(p => p.kind === 'advance');
    assert.equal((await a.del(`/api/contract-payments/${adv.id}`)).status, 400, 'advance is never removed');
    assert.equal((await a.del(`/api/contract-payments/${i2.id}`)).status, 200, 'an unsigned, unpaid interim is removed');
    assert.equal((await stages()).filter(p => p.kind === 'interim').length, 1);
    assert.equal((await a.del('/api/contract-payments/999999')).status, 404);
    for (const x of ['submit', 'approve']) await a.post(`/api/projects/${pid}/contract/${x}`, { advance_pct: 30 });
    assert.equal((await a.post(`/api/projects/${pid}/contract/sign`, { signed_on: '2026-10-01', install_start: '2026-12-01', install_deadline: '2026-12-20' })).status, 200); t.sync();
    const i1 = (await stages()).find(p => p.kind === 'interim');
    assert.equal((await a.del(`/api/contract-payments/${i1.id}`)).status, 400, 'after signing a stage goes only with an annex');
    const viewer = await t.mkUser('logi1', 'logistics');
    const r = await viewer.del(`/api/contract-payments/${i1.id}`); assert.equal(r.status, 403, 'needs contracts write: ' + JSON.stringify(r.data));
  } finally { await t.stop(); }
});
