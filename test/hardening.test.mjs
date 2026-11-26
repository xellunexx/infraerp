// Вход, сесии, известия по отдели, файлове, съобщения, дневни архиви.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, seedOffer } from './helpers.mjs';
import { notify } from '../server/core.js';
import { openDb } from '../server/db.js';
import * as backup from '../server/backup.js';
import { resolveClientIp } from '../server/app.js';

const login = (t, body, headers = {}) => fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('login: rotating addresses cannot outrun the lock; the proxy header counts only from this machine', async () => {
  const t = await start();
  try {
    const codes = [];
    for (let i = 0; i < 30; i++) codes.push((await login(t, { username: 'admin', password: 'bad' + i }, { 'cf-connecting-ip': '9.9.9.' + i })).status);
    assert.equal(codes.filter(c => c === 401).length, 20);
    assert.equal(codes.at(-1), 429);
    assert.equal(resolveClientIp({ 'cf-connecting-ip': '1.2.3.4' }, '127.0.0.1'), '1.2.3.4');
    assert.equal(resolveClientIp({ 'cf-connecting-ip': '1.2.3.4' }, '::ffff:127.0.0.1'), '1.2.3.4');
    assert.equal(resolveClientIp({ 'cf-connecting-ip': '1.2.3.4' }, '192.168.1.50'), '192.168.1.50');
    assert.equal((await login(t, { username: 'nobody', password: 'x' }, { 'cf-connecting-ip': '8.8.8.8' })).status, 401, 'other users are not locked');
  } finally { await t.stop(); }
});

test('session: password reset ends other sessions; before login only the company name is readable', async () => {
  const t = await start();
  try {
    const u = await t.mkUser('warehouse', 'warehouse');
    assert.equal((await u.get('/api/projects')).status, 200);
    const uid = t.db.prepare("SELECT id FROM users WHERE username = 'warehouse'").get().id;
    await t.admin.patch(`/api/users/${uid}`, { password: 'newpassword1' });
    assert.equal((await u.get('/api/projects')).status, 401);
    const aid = t.db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
    await t.admin.patch(`/api/users/${aid}`, { password: 'newpassword1' });
    assert.equal((await t.admin.get('/api/projects')).status, 200, 'the admin stays signed in on this device');
    const anon = await (await fetch(t.base + '/api/auth/state')).json();
    assert.deepEqual(Object.keys(anon.settings), ['company_name']);
    assert.equal((await t.admin.get('/api/auth/state')).data.settings.vat_pct, '20');
  } finally { await t.stop(); }
});

test('notifications: brigadiers hear about deliveries; an unknown department is refused; issue notice carries its title', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t), b = await t.mkUser('brig', 'brigadier'), tech = await t.mkUser('tech', 'technical');
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT id FROM projects').get().id;
    await t.admin.patch(`/api/projects/${pid}`, { brigadier_id: t.db.prepare("SELECT id FROM users WHERE username = 'brig'").get().id });
    const d = (await t.admin.post('/api/deliveries', { project_id: pid, items: [{ product_id: s.tile.id, qty: 1 }] })).data;
    await t.admin.patch(`/api/deliveries/${d.id}`, { status: 'in_transit' }); await t.admin.patch(`/api/deliveries/${d.id}`, { status: 'delivered' });
    await b.post('/api/issues', { project_id: pid, title: 'Счупена плоча' }); t.sync();
    // Д1: created, on the way (delivery.updated), arrived
    assert.equal((await b.get('/api/notifications')).data.filter(n => n.title.toLowerCase().includes('доставка')).length, 3);
    assert.match((await tech.get('/api/notifications')).data.find(n => n.title.includes('проблем')).body, /Счупена плоча/);
    assert.throws(() => notify(t.db, null, { departments: ['brigadir'], title: 'x' }), /brigadir/);
  } finally { await t.stop(); }
});

test('files: Cyrillic names survive upload and download; an oversized file is explained', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.mkUser('tech', 'technical');
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT id FROM projects').get().id;
    const cookie = 'synchro_sid=' + t.db.prepare("SELECT token FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'tech'").get().token;
    const up = async bytes => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type: 'application/pdf' }), 'Договор "1".pdf');
      const r = await fetch(`${t.base}/api/projects/${pid}/documents`, { method: 'POST', headers: { cookie }, body: fd }); return { status: r.status, data: await r.json() }; };
    const ok = await up('x');
    const name = ok.data.versions[0].filename;
    assert.match(name, /^Договор/);
    const g = await fetch(`${t.base}/api/documents/${ok.data.versions[0].id}/file`, { headers: { cookie } }), cd = g.headers.get('content-disposition');
    assert.equal(decodeURIComponent(cd.match(/^inline; filename="[\x20-\x7e]*"; filename\*=UTF-8''([^;]+)$/)[1]), name);
    const big = await up(new Uint8Array(26 * 1024 * 1024));
    assert.equal(big.status, 413); assert.match(big.data.error, /25/);
  } finally { await t.stop(); }
});

test('messages: the newest are shown and older ones can be paged', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t); await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const pid = t.db.prepare('SELECT id FROM projects').get().id;
    const ins = t.db.prepare("INSERT INTO messages(project_id, body) VALUES (?,?)");
    for (let i = 1; i <= 305; i++) ins.run(pid, 'm' + i);
    const page = (await t.admin.get(`/api/projects/${pid}/messages`)).data;
    assert.deepEqual([page.length, page[0].body, page.at(-1).body], [300, 'm6', 'm305']);
    const older = (await t.admin.get(`/api/projects/${pid}/messages?before=${page[0].id}`)).data;
    assert.deepEqual([older.length, older[0].body, older.at(-1).body], [5, 'm1', 'm5']);
  } finally { await t.stop(); }
});

test('backup: one verified copy a day, old automatic copies rotate, manual copies are never touched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synchro-bak-')), out = path.join(dir, 'backups');
  const db = openDb(path.join(dir, 't.db'));
  try {
    db.prepare("INSERT INTO settings(key, value) VALUES ('k', 'v')").run();
    fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'synchro-pre-catalog.db'), 'manual');
    const day = n => new Date(Date.UTC(2026, 0, n, 12));
    assert.ok(backup.backupIfDue(db, { dir: out, keep: 3, now: day(1) }));
    assert.equal(backup.backupIfDue(db, { dir: out, keep: 3, now: day(1) }), null, 'once a day');
    for (let n = 2; n <= 5; n++) backup.backupIfDue(db, { dir: out, keep: 3, now: day(n) });
    assert.deepEqual(fs.readdirSync(out).sort(), ['synchro-auto-2026-01-03.db', 'synchro-auto-2026-01-04.db', 'synchro-auto-2026-01-05.db', 'synchro-pre-catalog.db']);
    const copy = openDb(path.join(out, 'synchro-auto-2026-01-05.db'));
    assert.equal(copy.prepare("SELECT value FROM settings WHERE key = 'k'").get().value, 'v'); copy.close();
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
