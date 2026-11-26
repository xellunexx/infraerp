import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.SYNCHRO_DATA || path.resolve(process.cwd(), '..', 'synchro-data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS departments (code TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, full_name TEXT NOT NULL,
  department TEXT NOT NULL REFERENCES departments(code), role TEXT NOT NULL,
  phone TEXT, email TEXT, offer_letter TEXT, office TEXT, pass_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL, resource TEXT NOT NULL, can_read INTEGER NOT NULL DEFAULT 0, can_write INTEGER NOT NULL DEFAULT 0,
  can_approve INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (role, resource));
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stage_templates (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  department TEXT, sort INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'company',
  vat_no TEXT, contact_person TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'material',
  unit TEXT NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0, description TEXT,
  min_stock REAL NOT NULL DEFAULT 0, pallet_qty REAL, active INTEGER NOT NULL DEFAULT 1, row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, brand TEXT, cat TEXT, specs TEXT,
  images TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'isport', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS smr_types (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, unit TEXT NOT NULL,
  labour_norm_h REAL NOT NULL DEFAULT 0, description TEXT, active INTEGER NOT NULL DEFAULT 1, row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS recipe_items (
  id INTEGER PRIMARY KEY, smr_type_id INTEGER NOT NULL REFERENCES smr_types(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), norm_per_unit REAL NOT NULL, waste_pct REAL NOT NULL DEFAULT 0,
  UNIQUE (smr_type_id, product_id));

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL, site_address TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'open', received_on TEXT,
  owner_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, inquiry_id INTEGER REFERENCES inquiries(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id), title TEXT NOT NULL, site_address TEXT,
  status TEXT NOT NULL DEFAULT 'draft', current_version INTEGER NOT NULL DEFAULT 1, confirmed_version INTEGER,
  owner_id INTEGER REFERENCES users(id), project_id INTEGER REFERENCES projects(id),
  questionnaire TEXT NOT NULL DEFAULT '{}', readiness_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS offer_versions (
  id INTEGER PRIMARY KEY, offer_id INTEGER NOT NULL REFERENCES offers(id), version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', valid_until TEXT, discount_pct REAL NOT NULL DEFAULT 0, notes TEXT,
  execution_logic TEXT, prelim_days INTEGER, locked INTEGER NOT NULL DEFAULT 0,
  attention_to TEXT, offer_date TEXT, validity_months INTEGER NOT NULL DEFAULT 1, labour_calc TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (offer_id, version));
CREATE TABLE IF NOT EXISTS offer_lines (
  id INTEGER PRIMARY KEY, version_id INTEGER NOT NULL REFERENCES offer_versions(id) ON DELETE CASCADE, sort INTEGER NOT NULL DEFAULT 0,
  smr_type_id INTEGER REFERENCES smr_types(id), product_id INTEGER REFERENCES products(id),
  code TEXT, description TEXT NOT NULL, unit TEXT NOT NULL, qty REAL NOT NULL, unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0, tech_note TEXT, planned_days INTEGER,
  section_id INTEGER REFERENCES offer_sections(id) ON DELETE SET NULL, material_cost REAL NOT NULL DEFAULT 0, delivery_cost REAL NOT NULL DEFAULT 0,
  labour_days REAL NOT NULL DEFAULT 0, day_rate REAL NOT NULL DEFAULT 0, install_cost REAL, overhead_pct REAL NOT NULL DEFAULT 3.5,
  profit_pct REAL NOT NULL DEFAULT 30, tax_pct REAL NOT NULL DEFAULT 10, manual_price REAL, image_document_id INTEGER REFERENCES documents(id), materials TEXT);
CREATE TABLE IF NOT EXISTS offer_sections (
  id INTEGER PRIMARY KEY, version_id INTEGER NOT NULL REFERENCES offer_versions(id) ON DELETE CASCADE, sort INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL, description TEXT, footer TEXT, alternative INTEGER NOT NULL DEFAULT 0, selected INTEGER NOT NULL DEFAULT 0, image_document_id INTEGER REFERENCES documents(id));
CREATE TABLE IF NOT EXISTS offer_templates (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, family TEXT NOT NULL, title TEXT NOT NULL, description TEXT, footer TEXT,
  alternative INTEGER NOT NULL DEFAULT 0, lines TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, row_version INTEGER NOT NULL DEFAULT 1,
  catalog_slug TEXT);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id),
  offer_id INTEGER REFERENCES offers(id), site_address TEXT, status TEXT NOT NULL DEFAULT 'contract_pending',
  technical_id INTEGER REFERENCES users(id), brigadier_id INTEGER REFERENCES users(id),
  planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, baseline_version INTEGER,
  access_notes TEXT, unloading_notes TEXT, storage_notes TEXT, parking_notes TEXT, courier_office TEXT, courier_pallets INTEGER,
  payment_urgency TEXT NOT NULL DEFAULT 'normal', site_questionnaire TEXT NOT NULL DEFAULT '{}', customer_questionnaire TEXT NOT NULL DEFAULT '{}',
  latitude REAL, longitude REAL, geo_label TEXT, geo_source TEXT,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS project_members (project_id INTEGER NOT NULL REFERENCES projects(id), user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT, PRIMARY KEY (project_id, user_id));
CREATE TABLE IF NOT EXISTS project_stages (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), code TEXT NOT NULL, name TEXT NOT NULL,
  department TEXT, sort INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requires_approval INTEGER NOT NULL DEFAULT 0,
  due_date TEXT, done_at TEXT, done_by INTEGER REFERENCES users(id), note TEXT, reverted INTEGER NOT NULL DEFAULT 0, UNIQUE (project_id, code));
