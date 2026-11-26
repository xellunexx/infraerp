// Д1 (т.39): кой научава за всеки вид събитие — едно място за целия ERP, като links.js за връзките.
// A route records what happened (record()/emit()); this map decides who is told. Rules:
//   • a spec returns { departments, users } — the departments 'technical' and 'brigadier' reach the project's own
//     technician / brigadier when the project has one (notify() in core.js), the whole department otherwise;
//   • FEED = recorded in the project's timeline and the audit, no notification (a Slack channel: all there, not all ping);
//   • for a type that has its own handler (domain.js, routes_*.js) the spec ADDS recipients to the handler's;
//     for a type with no handler it is the whole list (no spec → the emit's `affected`, as before);
//   • nobody is ever notified of their own action (core.js).
// Recipients are people who must act or know; money in the text is hidden from those who may not see it (core.js).

export const FEED = Object.freeze({ feed: true });

const people = (db, sql, ...args) => db.prepare(sql).all(...args).map(r => Object.values(r)[0]).filter(Boolean);
const contractOf = (db, projectId) => db.prepare('SELECT status FROM contracts WHERE project_id = ?').get(projectId) || {};
const SITE = ['technical', 'brigadier'];
const ALL_PROJECT = ['technical', 'brigadier', 'logistics', 'warehouse', 'accounting', 'management'];
const to = (departments = [], users = []) => ({ departments, users });

