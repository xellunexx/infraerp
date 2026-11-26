// Т.26: работа извън договора. Заявката е анекс (amendments), който чака одобрение:
//   • до „extra_work_limit" (500 €) — двуфакторно: двама различни души от Оферти/Договори (заявилият се брои, ако е оттам);
//   • над лимита — Управител.
// Одобреният анекс добавя ред в КС (маркиран „извън договора"), нова версия на договора и проформа към Счетоводство;
// плащането, фактурата и изпълнението вървят по обичайния път. Отказаният анекс маха дейността от графика.
import { HttpError, bad, can, audit, emit, setting } from './core.js';
import { nextCode } from './db.js';
import { newContractVersion, linesChanged } from './domain.js';
import { cleanMaterials, parseMaterials } from './materials.js';
import { round2 } from './calc.js';

const DEPTS = ['offers', 'contracts'];
const limitOf = db => Number(setting(db, 'extra_work_limit', '500'));

export function requestExtraWork(db, user, projectId, scheduleItemId, { name, unit, qty, unit_price, note, materials }) {
  const amount = round2(qty * unit_price);
  const code = nextCode(db, 'ANX');
  const id = Number(db.prepare(`INSERT INTO amendments(code, project_id, kind, title, description, changes, status, created_by, amount, unit_price, schedule_item_id)
    VALUES (?,?, 'extra_work', ?,?,?, 'pending', ?,?,?,?)`).run(code, projectId, name, note || null, JSON.stringify({ unit, qty, unit_price, materials }), user.id, amount, unit_price, scheduleItemId).lastInsertRowid);
  db.prepare('UPDATE schedule_items SET amendment_id = ? WHERE id = ?').run(id, scheduleItemId);
  const big = amount > limitOf(db);
  audit(db, user, { project_id: projectId, entity_type: 'amendment', entity_id: id, action: 'request', after: { code, name, unit, qty, unit_price, amount }, module: 'contracts' });
  emit(db, user, { type: 'amendment.requested', origin: 'technical', project_id: projectId, entity_type: 'amendment', entity_id: id, dedupe_key: `amendment.requested:${id}`,
    next: { code, title: name, amount, approver: big ? 'Управител' : 'Оферти/Договори (двама души)' }, approval_status: 'pending', affected: big ? ['management'] : DEPTS });
  return { id, code, amount };
}

export function decideExtraWork(db, user, id, decision, note) {
  const am = db.prepare('SELECT * FROM amendments WHERE id = ?').get(id);
  if (!am) throw new HttpError(404, 'Няма такъв анекс');
  if (am.status !== 'pending') throw bad('Анексът вече е решен');
  const big = am.amount > limitOf(db), manager = can(user, 'approvals', 'approve');
  const fromDept = u => DEPTS.includes(u?.department);
  if (big && !manager) throw new HttpError(403, `Анекс над ${limitOf(db)} € се одобрява от Управител`);
  if (!big && !manager && !fromDept(user)) throw new HttpError(403, 'Анекс до лимита се одобрява от Оферти/Договори');
  if (decision === 'reject') return finish(db, user, am, 'rejected', note);
  if (!big && !manager) {
    // two factors: two different people from Offers/Contracts; the requester counts when they are from there
    const creator = db.prepare('SELECT id, department FROM users WHERE id = ?').get(am.created_by);
    const first = am.first_approved_by ?? (fromDept(creator) ? creator.id : null);
    if (first === user.id) throw bad('Вторият подпис трябва да е от друг човек');
    if (first == null) {
      db.prepare('UPDATE amendments SET first_approved_by = ? WHERE id = ?').run(user.id, id);
      audit(db, user, { project_id: am.project_id, entity_type: 'amendment', entity_id: id, action: 'approve', after: { step: 'първи подпис' }, module: 'contracts' });
      emit(db, user, { type: 'amendment.first_approval', origin: 'contracts', project_id: am.project_id, entity_type: 'amendment', entity_id: id, dedupe_key: `amendment.first:${id}`,
        next: { code: am.code, title: am.title, amount: am.amount }, approval_status: 'pending', affected: DEPTS });
      return { status: 'pending', step: 1 };
    }
  }
  return finish(db, user, am, 'approved', note);
}