CREATE TABLE IF NOT EXISTS project_lines (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), sort INTEGER NOT NULL DEFAULT 0,
  source_offer_line_id INTEGER REFERENCES offer_lines(id), smr_type_id INTEGER REFERENCES smr_types(id), product_id INTEGER REFERENCES products(id),
  code TEXT, description TEXT NOT NULL, unit TEXT NOT NULL, qty REAL NOT NULL, unit_price REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0,
  tech_note TEXT, added_by_version INTEGER NOT NULL DEFAULT 1, removed INTEGER NOT NULL DEFAULT 0, row_version INTEGER NOT NULL DEFAULT 1, outside_contract INTEGER NOT NULL DEFAULT 0, amendment_id INTEGER);
CREATE TABLE IF NOT EXISTS project_line_recipe (
  id INTEGER PRIMARY KEY, project_line_id INTEGER NOT NULL REFERENCES project_lines(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), norm_per_unit REAL NOT NULL, waste_pct REAL NOT NULL DEFAULT 0,
  adjustment_note TEXT, UNIQUE (project_line_id, product_id));

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id),
  offer_id INTEGER REFERENCES offers(id), offer_version INTEGER, template TEXT NOT NULL DEFAULT 'standard', special_terms TEXT,
  status TEXT NOT NULL DEFAULT 'draft', active_version INTEGER, signed_on TEXT, delivery_deadline TEXT, install_start TEXT, install_deadline TEXT,
  advance_pct REAL NOT NULL DEFAULT 0, payment_terms_days INTEGER NOT NULL DEFAULT 14, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  contract_kind TEXT, prod_delivery_days REAL, install_days REAL, advance_set INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS contract_appendices (id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  number INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, contract_version INTEGER NOT NULL, UNIQUE (contract_id, number, contract_version));
CREATE TABLE IF NOT EXISTS contract_versions (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id), version INTEGER NOT NULL, reason TEXT NOT NULL,
  snapshot TEXT NOT NULL, total_value REAL NOT NULL, amendment_id INTEGER, approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (contract_id, version));
CREATE TABLE IF NOT EXISTS amendments (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), kind TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT, changes TEXT NOT NULL DEFAULT '{}', schedule_shift_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', approval_id INTEGER, created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT,
  amount REAL, unit_price REAL, schedule_item_id INTEGER, first_approved_by INTEGER REFERENCES users(id), decided_by INTEGER REFERENCES users(id), decision_note TEXT);