export const ROUTING = {
  // ---- only in the timeline (catalogue, templates, sales pipeline, daily facts)
  'customer.created': FEED, 'customer.updated': FEED, 'product.created': FEED, 'product.updated': FEED,
  'smr.created': FEED, 'smr.updated': FEED, 'smr.recipe_changed': FEED,
  'offer_template.created': FEED, 'offer_template.updated': FEED, 'catalog.attached': FEED,
  'inquiry.created': FEED, 'inquiry.updated': FEED, 'offer.created': FEED, 'offer.updated': FEED,
  'accountable_person.created': FEED, 'accountable_person.updated': FEED, 'cost_center.created': FEED, 'cost_center.updated': FEED,
  'attendance.recorded': FEED,
  'message.created': FEED, // Д3 adds @mentions and the unread count

  // ---- control without approval: the Manager knows (operator, 26.11)
  'user.created': () => to(['management']), 'user.updated': () => to(['management']), 'user.overrides_changed': () => to(['management']),
  'permissions.changed': () => to(['management']), 'settings.changed': () => to(['management']),

  // ---- the contract and its payment plan
  // before signing Accounting and the Manager always know (operator, 26.11); after it every department that plans by the dates
  'contract.updated': (db, ev) => contractOf(db, ev.project_id).status === 'draft' ? to(['accounting', 'management']) : to(ALL_PROJECT),
  'contract_payment.changed': (db, ev) => to(contractOf(db, ev.project_id).status === 'signed' ? ['accounting', 'contracts', 'management'] : ['accounting', 'management']),
  'contract_payment.removed': (db, ev) => to(contractOf(db, ev.project_id).status === 'signed' ? ['accounting', 'contracts', 'management'] : ['accounting', 'management']),
  'contract_payment.unmatched_cleared': () => to(['contracts']),

  // ---- the ledger
  'transaction.corrected': (db, ev) => to(['contracts', 'management', ...(ev.next?.supplier_order_id ? ['logistics'] : [])]),
  'payment.merged': (db, ev) => to(['contracts'], [ev.next?.reporter_id]),
  // a ledger row that pays a client document moves the contract's „платено" — the same people as „Запиши плащане"
  'transaction.recorded': (db, ev) => {
    const t = db.prepare('SELECT direction, proforma_id, contract_payment_id FROM transactions WHERE id = ?').get(ev.entity_id);
    return to(['accounting', ...(t?.direction === 'in' && (t.proforma_id || t.contract_payment_id) ? ['contracts', 'technical'] : [])]);
  },
  // the advance starts the contract clock: everyone who plans by it (handler already tells Contracts and the technician)
  'contract.payment_recorded': (db, ev) => {
    const t = db.prepare(`SELECT t.direction, COALESCE(m.kind, pf.kind) AS kind FROM transactions t LEFT JOIN contract_payments m ON m.id = t.contract_payment_id
      LEFT JOIN proformas pf ON pf.id = t.proforma_id WHERE t.id = ?`).get(ev.entity_id);
    return t?.direction === 'in' && t.kind === 'advance' ? to(['logistics', 'warehouse', 'brigadier', 'management']) : to();
  },
  'accommodation.updated': () => to(['logistics', 'brigadier']),

  // ---- the project
  'project.site_changed': () => to([...SITE, 'logistics']),
  'project.on_hold': () => to(ALL_PROJECT), 'project.resumed': () => to(ALL_PROJECT),
  'project.archived': () => to(ALL_PROJECT), 'project.unarchived': () => to(ALL_PROJECT),
  'project.urgency_set': () => to(ALL_PROJECT),
  // the next stage's owner learns that it is their turn (handler-less type: the stage's own department + the next one)
  'stage.changed': (db, ev) => {
    const s = db.prepare('SELECT department, sort, project_id FROM project_stages WHERE id = ?').get(ev.entity_id);
    const next = ev.next?.status === 'done' && s ? db.prepare("SELECT department FROM project_stages WHERE project_id = ? AND sort > ? AND status NOT IN ('done','skipped') ORDER BY sort LIMIT 1").get(s.project_id, s.sort) : null;
    return to([...new Set([s?.department, next?.department].filter(Boolean))]);
  },

  // ---- tasks and issues
  'task.done': (db, ev) => to([], people(db, 'SELECT created_by FROM tasks WHERE id = ?', ev.entity_id)),
  'task.reopened': (db, ev) => {
    const t = db.prepare('SELECT created_by, assignee_id, assignee_dept FROM tasks WHERE id = ?').get(ev.entity_id) || {};
    return to(t.assignee_id ? [] : [t.assignee_dept].filter(Boolean), [t.created_by, t.assignee_id]);
  },
  'issue.updated': (db, ev) => {
    const i = db.prepare('SELECT assigned_dept, reported_by FROM issues WHERE id = ?').get(ev.entity_id) || {};
    return to([i.assigned_dept].filter(Boolean), [i.reported_by]);
  },
  // a system issue (execution watch) has no reporter: the department it was given learns it is closed
  'issue.resolved': (db, ev) => {
    const i = db.prepare('SELECT assigned_dept, reported_by FROM issues WHERE id = ?').get(ev.entity_id) || {};
    return i.reported_by ? to() : to([i.assigned_dept].filter(Boolean));
  },

  // ---- materials, deliveries, equipment, orders
  'material_request.approved': () => to([...SITE, 'logistics']),
  'material_request.fulfilled': () => to([...SITE, 'logistics']),
  'delivery.updated': () => to(['warehouse', ...SITE]),
  'schedule.changed': () => to(['warehouse']),
  'asset.created': () => to(['technical']),
  'asset.updated': (db, ev) => {
    // the machine is booked on live projects: their technician and brigadier plan with it
    const sites = db.prepare(`SELECT DISTINCT p.technical_id, p.brigadier_id FROM asset_allocations a JOIN projects p ON p.id = a.project_id
      WHERE a.asset_id = ? AND a.status IN ('planned','active')`).all(ev.entity_id);
    return to(['logistics'], sites.flatMap(p => [p.technical_id, p.brigadier_id]));
  },
  'asset.allocated': () => to(['brigadier']),
  'asset_allocation.updated': () => to([...SITE, 'logistics']),
  'supplier_order.created': () => to(['accounting', 'logistics', 'warehouse']),
  'supplier_order.updated': () => to(['accounting', 'logistics', 'warehouse']),

  // ---- offers
  'offer.send': () => to(['management']), 'offer.revise': () => to(['management']), 'offer.reject': () => to(['management', 'contracts']),
};

/** Write routes that may stay without an event — each with the reason (test/slack_guard.test.mjs keeps this honest). */
export const EXEMPT = {
  'POST /api/auth/setup': 'първа настройка на системата — няма на кого да се съобщи',
  'POST /api/auth/login': 'лично действие (вход), пише само сесия',
  'POST /api/auth/logout': 'лично действие (изход)',
  'POST /api/notifications/read': 'лично действие — отбелязва прочетено',
  'POST /api/projects/:id/weather/refresh': 'техническо: обновява прогнозата от външен източник',
  'POST /api/events/:id/retry': 'техническо: повтаря вече записано събитие',
};

/** @returns {{departments: string[], users: number[]} | {feed: true} | null} null = no spec for this type */
export function recipientsOf(db, ev) {
  // a change approved through a change request reaches the same people as an edit of that kind of record (timeline only if none)
  const spec = ROUTING[ev.type] ?? (ev.type?.endsWith('.changed_by_request') ? ROUTING[ev.type.replace('.changed_by_request', '.updated')] ?? FEED : undefined);
  if (!spec) return null;
  if (spec === FEED) return FEED;
  const r = spec(db, ev) || {};
  return { departments: [...new Set(r.departments || [])], users: [...new Set((r.users || []).filter(Boolean))] };
}