function finish(db, user, am, status, note) {
  db.prepare("UPDATE amendments SET status = ?, decided_by = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?").run(status, user.id, note || null, am.id);
  const si = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(am.schedule_item_id);
  let result = { status };
  if (status === 'rejected') {
    if (si) db.prepare('DELETE FROM schedule_items WHERE id = ?').run(si.id);
  } else {
    const ch = JSON.parse(am.changes || '{}');
    const sort = (db.prepare('SELECT MAX(sort) s FROM project_lines WHERE project_id = ?').get(am.project_id).s || 0) + 1;
    const lid = Number(db.prepare(`INSERT INTO project_lines(project_id, sort, code, description, unit, qty, unit_price, unit_cost, tech_note, outside_contract, amendment_id)
      VALUES (?,?,?,?,?,?,?,0,?,1,?)`).run(am.project_id, sort, am.code, am.title, ch.unit, ch.qty, ch.unit_price, am.description, am.id).lastInsertRowid);
    const ins = db.prepare('INSERT INTO project_line_recipe(project_line_id, product_id, norm_per_unit, waste_pct, adjustment_note) VALUES (?,?,?,?,?)');
    for (const m of cleanMaterials(db, ch.materials || [])) ins.run(lid, m.product_id, m.norm_per_unit, m.waste_pct, m.note);
    if (si) db.prepare('UPDATE schedule_items SET project_line_id = ? WHERE id = ?').run(lid, si.id);
    const c = db.prepare('SELECT status FROM contracts WHERE project_id = ?').get(am.project_id);
    if (c?.status === 'signed') result.version = newContractVersion(db, am.project_id, `Анекс ${am.code}: ${am.title}`, { amendment_id: am.id, approved_by: user.id }).version;
    else linesChanged(db, user, am.project_id);
    const pf = Number(db.prepare(`INSERT INTO proformas(code, project_id, kind, amount, vat_pct, issued_on, status, note, created_by, amendment_id) VALUES (?,?, 'other', ?,?, date('now'), 'issued', ?,?,?)`)
      .run(nextCode(db, 'PF'), am.project_id, am.amount, Number(setting(db, 'vat_pct', '20')), `Анекс ${am.code}: ${am.title}`, user.id, am.id).lastInsertRowid);
    result = { ...result, project_line_id: lid, proforma_id: pf };
  }
  audit(db, user, { project_id: am.project_id, entity_type: 'amendment', entity_id: am.id, action: status === 'approved' ? 'approve' : 'reject', after: { status, note: note || null }, module: 'contracts' });
  db.prepare("UPDATE events SET approval_status = ? WHERE entity_type = 'amendment' AND entity_id = ? AND approval_status = 'pending'").run(status, am.id);
  emit(db, user, { type: 'amendment.decided', origin: 'contracts', project_id: am.project_id, entity_type: 'amendment', entity_id: am.id, dedupe_key: `amendment.decided:${am.id}`,
    next: { code: am.code, title: am.title, status, note: note || null }, affected: ['technical', 'contracts', 'accounting', 'brigadier'] });
  return result;
}

export function amendmentsOf(db, projectId) {
  return db.prepare(`SELECT a.*, u.full_name AS created_by_name, f.full_name AS first_approved_by_name, d.full_name AS decided_by_name FROM amendments a
    LEFT JOIN users u ON u.id = a.created_by LEFT JOIN users f ON f.id = a.first_approved_by LEFT JOIN users d ON d.id = a.decided_by
    WHERE a.project_id = ? ORDER BY a.id DESC`).all(projectId).map(a => ({ ...a, changes: JSON.parse(a.changes || '{}'), limit: limitOf(db) }));
}
export { parseMaterials };