CREATE TABLE IF NOT EXISTS schedule_items (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), project_line_id INTEGER REFERENCES project_lines(id),
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, baseline_start TEXT, baseline_end TEXT, start_date TEXT, end_date TEXT,
  depends_on INTEGER REFERENCES schedule_items(id), crew TEXT, row_version INTEGER NOT NULL DEFAULT 1,
  unit TEXT, qty REAL, note TEXT, materials TEXT, outside_contract INTEGER NOT NULL DEFAULT 0, amendment_id INTEGER);
CREATE TABLE IF NOT EXISTS progress_entries (
  id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id),
  project_line_id INTEGER NOT NULL REFERENCES project_lines(id), work_date TEXT NOT NULL, qty REAL NOT NULL, note TEXT,
  reported_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), voided INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), work_date TEXT NOT NULL,
  worker TEXT NOT NULL, hours REAL NOT NULL DEFAULT 8, team TEXT, recorded_by INTEGER REFERENCES users(id), UNIQUE (project_id, work_date, worker));
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL, description TEXT, product_id INTEGER REFERENCES products(id),
  project_line_id INTEGER REFERENCES project_lines(id), status TEXT NOT NULL DEFAULT 'open', reported_by INTEGER REFERENCES users(id),
  assigned_dept TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, resolution TEXT,
  row_version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL, plate TEXT, status TEXT NOT NULL DEFAULT 'available',
  location TEXT, notes TEXT, row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS asset_allocations (
  id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL REFERENCES assets(id), project_id INTEGER NOT NULL REFERENCES projects(id),
  date_from TEXT NOT NULL, date_to TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', note TEXT, created_by INTEGER REFERENCES users(id),
  row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS material_requests (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), origin TEXT NOT NULL,
  needed_by TEXT, status TEXT NOT NULL DEFAULT 'submitted', note TEXT, requested_by INTEGER REFERENCES users(id),
  needs_approval INTEGER NOT NULL DEFAULT 0, approval_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), qty REAL NOT NULL, reserved_qty REAL NOT NULL DEFAULT 0,
  to_purchase_qty REAL NOT NULL DEFAULT 0, project_line_id INTEGER REFERENCES project_lines(id), outside_contract INTEGER NOT NULL DEFAULT 0, reason TEXT);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, product_id INTEGER NOT NULL REFERENCES products(id), kind TEXT NOT NULL,
  qty REAL NOT NULL, project_id INTEGER REFERENCES projects(id), to_project_id INTEGER REFERENCES projects(id),
  project_line_id INTEGER REFERENCES project_lines(id), request_id INTEGER REFERENCES material_requests(id), unit_cost REAL NOT NULL DEFAULT 0,
  document_ref TEXT, note TEXT, responsible_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), project_id INTEGER NOT NULL REFERENCES projects(id),
  request_item_id INTEGER REFERENCES request_items(id), qty REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), request_id INTEGER REFERENCES material_requests(id),
  kind TEXT NOT NULL DEFAULT 'to_site', planned_date TEXT, status TEXT NOT NULL DEFAULT 'planned', carrier TEXT, courier_office TEXT,
  pallets INTEGER, palletized INTEGER NOT NULL DEFAULT 1, vehicle_asset_id INTEGER REFERENCES assets(id), unloading TEXT, address TEXT,
  access_notes TEXT, note TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS delivery_items (id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), qty REAL NOT NULL);

CREATE TABLE IF NOT EXISTS proformas (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), kind TEXT NOT NULL DEFAULT 'advance',
  amount REAL NOT NULL, vat_pct REAL NOT NULL, issued_on TEXT NOT NULL, due_on TEXT, status TEXT NOT NULL DEFAULT 'issued', note TEXT,
  created_by INTEGER REFERENCES users(id), row_version INTEGER NOT NULL DEFAULT 1, amendment_id INTEGER);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, uid TEXT NOT NULL UNIQUE, project_id INTEGER REFERENCES projects(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), category TEXT NOT NULL, amount REAL NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'paid', tx_date TEXT NOT NULL, due_on TEXT, counterparty TEXT, document_ref TEXT, proforma_id INTEGER REFERENCES proformas(id),
  payment_request_id INTEGER, note TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), row_version INTEGER NOT NULL DEFAULT 1,
  tx_kind TEXT, method TEXT, company TEXT, document_id INTEGER REFERENCES transactions(id),
  cost_center_id INTEGER REFERENCES cost_centers(id), person_id INTEGER REFERENCES accountable_persons(id), asset_id INTEGER REFERENCES assets(id),
  has_vat INTEGER NOT NULL DEFAULT 0, vat_amount REAL, pko_no TEXT, rko_no TEXT,
  labour_worker TEXT, labour_days REAL, labour_rate REAL,
  contract_payment_id INTEGER REFERENCES contract_payments(id), supplier_order_id INTEGER REFERENCES supplier_orders(id), order_stage TEXT);
