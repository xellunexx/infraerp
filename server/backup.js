// Дневен архив на базата: проверено копие веднъж на ден, последните N автоматични се пазят; ръчните архиви не се пипат.
// Копието е на същата машина — за авария на диска е нужно и копие извън нея. Качените файлове (files/) не са включени.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_DIR } from './db.js';

const AUTO = /^synchro-auto-\d{4}-\d{2}-\d{2}\.db$/;

/** Returns the path of a new backup, or null when today's already exists. */
export function backupIfDue(db, { dir = BACKUP_DIR, keep = 14, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `synchro-auto-${now.toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(file)) return null;
  const part = file + '.part';
  fs.rmSync(part, { force: true });
  db.prepare('VACUUM INTO ?').run(part);
  const copy = new DatabaseSync(part, { readOnly: true });
  let ok;
  try { ok = copy.prepare('PRAGMA integrity_check').get().integrity_check === 'ok'; } finally { copy.close(); }
  if (!ok) { fs.rmSync(part, { force: true }); throw new Error('Архивът не мина проверката за цялост'); }
  fs.renameSync(part, file);
  for (const old of fs.readdirSync(dir).filter(f => AUTO.test(f)).sort().slice(0, -keep)) fs.rmSync(path.join(dir, old));
  return file;
}

export function startBackupWorker(db, intervalMs = 3600_000) {
  const run = () => { try { const f = backupIfDue(db); if (f) console.log('backup', f); } catch (e) { console.error('backup', e); } };
  const t = setInterval(run, intervalMs);
  t.unref?.();
  run();
  return () => clearInterval(t);
}
