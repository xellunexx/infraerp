// Shared test harness: a fresh database and HTTP server per test file.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { drain } from '../server/core.js';
import { createApp } from '../server/app.js';
import { ROUTES } from '../server/index.js';

export async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synchro-test-'));
  const db = openDb(path.join(dir, 't.db'));
  const app = createApp(db, ROUTES);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };
    return { get: u => call('GET', u), post: (u, b, hd) => call('POST', u, b ?? {}, hd), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b),
      login: (username, password = 'password123') => call('POST', '/api/auth/login', { username, password }) };
  };
  const admin = client();
  await admin.post('/api/auth/setup', { username: 'admin', full_name: 'Админ', password: 'password123' });
  const mkUser = async (username, role) => { await admin.post('/api/users', { username, full_name: username, role, password: 'password123' }); const c = client(); await c.login(username); return c; };
  const stop = async () => { await new Promise(r => server.close(r)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { db, base, client, admin, mkUser, stop, sync: () => drain(db, { ignoreBackoff: true }) };
}

/** Customer + catalogue + offer with two СМР lines, ready to confirm. */
export async function seedOffer(t) {
  const a = t.admin;
  const cust = (await a.post('/api/customers', { name: 'Тест Клиент ООД', contact_person: 'Иван Иванов', phone: '0888', email: 'i@x.bg', address: 'София' })).data;
  const tile = (await a.post('/api/products', { code: 'M-001', name: 'Плочи 60x60', unit: 'м2', unit_cost: 20, unit_price: 30, kind: 'material' })).data;
  const glue = (await a.post('/api/products', { code: 'M-002', name: 'Лепило C2', unit: 'кг', unit_cost: 0.5, unit_price: 0.8, kind: 'material' })).data;
  const smr = (await a.post('/api/smr-types', { code: 'S-001', name: 'Полагане на плочи', unit: 'м2' })).data;
  await a.put(`/api/smr-types/${smr.id}/recipe`, { items: [{ product_id: tile.id, norm_per_unit: 1, waste_pct: 5 }, { product_id: glue.id, norm_per_unit: 4, waste_pct: 0 }] });
  const offer = (await a.post('/api/offers', { customer_id: cust.id, title: 'Настилка склад', site_address: 'Пловдив, ул. Тестова 1' })).data;
  const saved = await a.put(`/api/offers/${offer.id}`, { discount_pct: 0, lines: [
    { smr_type_id: smr.id, code: 'S-001', description: 'Полагане на плочи', unit: 'м2', qty: 100, unit_price: 50, unit_cost: 30, planned_days: 5 },
    { smr_type_id: smr.id, code: 'S-001', description: 'Полагане на плочи — рампа', unit: 'м2', qty: 20, unit_price: 60, unit_cost: 35, planned_days: 2 }] });
  return { cust, tile, glue, smr, offer, saved };
}