CREATE TABLE IF NOT EXISTS payment_requests (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER REFERENCES projects(id), category TEXT NOT NULL, amount REAL NOT NULL,
  payee TEXT NOT NULL, reason TEXT, exceptional INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', approval_id INTEGER,
  requested_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS accommodations (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), place TEXT NOT NULL, address TEXT, date_from TEXT, date_to TEXT,
  beds INTEGER, cost_per_night REAL NOT NULL DEFAULT 0, payment_method TEXT, parking TEXT, workers TEXT, note TEXT,
  created_by INTEGER REFERENCES users(id), row_version INTEGER NOT NULL DEFAULT 1);

-- §14 operator spec: one ledger, filtered views (project / person card / company / cost center).
CREATE TABLE IF NOT EXISTS cost_centers (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'overhead', active INTEGER NOT NULL DEFAULT 1, row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS accountable_persons (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id), note TEXT, active INTEGER NOT NULL DEFAULT 1, row_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS contract_payments (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id), kind TEXT NOT NULL,
  pct REAL, amount REAL, paid_at TEXT, note TEXT, vat_pct REAL, gross REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (contract_id, kind));
CREATE TABLE IF NOT EXISTS supplier_orders (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id),
  project_line_id INTEGER REFERENCES project_lines(id), supplier TEXT NOT NULL, order_doc_no TEXT,
  total_eur REAL NOT NULL DEFAULT 0, advance_eur REAL NOT NULL DEFAULT 0, advance_paid_at TEXT,
  prod_days REAL, final_paid_at TEXT, transport_days REAL, status TEXT NOT NULL DEFAULT 'ordered',
  note TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  row_version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id), entity_type TEXT, entity_id INTEGER, category TEXT NOT NULL,
  title TEXT NOT NULL, current_version INTEGER NOT NULL DEFAULT 1, created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), shared_with_brigade INTEGER NOT NULL DEFAULT 0, shared_at TEXT, shared_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id), version INTEGER NOT NULL, filename TEXT NOT NULL,
  stored_name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, sha256 TEXT NOT NULL, note TEXT, uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (document_id, version));

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER REFERENCES projects(id), kind TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL, title TEXT NOT NULL, amount REAL, status TEXT NOT NULL DEFAULT 'pending', requested_by INTEGER REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id), decision_note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT,
  UNIQUE (entity_type, entity_id, kind));
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, project_id INTEGER REFERENCES projects(id), title TEXT NOT NULL, description TEXT,
  assignee_id INTEGER REFERENCES users(id), assignee_dept TEXT, due_date TEXT, priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open', source_message_id INTEGER, source_event_id INTEGER, dedupe_key TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), parent_id INTEGER REFERENCES messages(id),
  entity_type TEXT, entity_id INTEGER, kind TEXT NOT NULL DEFAULT 'comment', body TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open', escalated INTEGER NOT NULL DEFAULT 0, document_id INTEGER REFERENCES documents(id),
  author_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, dedupe_key TEXT NOT NULL UNIQUE, project_id INTEGER REFERENCES projects(id),
  type TEXT NOT NULL, origin_module TEXT NOT NULL, user_id INTEGER REFERENCES users(id), ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  entity_type TEXT, entity_id INTEGER, prev_value TEXT, new_value TEXT, approval_status TEXT, affected_modules TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at TEXT, processed_at TEXT);
