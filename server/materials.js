// Материали и консумативи по ред: задават се в офертата (offer_lines.materials) и стават рецепта на реда от КС
// (project_line_recipe) — едно място, от което четат количествената сметка, заявките, складът и бригадирът.
import { bad, audit, emit } from './core.js';
import { num } from './app.js';

/** Validates a list of {product_id, norm_per_unit, waste_pct?, note?} against the catalogue. */
export function cleanMaterials(db, list, where = '') {
  if (list == null || list === '') return [];
  if (!Array.isArray(list)) throw bad(`${where}материалите трябва да са списък`);
  const seen = new Set();
  return list.map((m, i) => {
    const pid = Number(m.product_id);
    if (!pid || !db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) throw bad(`${where}материал ${i + 1}: няма такъв продукт в номенклатурата`);
    if (seen.has(pid)) throw bad(`${where}материал ${i + 1}: продуктът е два пъти`); seen.add(pid);
    return { product_id: pid, norm_per_unit: num(m.norm_per_unit, 'Норма', { min: 0.000001 }), waste_pct: num(m.waste_pct ?? 0, 'Фира %', { min: 0 }), note: m.note ? String(m.note).slice(0, 300) : null };
  });
}
export const parseMaterials = s => { if (!s) return []; try { const x = JSON.parse(s); return Array.isArray(x) ? x : []; } catch { return []; } };

/** Materials of КС lines with product names, keyed by line id. */
export function lineMaterials(db, lineIds) {
  const m = new Map(lineIds.map(id => [id, []]));
  if (!lineIds.length) return m;
  for (const r of db.prepare(`SELECT r.project_line_id, r.product_id, r.norm_per_unit, r.waste_pct, r.adjustment_note AS note, p.code, p.name, p.unit
    FROM project_line_recipe r JOIN products p ON p.id = r.product_id WHERE r.project_line_id IN (${lineIds.map(() => '?').join(',')}) ORDER BY p.name`).all(...lineIds))
    m.get(r.project_line_id)?.push(r);
  return m;
}

/** Replace the recipe of one КС line (project side). A reason is required; the change is audited and told to the people who use it. */
export function setLineMaterials(db, user, lineId, items, reason) {
  const line = db.prepare('SELECT * FROM project_lines WHERE id = ? AND removed = 0').get(lineId);
  if (!line) throw bad('Няма такъв ред от КС');
  if (!String(reason || '').trim()) throw bad('Напишете причината за промяната на материалите');
  const list = cleanMaterials(db, items);
  const before = db.prepare('SELECT product_id, norm_per_unit, waste_pct FROM project_line_recipe WHERE project_line_id = ?').all(lineId);
  db.prepare('DELETE FROM project_line_recipe WHERE project_line_id = ?').run(lineId);
  const ins = db.prepare('INSERT INTO project_line_recipe(project_line_id, product_id, norm_per_unit, waste_pct, adjustment_note) VALUES (?,?,?,?,?)');
  for (const m of list) ins.run(lineId, m.product_id, m.norm_per_unit, m.waste_pct, m.note);
  audit(db, user, { project_id: line.project_id, entity_type: 'project_line', entity_id: lineId, action: 'materials', before: { materials: before }, after: { materials: list, reason }, module: 'technical' });
  emit(db, user, { type: 'project_line.materials_changed', origin: 'technical', project_id: line.project_id, entity_type: 'project_line', entity_id: lineId,
    dedupe_key: `project_line.materials_changed:${lineId}:${Date.now()}`, next: { description: line.description, reason }, affected: ['warehouse', 'logistics', 'brigadier'] });
  return lineMaterials(db, [lineId]).get(lineId);
}
