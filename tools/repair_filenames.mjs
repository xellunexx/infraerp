// Еднократна поправка: имена на файлове, качени преди поправката на кодировката (25.11.2026), са записани като
// UTF-8, прочетен като latin1 ("Ð\x91Ñ\x83…"). Връща ги в кирилица. Пипа само document_versions.filename и пише одит.
// Без --apply само показва какво би променило.  node tools/repair_filenames.mjs <synchro.db> [--apply]
import { DatabaseSync } from 'node:sqlite';

export function repairedName(name) {
  if (!/[ÐÑ][\x80-\xBF]/.test(name)) return null;                    // typical UTF-8-as-latin1 Cyrillic pairs
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  if (fixed.includes('�') || !/[Ѐ-ӿ]/.test(fixed)) return null; // not a clean round trip: leave it
  return fixed;
}

if (process.argv[1]?.endsWith('repair_filenames.mjs')) {   // run as a script, not when imported by the test
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error('usage: node tools/repair_filenames.mjs <synchro.db> [--apply]'); process.exit(2); }
  const db = new DatabaseSync(file);
  const rows = db.prepare('SELECT v.id, v.document_id, v.filename, d.project_id FROM document_versions v JOIN documents d ON d.id = v.document_id').all()
    .map(r => ({ ...r, fixed: repairedName(r.filename) })).filter(r => r.fixed);
  for (const r of rows) console.log(`v${r.id} doc ${r.document_id}: ${r.fixed}`);
  if (flag === '--apply' && rows.length) {
    db.exec('BEGIN');
    for (const r of rows) {
      db.prepare('UPDATE document_versions SET filename = ? WHERE id = ?').run(r.fixed, r.id);
      db.prepare('INSERT INTO audit_log(user_id, project_id, entity_type, entity_id, action, before, after, module) VALUES (NULL,?,?,?,?,?,?,?)')
        .run(r.project_id, 'document', r.document_id, 'repair_filename', JSON.stringify({ filename: r.filename }), JSON.stringify({ filename: r.fixed }), 'documents');
    }
    db.exec('COMMIT');
  }
  console.log(`${rows.length} name(s) ${flag === '--apply' ? 'repaired' : 'would be repaired (dry run)'}`);
}
