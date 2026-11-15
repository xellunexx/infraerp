// Derived project figures. Nothing here is stored: every number is computed from the shared records.
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function projectLines(db, projectId) {
  return db.prepare(`SELECT l.*, COALESCE((SELECT SUM(qty) FROM progress_entries p WHERE p.project_line_id = l.id AND p.voided = 0), 0) AS done_qty
    FROM project_lines l WHERE l.project_id = ? AND l.removed = 0 ORDER BY l.sort, l.id`).all(projectId);
}

export function progressSummary(db, projectId) {
  const lines = projectLines(db, projectId);
  let contract = 0, earned = 0, cost = 0, earnedCost = 0;
  for (const l of lines) {
    contract += l.qty * l.unit_price; cost += l.qty * l.unit_cost;
    const done = Math.min(l.done_qty, l.qty);
    earned += done * l.unit_price; earnedCost += l.done_qty * l.unit_cost;
  }
  return { contract_value: r2(contract), cost_price: r2(cost), earned_value: r2(earned), earned_cost: r2(earnedCost),
    progress_pct: contract > 0 ? r2(earned / contract * 100) : 0, lines };
}

/** Theoretical consumption (done qty x norm x waste) next to actual warehouse consumption, per product. */
export function consumption(db, projectId, tolerancePct = 5) {
  const theo = db.prepare(`SELECT r.product_id, SUM(d.done * r.norm_per_unit * (1 + r.waste_pct / 100.0)) AS expected,
      SUM(l.qty * r.norm_per_unit * (1 + r.waste_pct / 100.0)) AS required
    FROM project_lines l JOIN project_line_recipe r ON r.project_line_id = l.id
    JOIN (SELECT pl.id, COALESCE((SELECT SUM(qty) FROM progress_entries p WHERE p.project_line_id = pl.id AND p.voided = 0), 0) AS done FROM project_lines pl) d ON d.id = l.id
    WHERE l.project_id = ? AND l.removed = 0 GROUP BY r.product_id`).all(projectId);
  const actual = db.prepare(`SELECT product_id,
      SUM(CASE WHEN kind = 'consume' THEN qty ELSE 0 END) AS consumed,
      SUM(CASE WHEN kind = 'issue' THEN qty WHEN kind = 'return' THEN -qty WHEN kind = 'transfer_out' THEN -qty WHEN kind = 'transfer_in' THEN qty ELSE 0 END) AS on_site_in
    FROM stock_movements WHERE project_id = ? GROUP BY product_id`).all(projectId);
  const map = new Map();
  for (const t of theo) map.set(t.product_id, { product_id: t.product_id, expected: r3(t.expected), required: r3(t.required), consumed: 0, issued: 0 });
  for (const a of actual) {
    const m = map.get(a.product_id) || { product_id: a.product_id, expected: 0, required: 0, consumed: 0, issued: 0 };
    m.consumed = r3(a.consumed); m.issued = r3(a.on_site_in); map.set(a.product_id, m);
  }
  const prod = db.prepare('SELECT code, name, unit FROM products WHERE id = ?');
  return [...map.values()].map(m => {
    const p = prod.get(m.product_id);
    const limit = m.expected * (1 + tolerancePct / 100);
    return { ...m, ...p, variance: r3(m.consumed - m.expected), on_site: r3(m.issued - m.consumed),
      over: m.consumed > limit + 1e-9, unplanned: m.required === 0 && m.consumed > 0 };
  });
}