CREATE INDEX IF NOT EXISTS ix_events_status ON events(status, id);
CREATE INDEX IF NOT EXISTS ix_events_project ON events(project_id, id);
CREATE TABLE IF NOT EXISTS event_effects (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), handler TEXT NOT NULL,
  status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (event_id, handler));
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, event_id INTEGER REFERENCES events(id), user_id INTEGER REFERENCES users(id), department TEXT,
  project_id INTEGER REFERENCES projects(id), title TEXT NOT NULL, body TEXT, link TEXT, severity TEXT NOT NULL DEFAULT 'info',
  ref_type TEXT, ref_id INTEGER, author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notification_reads (notification_id INTEGER NOT NULL REFERENCES notifications(id), user_id INTEGER NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (notification_id, user_id));
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id), entity_type TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL, before TEXT, after TEXT, module TEXT);
CREATE INDEX IF NOT EXISTS ix_audit_project ON audit_log(project_id, id);
CREATE TABLE IF NOT EXISTS weather_forecasts (project_id INTEGER NOT NULL REFERENCES projects(id), source TEXT NOT NULL, fetched_at TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, days TEXT NOT NULL DEFAULT '[]', latitude REAL, longitude REAL, PRIMARY KEY (project_id, source));
CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, user_id INTEGER, response TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('edit','delete')), payload TEXT, reason TEXT NOT NULL, entity_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by INTEGER NOT NULL REFERENCES users(id), decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision_note TEXT,
  applied_at TEXT, result TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_crq_status ON change_requests(status, id);
CREATE TABLE IF NOT EXISTS user_overrides (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, resource TEXT NOT NULL,
  can_read INTEGER, can_write INTEGER, can_approve INTEGER, PRIMARY KEY (user_id, resource));
CREATE TABLE IF NOT EXISTS reminders_log (
  id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, kind TEXT NOT NULL,
  bucket INTEGER NOT NULL, notified TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id, kind, bucket));
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(kind UNINDEXED, ref_id UNINDEXED, code, title, body, tokenize='unicode61 remove_diacritics 2');
`;

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  migrateColumns(db);
  return db;
}

/** Additive migration: columns added to SCHEMA later are added to existing databases, so updates never need a rebuild or lose data. */
function splitTopLevel(body) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) parts.push(cur);
  return parts.map(p => p.trim()).filter(Boolean);
}
export function migrateColumns(db) {
  const re = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);\n/g;
  let m, added = [];
  while ((m = re.exec(SCHEMA))) {
    const [, table, body] = m;
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const def of splitTopLevel(body)) {
      const name = def.split(/\s+/)[0];
      if (/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(name) || have.has(name)) continue;
      // SQLite cannot add UNIQUE/PRIMARY KEY columns or NOT NULL without a default; such columns only appear in new tables
      // SQLite also rejects expression defaults such as (datetime('now')) on ADD COLUMN: add the column plain, then backfill with the expression
      const expr = def.match(/DEFAULT\s+(\([^]*\))\s*$/i)?.[1];
      let safe = def.replace(/\bUNIQUE\b/gi, '');
      if (expr) safe = safe.replace(/DEFAULT\s+\([^]*\)\s*$/i, '').replace(/NOT NULL/i, '');
      else if (!/DEFAULT/i.test(safe)) safe = safe.replace(/NOT NULL/i, '');
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${safe}`);
      if (expr) db.exec(`UPDATE ${table} SET ${name} = ${expr} WHERE ${name} IS NULL`);
      added.push(`${table}.${name}`);
    }
  }
  return added;
}

let depth = 0;
export function tx(db, fn) {
  if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
  db.exec('BEGIN IMMEDIATE');
  depth = 1;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  finally { depth = 0; }
}

export function nextCode(db, prefix, width = 4) {
  const year = new Date().getFullYear();
  const name = prefix === 'PRJ' ? `PRJ-${year}` : prefix;
  db.prepare('INSERT INTO counters(name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(name);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
  const v = db.prepare('SELECT value FROM counters WHERE name = ?').get(name).value;
  return `${name}-${String(v).padStart(prefix === 'PRJ' ? 3 : width, '0')}`;
}