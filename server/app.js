// HTTP application: session auth, permission checks, shared helpers. Route groups live in routes_*.js.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
const parseCookie = header => Object.fromEntries(String(header).split(';').map(p => p.trim().split('=')).filter(p => p[0] && p.length > 1).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
import { tx, nextCode } from './db.js';
import { bootstrap, HttpError, bad, hashPassword, verifyPassword, createSession, userFromToken, need, audit, updateRow, reindex, ROLES, RESOURCES } from './core.js';
import './domain.js';

export const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k] === '' ? null : o[k]]));
export const reqStr = (v, label) => { if (typeof v !== 'string' || !v.trim()) throw bad(`Полето „${label}“ е задължително`); return v.trim(); };
export const num = (v, label, { min = 0 } = {}) => { const n = Number(v); if (v === null || v === '' || !Number.isFinite(n) || n < min) throw bad(`Невалидна стойност за „${label}“`); return n; };
/** Wrap a synchronous handler: returned value becomes JSON, thrown errors go to the error middleware. */
export const h = fn => (req, res, next) => { try { const r = fn(req, res); if (r !== undefined && !res.headersSent) res.json(r); } catch (e) { next(e); } };

export function createApp(db, routeModules = []) {
  bootstrap(db);
  const app = express();
  app.disable('x-powered-by');
  // ---- internet exposure hardening
  const viaPublicTunnel = req => !!(req.headers['cf-connecting-ip'] || req.headers['cdn-loop'] || req.headers['cf-ray']);
  const clientIp = req => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    if (viaPublicTunnel(req)) { res.setHeader('Strict-Transport-Security', 'max-age=31536000'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); } next(); });
  // password guessing: 5 wrong attempts per user+address (20 per address) within 15 minutes lock that key for 15 minutes
  const WINDOW = 15 * 60 * 1000, fails = new Map();
  const failKeys = (req, username) => [[`u:${String(username).toLowerCase()}|${clientIp(req)}`, 5], [`ip:${clientIp(req)}`, 20]];
  const lockedFor = (req, username) => { const now = Date.now(); let wait = 0;
    for (const [k, max] of failKeys(req, username)) { const f = fails.get(k); if (f && now - f.first > WINDOW) fails.delete(k); else if (f && f.count >= max) wait = Math.max(wait, f.first + WINDOW - now); }
    return wait; };
  const noteFail = (req, username) => { const now = Date.now(); for (const [k] of failKeys(req, username)) { const f = fails.get(k); if (!f || now - f.first > WINDOW) fails.set(k, { first: now, count: 1 }); else f.count++; }
    if (fails.size > 5000) for (const [k, f] of fails) if (now - f.first > WINDOW) fails.delete(k); };
  app.locals.loginFails = fails;
  app.use(express.json({ limit: '2mb' }));
  app.locals.db = db;

  app.use('/api', (req, _res, next) => { req.user = userFromToken(db, parseCookie(req.headers.cookie || '').synchro_sid); next(); });
  const setCookie = (res, token) => res.setHeader('Set-Cookie', `synchro_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 14 * 86400 : 0}${res.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);

  app.get('/api/auth/state', h(req => ({ needs_setup: !db.prepare('SELECT 1 FROM users LIMIT 1').get(), user: req.user,
    departments: db.prepare('SELECT * FROM departments').all(), settings: Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(s => [s.key, s.value])) })));
  app.post('/api/auth/setup', h((req, res) => tx(db, () => {
    if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new HttpError(403, 'Системата вече е настроена');
    // the first administrator can only be created from the private address, never through the public internet link
    if (viaPublicTunnel(req)) throw new HttpError(403, 'Първоначалната настройка не е достъпна през публичния адрес.');
    const b = req.body || {};
    if (String(b.password || '').length < 8) throw bad('Паролата трябва да е поне 8 символа');
    const id = Number(db.prepare("INSERT INTO users(username, full_name, department, role, pass_hash) VALUES (?,?, 'management', 'admin', ?)")
      .run(reqStr(b.username, 'Потребителско име'), reqStr(b.full_name, 'Име'), hashPassword(b.password)).lastInsertRowid);
    if (b.company_name) db.prepare("UPDATE settings SET value = ? WHERE key = 'company_name'").run(String(b.company_name));
    audit(db, { id }, { entity_type: 'user', entity_id: id, action: 'setup_admin', module: 'settings' });
    setCookie(res, createSession(db, id));
    return { ok: true };
  })));
  app.post('/api/auth/login', h((req, res) => {
    const username = String(req.body?.username || '');
    const wait = lockedFor(req, username);
    if (wait > 0) throw new HttpError(429, `Твърде много неуспешни опити. Опитайте отново след ${Math.ceil(wait / 60000)} мин.`);
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!u || !verifyPassword(String(req.body?.password || ''), u.pass_hash)) {
      noteFail(req, username);
      audit(db, null, { entity_type: 'login', action: 'failed', after: { username, ip: clientIp(req) }, module: 'auth' });
      throw new HttpError(401, 'Грешно потребителско име или парола');
    }
    fails.delete(`u:${username.toLowerCase()}|${clientIp(req)}`);
    setCookie(res, createSession(db, u.id));
    return { ok: true };
  }));
  app.post('/api/auth/logout', h((req, res) => { db.prepare('DELETE FROM sessions WHERE token = ?').run(parseCookie(req.headers.cookie || '').synchro_sid || ''); setCookie(res, ''); return { ok: true }; }));
  app.use('/api', (req, _res, next) => req.user ? next() : next(new HttpError(401, 'Необходим е вход')));

  // ---- users, permissions, settings
  app.get('/api/users', h(() => db.prepare('SELECT id, username, full_name, department, role, phone, email, active, row_version FROM users ORDER BY full_name').all()));
  app.post('/api/users', h(req => tx(db, () => {
    need(req.user, 'users', 'write');
    const b = req.body || {};
    if (!ROLES[b.role]) throw bad('Невалидна роля');
    if (String(b.password || '').length < 8) throw bad('Паролата трябва да е поне 8 символа');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(reqStr(b.username, 'Потребителско име'))) throw bad('Потребителското име е заето');
    const id = Number(db.prepare('INSERT INTO users(username, full_name, department, role, phone, email, pass_hash) VALUES (?,?,?,?,?,?,?)')
      .run(b.username.trim(), reqStr(b.full_name, 'Име'), ROLES[b.role], b.role, b.phone || null, b.email || null, hashPassword(b.password)).lastInsertRowid);
    audit(db, req.user, { entity_type: 'user', entity_id: id, action: 'create', after: { username: b.username, role: b.role }, module: 'settings' });
    return { id };
  })));
  app.patch('/api/users/:id', h(req => tx(db, () => {
    need(req.user, 'users', 'write');
    const b = req.body || {}, id = Number(req.params.id);
    const before = db.prepare('SELECT username, full_name, role, department, active, phone, email FROM users WHERE id = ?').get(id);
    if (!before) throw new HttpError(404, 'Няма такъв потребител');
    const f = pick(b, ['full_name', 'phone', 'email']);
    if (b.role !== undefined) { if (!ROLES[b.role]) throw bad('Невалидна роля'); f.role = b.role; f.department = ROLES[b.role]; }
    const lastAdmin = before.role === 'admin' && before.active && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n <= 1;
    if (lastAdmin && ((b.role !== undefined && b.role !== 'admin') || b.active === false || b.active === 0)) throw bad('Не може да премахнете последния администратор');
    if (b.active !== undefined) { f.active = b.active ? 1 : 0; if (!f.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); }
    if (b.password) { if (String(b.password).length < 8) throw bad('Паролата трябва да е поне 8 символа'); f.pass_hash = hashPassword(b.password); }
    updateRow(db, 'users', id, f, b.row_version);
    audit(db, req.user, { entity_type: 'user', entity_id: id, action: 'update', before, after: { ...f, pass_hash: f.pass_hash ? '(changed)' : undefined }, module: 'settings' });
    return { ok: true };
  })));
  app.get('/api/permissions', h(req => { need(req.user, 'settings'); return { roles: Object.keys(ROLES), resources: RESOURCES, rows: db.prepare('SELECT * FROM role_permissions').all() }; }));
  app.put('/api/permissions', h(req => tx(db, () => {
    need(req.user, 'settings', 'write');
    const up = db.prepare('UPDATE role_permissions SET can_read = ?, can_write = ?, can_approve = ? WHERE role = ? AND resource = ?');
    for (const r of req.body?.rows || []) { if (r.role === 'admin') continue; up.run(+!!r.can_read, +!!r.can_write, +!!r.can_approve, String(r.role), String(r.resource)); }
    audit(db, req.user, { entity_type: 'permissions', action: 'update', after: req.body?.rows, module: 'settings' });
    return { ok: true };
  })));
  app.put('/api/settings', h(req => tx(db, () => {
    need(req.user, 'settings', 'write');
    const up = db.prepare('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(req.body || {})) up.run(k, String(v));
    audit(db, req.user, { entity_type: 'settings', action: 'update', after: req.body, module: 'settings' });
    return { ok: true };
  })));

  // ---- generic catalogue CRUD (customers, products, СМР types)
  function crud(route, table, resource, kind, cols, required, codePrefix) {
    const text = r => [r.contact_person, r.address, r.description, r.email, r.phone, r.vat_no].filter(Boolean).join(' ');
    app.get(`/api/${route}`, h(req => { need(req.user, resource); return db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all(); }));
    app.post(`/api/${route}`, h(req => tx(db, () => {
      need(req.user, resource, 'write');
      const f = pick(req.body || {}, cols);
      for (const [k, label] of required) reqStr(String(f[k] ?? ''), label);
      if (codePrefix) f.code = nextCode(db, codePrefix);
      else if (db.prepare(`SELECT 1 FROM ${table} WHERE code = ?`).get(f.code)) throw bad(`Код ${f.code} вече съществува`);
      if (table === 'customers') f.created_by = req.user.id;
      const keys = Object.keys(f);
      const id = Number(db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => f[k])).lastInsertRowid);
      reindex(db, kind, id, f.code, f.name, text(f));
      audit(db, req.user, { entity_type: kind, entity_id: id, action: 'create', after: f, module: resource });
      return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    })));
    app.patch(`/api/${route}/:id`, h(req => tx(db, () => {
      need(req.user, resource, 'write');
      const id = Number(req.params.id), before = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!before) throw new HttpError(404, 'Записът не е намерен');
      updateRow(db, table, id, pick(req.body || {}, cols.filter(c => c !== 'code')), req.body?.row_version);
      const after = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      reindex(db, kind, id, after.code, after.name, text(after));
      audit(db, req.user, { entity_type: kind, entity_id: id, action: 'update', before, after, module: resource });
      return after;
    })));
  }
  crud('customers', 'customers', 'customers', 'customer', ['name', 'kind', 'vat_no', 'contact_person', 'phone', 'email', 'address', 'notes'], [['name', 'Име']], 'CUS');
  crud('products', 'products', 'catalog', 'product', ['code', 'name', 'kind', 'unit', 'unit_cost', 'unit_price', 'description', 'min_stock', 'pallet_qty', 'active'], [['code', 'Код'], ['name', 'Име'], ['unit', 'Мярка']]);
  crud('smr-types', 'smr_types', 'catalog', 'smr', ['code', 'name', 'unit', 'labour_norm_h', 'description', 'active'], [['code', 'Код'], ['name', 'Име'], ['unit', 'Мярка']]);
  app.get('/api/smr-types/:id/recipe', h(req => { need(req.user, 'catalog');
    return db.prepare('SELECT r.*, p.code, p.name, p.unit, p.unit_cost FROM recipe_items r JOIN products p ON p.id = r.product_id WHERE r.smr_type_id = ?').all(req.params.id); }));
  app.put('/api/smr-types/:id/recipe', h(req => tx(db, () => {
    need(req.user, 'catalog', 'write');
    const id = Number(req.params.id), before = db.prepare('SELECT product_id, norm_per_unit, waste_pct FROM recipe_items WHERE smr_type_id = ?').all(id);
    db.prepare('DELETE FROM recipe_items WHERE smr_type_id = ?').run(id);
    const ins = db.prepare('INSERT INTO recipe_items(smr_type_id, product_id, norm_per_unit, waste_pct) VALUES (?,?,?,?)');
    for (const r of req.body?.items || []) ins.run(id, num(r.product_id, 'Материал', { min: 1 }), num(r.norm_per_unit, 'Норма', { min: 0.000001 }), num(r.waste_pct ?? 0, 'Фира'));
    audit(db, req.user, { entity_type: 'recipe', entity_id: id, action: 'replace', before, after: req.body?.items, module: 'catalog' });
    return { ok: true };
  })));

  for (const mount of routeModules) mount(app, db);

  const dist = path.resolve(process.cwd(), 'web', 'dist');
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Няма такъв адрес')));
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Вътрешна грешка. Опитайте отново.' : err.message, ...(err.extra || {}) });
  });
  return app;
}