/** Money: real transactions and proformas only. Progress-based values are reported separately and never posted. */
export function finance(db, projectId) {
  const p = progressSummary(db, projectId);
  const offer = db.prepare(`SELECT COALESCE(SUM(ol.qty * ol.unit_price), 0) * (1 - ov.discount_pct / 100.0) AS v FROM projects pr JOIN offers o ON o.id = pr.offer_id
    JOIN offer_versions ov ON ov.offer_id = o.id AND ov.version = o.confirmed_version LEFT JOIN offer_lines ol ON ol.version_id = ov.id WHERE pr.id = ?`).get(projectId);
  const t = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN direction = 'in' AND status = 'paid' THEN amount END), 0) AS received,
      COALESCE(SUM(CASE WHEN direction = 'out' AND status = 'paid' THEN amount END), 0) AS paid,
      COALESCE(SUM(CASE WHEN direction = 'out' AND status = 'planned' THEN amount END), 0) AS planned_out,
      COALESCE(SUM(CASE WHEN direction = 'out' AND status = 'committed' THEN amount END), 0) AS payables,
      COALESCE(SUM(CASE WHEN direction = 'in' AND status IN ('planned', 'committed') THEN amount END), 0) AS expected_in
    FROM transactions WHERE project_id = ?`).get(projectId);
  const invoiced = db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM proformas WHERE project_id = ? AND status != 'cancelled'").get(projectId).v;
  const actualExpenses = t.paid + t.payables;
  const plannedExpenses = p.cost_price;
  return {
    contract_value: p.contract_value, offer_value: r2(offer?.v || 0), cost_price: p.cost_price, planned_expenses: r2(plannedExpenses),
    actual_expenses: r2(actualExpenses), payments_made: r2(t.paid), payments_received: r2(t.received), invoiced: r2(invoiced),
    receivables: r2(Math.max(0, invoiced - t.received)), not_invoiced: r2(Math.max(0, p.contract_value - invoiced)), payables: r2(t.payables),
    planned_out: r2(t.planned_out), remaining_budget: r2(plannedExpenses - actualExpenses), planned_result: r2(p.contract_value - plannedExpenses),
    result_to_date: r2(t.received - t.paid), forecast_result: r2(p.contract_value - Math.max(plannedExpenses, actualExpenses)),
    earned_value: p.earned_value, earned_cost: p.earned_cost, progress_pct: p.progress_pct,
    // reconciliation: completed work against what was invoiced / received and against what was actually spent
    work_not_invoiced: r2(Math.max(0, p.earned_value - invoiced)), cost_variance: r2(actualExpenses - p.earned_cost),
  };
}

export function scheduleStatus(db, projectId, today = new Date().toISOString().slice(0, 10)) {
  const items = db.prepare(`SELECT s.*, l.qty AS line_qty, COALESCE((SELECT SUM(qty) FROM progress_entries p WHERE p.project_line_id = s.project_line_id AND p.voided = 0), 0) AS done_qty
    FROM schedule_items s LEFT JOIN project_lines l ON l.id = s.project_line_id WHERE s.project_id = ? ORDER BY s.sort, s.id`).all(projectId);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  return items.map(s => {
    const pct = s.line_qty > 0 ? Math.min(100, r2(s.done_qty / s.line_qty * 100)) : null;
    let planned = null, late_days = 0;
    if (s.start_date && s.end_date) {
      const total = Math.max(1, days(s.start_date, s.end_date) + 1);
      planned = today < s.start_date ? 0 : today > s.end_date ? 100 : r2((days(s.start_date, today) + 1) / total * 100);
      if (pct != null && pct < 100 && today > s.end_date) late_days = days(s.end_date, today);
    }
    const slip = s.baseline_end && s.end_date ? days(s.baseline_end, s.end_date) : 0;
    return { ...s, pct, planned_pct: planned, late_days, slip_days: slip, behind: pct != null && planned != null && pct + 10 < planned };
  });
}

export function stock(db) {
  return db.prepare(`SELECT p.id, p.code, p.name, p.kind, p.unit, p.min_stock, p.unit_cost,
      COALESCE((SELECT SUM(CASE kind WHEN 'receipt' THEN qty WHEN 'return' THEN qty WHEN 'adjust' THEN qty WHEN 'issue' THEN -qty ELSE 0 END) FROM stock_movements m WHERE m.product_id = p.id), 0) AS on_hand,
      COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.product_id = p.id AND r.status = 'active'), 0) AS reserved
    FROM products p WHERE p.active = 1 ORDER BY p.code`).all().map(s => ({ ...s, on_hand: r3(s.on_hand), reserved: r3(s.reserved), free: r3(s.on_hand - s.reserved), low: s.on_hand - s.reserved < s.min_stock }));
}
export const round2 = r2, round3 = r3;