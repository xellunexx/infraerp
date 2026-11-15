import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
import { openDb, migrateColumns } from '../server/db.js';

test('an older database gets new columns added and keeps its rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), f = path.join(dir, 'old.db');
  const old = new DatabaseSync(f);
  old.exec("CREATE TABLE projects (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, customer_id INTEGER NOT NULL); INSERT INTO projects VALUES (1,'P1','Old',1);");
  old.close();
  const db = openDb(f);
  const cols = db.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
  for (const c of ['latitude', 'longitude', 'row_version', 'status', 'created_at']) assert.ok(cols.includes(c), c);
  const row = db.prepare('SELECT name, row_version, status, created_at FROM projects').get();
  assert.equal(row.name, 'Old'); assert.equal(row.row_version, 1); assert.equal(row.status, 'contract_pending'); assert.ok(row.created_at);
  assert.deepEqual(migrateColumns(db), [], 'second run is a no-op');
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});