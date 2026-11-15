import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { ROUTES } from '../server/index.js';

test('internet exposure: first-run setup is refused through the public tunnel; wrong passwords lock the login', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synchro-exp-'));
  const db = openDb(path.join(dir, 't.db'));
  const server = await new Promise(r => { const s = createApp(db, ROUTES).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const cf = { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-proto': 'https' };
  try {
    // an empty system must not be claimable by whoever finds the public address
    const pub = await post('/api/auth/setup', { username: 'evil', full_name: 'x', password: 'password123' }, cf);
    assert.equal(pub.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    const priv = await post('/api/auth/setup', { username: 'admin', full_name: 'Админ', password: 'password123' });
    assert.equal(priv.status, 200);

    // through the tunnel the session cookie is marked Secure and pages are not indexable
    const ok = await post('/api/auth/login', { username: 'admin', password: 'password123' }, cf);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
    assert.equal(ok.headers.get('x-robots-tag'), 'noindex, nofollow');

    // five wrong passwords from one address lock that user for that address, even with the right password afterwards
    for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/login', { username: 'admin', password: 'wrong' + i }, cf)).status, 401);
    const locked = await post('/api/auth/login', { username: 'admin', password: 'password123' }, cf);
    assert.equal(locked.status, 429);
    // another address is not locked out by the attacker
    assert.equal((await post('/api/auth/login', { username: 'admin', password: 'password123' }, { 'cf-connecting-ip': '198.51.100.9' })).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'login' AND action = 'failed'").get().n, 5);
  } finally { await new Promise(r => server.close(r)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});