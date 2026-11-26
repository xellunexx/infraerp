// т.45: „Спешност" of a project — calculated from the records, with the reasons; the Manager may set a level by hand
// (with a reason) that stands until he clears it (operator, 26.11). Nothing calculated is stored.
import { scheduleStatus } from './calc.js';

export const URGENCY = ['normal', 'urgent', 'very_urgent'];
export const URGENCY_LABEL = { normal: 'Нормално', urgent: 'Спешно', very_urgent: 'Много спешно' };
const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** @param c the contract view (final_deadline, payments) or null */
export function urgencyOf(db, project, c, today = new Date().toISOString().slice(0, 10)) {
  const reasons = [];
  let level = 0;
  const bump = (n, text) => { level = Math.max(level, n); reasons.push({ level: URGENCY[n], text }); };

  // the contract's end: past it, or close to it with work still open
  const end = c?.final_deadline || project.planned_end;
  if (end && !['completed', 'closed'].includes(project.status)) {
    const left = daysBetween(today, end);
    if (left < 0) bump(2, `Крайният срок мина преди ${-left} дн. (${end.split('-').reverse().join('.')})`);
    else if (left <= 7) bump(1, `До крайния срок остават ${left} дн.`);
  }
  // the linear schedule: activities behind their dates
  const late = scheduleStatus(db, project.id, today).filter(s => s.late_days > 0);
  if (late.length) { const worst = Math.max(...late.map(s => s.late_days)); bump(worst > 7 ? 2 : 1, `${late.length} дейност(и) изостават от графика (до ${worst} дн.)`); }
  // payments: a stage past its due date and not paid
  for (const p of c?.payments || []) {
    if (p.paid_at || !p.due_on || p.due_on >= today || p.gross === 0) continue;
    const d = daysBetween(p.due_on, today);
    bump(d > 14 ? 2 : 1, `„${p.label}" е просрочено с ${d} дн.`);
  }
  // open critical / high issues on the site
  const issues = db.prepare(`SELECT severity, COUNT(*) n FROM issues WHERE project_id = ? AND status IN ('open','in_progress') AND severity IN ('critical','high') GROUP BY severity`).all(project.id);
  for (const i of issues) bump(i.severity === 'critical' ? 2 : 1, `${i.n} отворен(и) ${i.severity === 'critical' ? 'критичен' : 'висок'} проблем(а)`);

  const calculated = URGENCY[level];
  const manual = project.urgency_manual && URGENCY.includes(project.urgency_manual)
    ? { level: project.urgency_manual, reason: project.urgency_reason, by: project.urgency_by_name || null, at: project.urgency_at } : null;
  return { level: manual?.level ?? calculated, calculated, manual, reasons };
}
