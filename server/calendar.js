// т.4, 5, 14: „Календар на договора" — one source for every place that shows the contract on a time line
// (Договор и приложения, Разплащателен график, Финанси). Everything is read from the records themselves:
// the contract view (signing, advance, terms in days, final deadline), the payment stages and the ledger, deliveries, the linear schedule.
// Nothing is stored here. Amounts are left out for whoever may not see money.
import { can, canSeeMoney } from './core.js';
import { scheduleStatus } from './calc.js';
import { recordLink } from './links.js';

const DAY = 86400000;
const plus = (iso, days) => new Date(Date.parse(iso) + Math.round(Number(days)) * DAY).toISOString().slice(0, 10);

/** @returns {{ today, lanes: { key, title, items: { id, kind:'point'|'range', date?, start?, end?, label, sub?, state, link? }[] }[] }} */
export function contractCalendar(db, user, projectId, c, today = new Date().toISOString().slice(0, 10)) {
  const money = canSeeMoney(user);
  const lanes = [];
  const contractLink = `/projects/${projectId}?tab=contract`;

  // ---- the contract: signing, advance, production + delivery, installation, final deadline
  if (c) {
    const it = [];
    const unpaid = (c.payments || []).some(p => p.gross !== 0 && !p.paid_at);
    if (c.signed_on) it.push({ id: 'signed', kind: 'point', date: c.signed_on, label: 'Подписан', state: 'done', link: contractLink });
    if (c.advance_paid_at) it.push({ id: 'advance', kind: 'point', date: c.advance_paid_at, label: 'Аванс платен', state: 'done', link: contractLink });
    if (c.deadline_start && c.prod_delivery_days != null) {
      const end = plus(c.deadline_start, c.prod_delivery_days);
      it.push({ id: 'production', kind: 'range', start: c.deadline_start, end, label: 'Производство и доставка', state: end < today ? 'done' : today >= c.deadline_start ? 'active' : 'pending', link: contractLink });
    } else if (c.delivery_due) it.push({ id: 'delivery_due', kind: 'point', date: c.delivery_due, label: 'Доставка до (прогноза)', state: 'pending', link: contractLink });
    const iStart = c.install_start, iEnd = c.install_deadline || c.final_deadline;
    if (iStart && iEnd) it.push({ id: 'install', kind: 'range', start: iStart, end: iEnd < iStart ? iStart : iEnd, label: 'Монтаж', state: iEnd < today ? 'done' : today >= iStart ? 'active' : 'pending', link: contractLink });
    if (c.final_deadline) it.push({ id: 'final', kind: 'point', date: c.final_deadline, label: 'Краен срок', state: c.final_deadline < today ? (unpaid ? 'late' : 'done') : 'pending', link: contractLink });
    lanes.push({ key: 'contract', title: 'Договор', items: it });

    // ---- payments: every stage on its date — paid on the bank date, otherwise its due date; overdue when unpaid past due
    const pay = [];
    for (const p of c.payments || []) {
      if (p.gross === 0) continue;
      const date = p.paid_at || p.due_on;
      const amount = money && p.gross != null ? p.gross : null;
      const state = p.paid_at ? 'done' : p.due_on && p.due_on < today ? 'late' : p.paid > 0 ? 'active' : 'pending';
      const sub = [p.paid_at ? 'платено' : p.paid > 0 ? 'частично' : p.due_on ? 'падеж' : null, p.due_note && !p.paid_at ? p.due_note : null].filter(Boolean).join(' · ');
      if (date) pay.push({ id: `pay-${p.id}`, kind: 'point', date, label: p.label, sub, amount, state, link: contractLink });
      else pay.push({ id: `pay-${p.id}`, kind: 'undated', label: p.label, sub: p.due_note || 'без дата', amount, state, link: contractLink });
    }
    lanes.push({ key: 'payments', title: 'Плащания', items: pay });
  }

  // ---- deliveries (Logistics' records) — on their planned date
  if (can(user, 'logistics')) {
    const rows = db.prepare(`SELECT id, code, planned_date, status, kind FROM deliveries WHERE project_id = ? AND planned_date IS NOT NULL ORDER BY planned_date`).all(projectId);
    lanes.push({ key: 'deliveries', title: 'Доставки', items: rows.map(d => ({ id: `dl-${d.id}`, kind: 'point', date: d.planned_date, label: d.code,
      sub: { planned: 'планирана', in_transit: 'на път', delivered: 'доставена', cancelled: 'отменена' }[d.status] || d.status,
      state: d.status === 'delivered' ? 'done' : d.status === 'cancelled' ? 'cancelled' : d.planned_date < today ? 'late' : d.status === 'in_transit' ? 'active' : 'pending',
      link: recordLink('delivery', d.id, projectId) })) });
  }

  // ---- activities of the linear schedule (Technical) — out-of-contract work is marked
  if (can(user, 'technical')) {
    const items = scheduleStatus(db, projectId, today).filter(s => s.start_date && s.end_date);
    lanes.push({ key: 'activities', title: 'Дейности', items: items.map(s => ({ id: `sc-${s.id}`, kind: 'range', start: s.start_date, end: s.end_date, label: s.name,
      sub: s.amendment_id ? 'извън договора' : s.pct != null ? `${Math.round(s.pct)}%` : null,
      state: s.pct >= 100 ? 'done' : s.late_days > 0 ? 'late' : today >= s.start_date ? 'active' : 'pending', extra: !!s.amendment_id,
      link: recordLink('schedule_item', s.id, projectId) })) });
  }
  return { today, lanes };
}
