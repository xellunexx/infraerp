// Phase 1 business operations and the event handlers that keep departments in sync.
import { tx, nextCode } from './db.js';
import { on, emit, notify, audit, reindex, bad, HttpError, setting } from './core.js';
import { progressSummary, round2, consumption, scheduleStatus } from './calc.js';
import { validUntil } from './pricing.js';
import { splitSchedule, grossOf } from './payments.js';

/** Lines that count towards the offer: no section, a normal section, or (once confirmed) the chosen alternative. */
export const COUNTED_LINES = `FROM offer_lines l LEFT JOIN offer_sections s ON s.id = l.section_id WHERE l.version_id = ? AND (s.id IS NULL OR s.alternative = 0 OR s.selected = 1)`;

export function offerTotals(db, versionId) {
  const v = db.prepare('SELECT discount_pct, offer_date, validity_months FROM offer_versions WHERE id = ?').get(versionId);
  const vat = Number(setting(db, 'vat_pct', '20')), f = 1 - (v?.discount_pct || 0) / 100;
  const wrap = s => { const net = s.gross * f; return { gross: round2(s.gross), net: round2(net), cost: round2(s.cost), margin: round2(net - s.cost), vat_pct: vat, vat: round2(net * vat / 100), total_with_vat: round2(net * (1 + vat / 100)) }; };
  const all = db.prepare(`SELECT COALESCE(SUM(l.qty * l.unit_price), 0) AS gross, COALESCE(SUM(l.qty * l.unit_cost), 0) AS cost ${COUNTED_LINES}`).get(versionId);
  const sections = db.prepare(`SELECT s.id AS section_id, s.alternative, s.selected, COALESCE(SUM(l.qty * l.unit_price), 0) AS gross, COALESCE(SUM(l.qty * l.unit_cost), 0) AS cost
    FROM offer_sections s LEFT JOIN offer_lines l ON l.section_id = s.id WHERE s.version_id = ? GROUP BY s.id ORDER BY s.sort, s.id`).all(versionId)
    .map(s => ({ section_id: s.section_id, alternative: !!s.alternative, selected: !!s.selected, ...wrap(s) }));
  return { ...wrap(all), sections, valid_until: validUntil(v?.offer_date, v?.validity_months ?? 1) };
}

/** Customer confirmed the offer: lock the version and raise the event. Everything else happens in handlers. */
export function confirmOffer(db, user, offerId, chosenSections = []) {
  return tx(db, () => {
    const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!o) throw new HttpError(404, 'Офертата не е намерена');
    if (o.status === 'confirmed') throw bad('Офертата вече е потвърдена');
    const v = db.prepare('SELECT * FROM offer_versions WHERE offer_id = ? AND version = ?').get(offerId, o.current_version);
    // alternatives (e.g. four padel court variants): the customer confirms specific ones, the rest stay in the offer for the record only
    const alts = db.prepare('SELECT id FROM offer_sections WHERE version_id = ? AND alternative = 1').all(v.id).map(s => s.id);
    const chosen = [...new Set((chosenSections || []).map(Number))].filter(id => alts.includes(id));
    if (alts.length && !chosen.length) throw bad('Офертата съдържа варианти. Изберете кой вариант е потвърдил клиентът.');
    db.prepare('UPDATE offer_sections SET selected = 0 WHERE version_id = ?').run(v.id);
    for (const id of chosen) db.prepare('UPDATE offer_sections SET selected = 1 WHERE id = ?').run(id);
    const n = db.prepare(`SELECT COUNT(*) AS n ${COUNTED_LINES}`).get(v.id).n;
    if (!n) throw bad('Офертата няма редове');
    db.prepare("UPDATE offer_versions SET status = 'confirmed', locked = 1 WHERE id = ?").run(v.id);
    db.prepare("UPDATE offers SET status = 'confirmed', confirmed_version = ?, row_version = row_version + 1 WHERE id = ?").run(v.version, offerId);
    audit(db, user, { entity_type: 'offer', entity_id: offerId, action: 'confirm', before: { status: o.status }, after: { status: 'confirmed', version: v.version }, module: 'offers' });
    const eventId = emit(db, user, { type: 'offer.confirmed', origin: 'offers', entity_type: 'offer', entity_id: offerId, dedupe_key: `offer.confirmed:${offerId}`,
      prev: { status: o.status }, next: { status: 'confirmed', version: v.version, totals: offerTotals(db, v.id) }, affected: ['contracts', 'technical', 'management'] });
    return { event_id: eventId, version: v.version };
  });
}

function snapshotContract(db, projectId) {
  const c = db.prepare('SELECT delivery_deadline, install_start, install_deadline, advance_pct, payment_terms_days, template, special_terms FROM contracts WHERE project_id = ?').get(projectId);
  const lines = db.prepare('SELECT id, sort, code, description, unit, qty, unit_price, unit_cost FROM project_lines WHERE project_id = ? AND removed = 0 ORDER BY sort, id').all(projectId);
  return { terms: c, lines, total: round2(lines.reduce((s, l) => s + l.qty * l.unit_price, 0)) };
}
export function newContractVersion(db, projectId, reason, { amendment_id = null, approved_by = null } = {}) {
  const c = db.prepare('SELECT * FROM contracts WHERE project_id = ?').get(projectId);
  const snap = snapshotContract(db, projectId);
  const version = (db.prepare('SELECT MAX(version) AS v FROM contract_versions WHERE contract_id = ?').get(c.id).v || 0) + 1;
  db.prepare('INSERT INTO contract_versions(contract_id, version, reason, snapshot, total_value, amendment_id, approved_by) VALUES (?,?,?,?,?,?,?)')
    .run(c.id, version, reason, JSON.stringify(snap), snap.total, amendment_id, approved_by);
  db.prepare('UPDATE contracts SET active_version = ?, row_version = row_version + 1 WHERE id = ?').run(version, c.id);
  db.prepare('UPDATE projects SET baseline_version = ?, row_version = row_version + 1 WHERE id = ?').run(version, projectId);
  writeAppendices(db, c.id, projectId, version);
  return { version, total: snap.total };
}
function writeAppendices(db, contractId, projectId, version) {
  const lines = db.prepare('SELECT * FROM project_lines WHERE project_id = ? AND removed = 0 ORDER BY sort, id').all(projectId);
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  const a1 = lines.map((l, i) => `${i + 1}. ${l.code || ''} ${l.description} | ${l.unit} | ${l.qty} | ${l.unit_price.toFixed(2)} | ${(l.qty * l.unit_price).toFixed(2)}`).join('\n');
  const a2 = lines.map((l, i) => `${i + 1}. ${l.description}${l.tech_note ? ' — ' + l.tech_note : ''}`).join('\n');
  const a3 = [`Срок за доставка: ${c.delivery_deadline || 'не е въведен'}`, `Начало на монтажа: ${c.install_start || 'не е въведено'}`, `Краен срок за монтаж: ${c.install_deadline || 'не е въведен'}`,
    `Аванс: ${c.advance_pct}%`, `Срок за плащане: ${c.payment_terms_days} дни`].join('\n');
  const ins = db.prepare('INSERT INTO contract_appendices(contract_id, number, title, body, contract_version) VALUES (?,?,?,?,?) ON CONFLICT(contract_id, number, contract_version) DO UPDATE SET body = excluded.body');
  ins.run(contractId, 1, 'Приложение №1 — Количествено-стойностна сметка (КС)', a1, version);
  ins.run(contractId, 2, 'Приложение №2 — Техническа спецификация', a2, version);
  ins.run(contractId, 3, 'Приложение №3 — Срокове и условия на плащане', a3, version);
}

/** The advance is an explicit number: 0 is a decision, empty is not. */
export function advancePct(v) {
  const n = v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw bad('Въведете аванс % между 0 и 100 (0 = без аванс)');
  return n;
}

export function signContract(db, user, projectId, { signed_on, install_start, install_deadline, advance_pct } = {}) {
  return tx(db, () => {
    const c = db.prepare('SELECT * FROM contracts WHERE project_id = ?').get(projectId);
    if (!c) throw new HttpError(404, 'Няма договор за този обект');
    if (c.status === 'signed') throw bad('Договорът вече е подписан');
    if (c.status !== 'approved') throw bad('Договорът трябва първо да бъде одобрен');
    // Монтажният прозорец се уточнява при подписване — актът го записва атомарно със статуса,
    // защото печатните клаузи са заключени след изпращане и няма друг легален вход за тях.
    const instStart = c.install_start || install_start || null;
    const instEnd = c.install_deadline || install_deadline || null;
    if (!instStart || !instEnd) throw bad('Въведете начало и краен срок за монтаж при подписване');
    if (instEnd < instStart) throw bad('Крайният срок е преди началото на монтажа');
    for (const d of [signed_on, instStart, instEnd]) if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d)))) throw bad('Невалидна дата');
    // договори, одобрени преди правилото: авансът се посочва при подписа и влиза като нова версия, за да съвпада Приложение 3
    if (!c.advance_set) {
      c.advance_pct = advancePct(advance_pct);
      db.prepare('UPDATE contracts SET advance_pct = ?, advance_set = 1 WHERE id = ?').run(c.advance_pct, c.id);
      c.active_version = newContractVersion(db, projectId, 'Уточнен аванс при подписване', { approved_by: user?.id ?? null }).version;
    }
    const signDate = signed_on || new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE contracts SET status = 'signed', signed_on = ?, install_start = ?, install_deadline = ?, row_version = row_version + 1 WHERE id = ?").run(signDate, instStart, instEnd, c.id);

    // Разплащателен график се ражда при подписване: аванс % от договора,
    // междинно 30, окончателно — остатъкът. Ръчно въведени редове не се презаписват.
    const total = db.prepare('SELECT total_value FROM contract_versions WHERE contract_id = ? AND version = ?').get(c.id, c.active_version)?.total_value
      ?? progressSummary(db, projectId).contract_value;
    const vat = Number(setting(db, 'vat_pct', '20')), plan = splitSchedule(total || 0, vat, Number(c.advance_pct));
    const typed = Object.fromEntries(db.prepare('SELECT kind, amount FROM contract_payments WHERE contract_id = ? AND amount IS NOT NULL').all(c.id).map(m => [m.kind, m.amount]));
    const [a, n, f] = plan;
    if (total) {
      if (typed.advance !== undefined && Math.abs(typed.advance - a.net) > 0.01) throw bad(`Авансът в разплащателния график (${typed.advance.toFixed(2)}) не отговаря на ${c.advance_pct}% от договора (${a.net.toFixed(2)})`);
      if (typed.interim !== undefined) { n.net = typed.interim; n.gross = grossOf(n.net, vat); }
      const rest = round2(total - a.net - n.net);
      if (rest < 0 || (typed.final !== undefined && Math.abs(typed.final - rest) > 0.01)) throw bad('Разплащателният график не е равен на договорната стойност');
      f.net = rest; f.gross = round2(grossOf(round2(total), vat) - a.gross - n.gross);
      for (const p of [n, f]) p.pct = typed.interim !== undefined ? round2(p.net / total * 100) : p.pct;
    }
    for (const p of plan) db.prepare(`INSERT INTO contract_payments(contract_id, kind, pct, amount, vat_pct, gross) VALUES (?,?,?,?,?,?)
      ON CONFLICT(contract_id, kind) DO UPDATE SET pct = excluded.pct, amount = excluded.amount, vat_pct = excluded.vat_pct, gross = excluded.gross`)
      .run(c.id, p.kind, p.pct, total ? p.net : null, vat, total ? p.gross : null);

    // Авансовата проформа излиза веднага след подписа — счетоводството я маркира платена,
    // което първо отбелязва етапа в графика и стартира договорния календар.
    const advAmount = db.prepare("SELECT amount FROM contract_payments WHERE contract_id = ? AND kind = 'advance'").get(c.id).amount;
    if (advAmount > 0 && !db.prepare("SELECT 1 FROM proformas WHERE project_id = ? AND kind = 'advance' AND status != 'cancelled'").get(projectId)) {
      const pfId = Number(db.prepare(`INSERT INTO proformas(code, project_id, kind, amount, vat_pct, issued_on, due_on, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(nextCode(db, 'PF'), projectId, 'advance', advAmount, Number(setting(db, 'vat_pct', '20')), signDate,
          new Date(Date.parse(signDate) + (Number(c.payment_terms_days) || 14) * 86400000).toISOString().slice(0, 10),
          'issued', 'Аванс по подписан договор', user?.id ?? null).lastInsertRowid);
      audit(db, user, { project_id: projectId, entity_type: 'proforma', entity_id: pfId, action: 'issue', after: { amount: advAmount, kind: 'advance' }, module: 'accounting' });
      emit(db, user, { type: 'proforma.issued', origin: 'accounting', project_id: projectId, entity_type: 'proforma', entity_id: pfId,
        dedupe_key: `proforma.issued:${pfId}`, next: { amount: advAmount, kind: 'advance' }, affected: ['accounting', 'management'] });
    }
    audit(db, user, { project_id: projectId, entity_type: 'contract', entity_id: c.id, action: 'sign', before: { status: c.status }, after: { status: 'signed' }, module: 'contracts' });
    return emit(db, user, { type: 'contract.signed', origin: 'contracts', project_id: projectId, entity_type: 'contract', entity_id: c.id, dedupe_key: `contract.signed:${c.id}`,
      prev: { status: c.status }, next: { status: 'signed', install_start: instStart, install_deadline: instEnd, delivery_deadline: c.delivery_deadline },
      affected: ['technical', 'warehouse', 'logistics', 'accounting', 'management'] });
  });
}

const MANUAL_PROJECT_STATUSES = new Set(['closed', 'on_hold']);

/** Coarse projects.status = the leading edge of the stage checklist: the phase of the
 *  furthest-progressed (active/done) stage. Pending earlier stages don't hold the status
 *  back — work in progress is work in progress; 'skipped' counts as finished for the
 *  all-done check but does not advance the frontier. Wrap-up stages (completion onward)
 *  read as 'completed'; 'closed'/'on_hold' are manual states, never auto-derived. */
export function deriveProjectStatus(db, projectId) {
  const contract = db.prepare("SELECT status FROM contracts WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(projectId);
  if (!contract || contract.status !== 'signed') return 'contract_pending';
  const stages = db.prepare('SELECT code, sort, status FROM project_stages WHERE project_id = ? ORDER BY sort, id').all(projectId);
  if (stages.every(s => s.status === 'done' || s.status === 'skipped')) return 'completed';
  const progressed = stages.filter(s => s.status === 'active' || s.status === 'done');
  if (!progressed.length) return 'preparation';
  const frontier = progressed[progressed.length - 1];
  const execSort = stages.find(s => s.code === 'execution')?.sort ?? Infinity;
  const wrapSort = stages.find(s => s.code === 'completion')?.sort ?? Infinity;
  return frontier.sort >= wrapSort ? 'completed' : frontier.sort >= execSort ? 'execution' : 'preparation';
}

export function syncProjectStatus(db, projectId) {
  const p = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
  if (!p || MANUAL_PROJECT_STATUSES.has(p.status)) return p?.status ?? null;
  const next = deriveProjectStatus(db, projectId);
  if (next !== p.status) db.prepare('UPDATE projects SET status = ?, row_version = row_version + 1 WHERE id = ?').run(next, projectId);
  return next;
}

export function setStage(db, projectId, code, status, user = null, note = null) {
  const s = db.prepare('SELECT * FROM project_stages WHERE project_id = ? AND code = ?').get(projectId, code);
  if (!s || s.status === status) return false;
  // Печатът на изпълнение живее само докато етапът е done — връщане го чисти (както reopen-ляната)
  // и маркира „reverted“, за да не изглежда върнатият етап все едно е завършен.
  db.prepare(`UPDATE project_stages SET status = ?,
    done_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE NULL END,
    done_by = CASE WHEN ? = 'done' THEN ? ELSE NULL END,
    reverted = CASE WHEN ? NOT IN ('done','skipped') AND status IN ('done','skipped') THEN 1 WHEN ? IN ('done','skipped') THEN 0 ELSE reverted END,
    note = COALESCE(?, note) WHERE id = ?`).run(status, status, status, user?.id ?? null, status, status, note, s.id);
  syncProjectStatus(db, projectId);
  return true;
}

// ---------------------------------------------------------------- handlers
on('offer.confirmed', 'init_project_card', (db, ev) => {
  const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(ev.entity_id);
  if (o.project_id) return { project_id: o.project_id, reused: true };
  const v = db.prepare('SELECT * FROM offer_versions WHERE offer_id = ? AND version = ?').get(o.id, o.confirmed_version);
  const code = nextCode(db, 'PRJ');
  const pid = Number(db.prepare(`INSERT INTO projects(code, name, customer_id, offer_id, site_address, status, customer_questionnaire) VALUES (?,?,?,?,?, 'contract_pending', ?)`)
    .run(code, o.title, o.customer_id, o.id, o.site_address, o.questionnaire || '{}').lastInsertRowid);
  db.prepare('UPDATE offers SET project_id = ? WHERE id = ?').run(pid, o.id);
  db.prepare('UPDATE events SET project_id = ? WHERE id = ?').run(pid, ev.id);
  const insLine = db.prepare(`INSERT INTO project_lines(project_id, sort, source_offer_line_id, smr_type_id, product_id, code, description, unit, qty, unit_price, unit_cost, tech_note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insRec = db.prepare('INSERT INTO project_line_recipe(project_line_id, product_id, norm_per_unit, waste_pct) VALUES (?,?,?,?)');
  const factor = 1 - (v.discount_pct || 0) / 100;
  let n = 0, cursor = 0;
  const sched = db.prepare('INSERT INTO schedule_items(project_id, project_line_id, name, sort, crew) VALUES (?,?,?,?,?)');
  for (const l of db.prepare(`SELECT l.* ${COUNTED_LINES} ORDER BY l.sort, l.id`).all(v.id)) {
    const lid = Number(insLine.run(pid, l.sort, l.id, l.smr_type_id, l.product_id, l.code, l.description, l.unit, l.qty, round2(l.unit_price * factor), l.unit_cost, l.tech_note).lastInsertRowid);
    if (l.smr_type_id) for (const r of db.prepare('SELECT * FROM recipe_items WHERE smr_type_id = ?').all(l.smr_type_id)) insRec.run(lid, r.product_id, r.norm_per_unit, r.waste_pct);
    else if (l.product_id) insRec.run(lid, l.product_id, 1, 0);
    // the linear schedule covers every work line: catalogue СМР rows AND free-text work; pure product lines are procurement, not site work
    if (!l.product_id) { sched.run(pid, lid, l.description, l.sort, String(l.planned_days || 1)); cursor += l.planned_days || 1; } // crew column holds planned days until dates exist
    n++;
  }
  const st = db.prepare('INSERT INTO project_stages(project_id, code, name, department, sort, status) VALUES (?,?,?,?,?,?)');
  const doneCodes = new Set(['inquiry', 'customer_info', 'offer_prep', 'offer_negotiation', 'customer_confirmation']);
  for (const t of db.prepare('SELECT * FROM stage_templates WHERE active = 1 ORDER BY sort').all())
    st.run(pid, t.code, t.name, t.department, t.sort, doneCodes.has(t.code) ? 'done' : t.code === 'contract_generation' ? 'active' : 'pending');
  const cust = db.prepare('SELECT name FROM customers WHERE id = ?').get(o.customer_id);
  reindex(db, 'project', pid, code, o.title, `${cust.name} ${o.site_address || ''}`);
  audit(db, null, { project_id: pid, entity_type: 'project', entity_id: pid, action: 'create_from_offer', after: { code, offer: o.code, version: v.version, lines: n }, module: 'sync' });
  return { project_id: pid, code, lines: n, planned_days: cursor };
});

on('offer.confirmed', 'create_contract_draft', (db, ev) => {
  const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(ev.entity_id);
  const exists = db.prepare('SELECT id, code FROM contracts WHERE project_id = ?').get(o.project_id);
  if (exists) return { contract_id: exists.id, reused: true };
  const code = nextCode(db, 'CTR');
  const cid = Number(db.prepare('INSERT INTO contracts(code, project_id, offer_id, offer_version) VALUES (?,?,?,?)').run(code, o.project_id, o.id, o.confirmed_version).lastInsertRowid);
  writeAppendices(db, cid, o.project_id, 0); // version 0 = draft, becomes v1 when approved
  reindex(db, 'contract', cid, code, o.title, '');
  setStage(db, o.project_id, 'project_card', 'done');
  return { contract_id: cid, code };
});

on('offer.confirmed', 'notify', (db, ev) => {
  const o = db.prepare('SELECT o.*, p.code AS pcode FROM offers o JOIN projects p ON p.id = o.project_id WHERE o.id = ?').get(ev.entity_id);
  ev.project_id = o.project_id;
  return notify(db, ev, { departments: ['contracts', 'technical', 'management'], title: `Потвърдена оферта ${o.code} → обект ${o.pcode}`,
    body: `${o.title}. Създаден е Картон на обекта и проект на договор.`, link: `/projects/${o.project_id}` });
});

on('contract.signed', 'activate_baseline', (db, ev) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(ev.entity_id);
  db.prepare("UPDATE projects SET status = 'preparation', planned_start = ?, planned_end = ?, row_version = row_version + 1 WHERE id = ?").run(c.install_start, c.install_deadline, c.project_id);
  for (const code of ['contract_generation', 'contract_approval', 'project_card']) setStage(db, c.project_id, code, 'done');
  setStage(db, c.project_id, 'technical_review', 'active');
  return { baseline_version: c.active_version, planned_start: c.install_start, planned_end: c.install_deadline };
});

on('contract.signed', 'build_schedule', (db, ev) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(ev.entity_id);
  const items = db.prepare('SELECT * FROM schedule_items WHERE project_id = ? AND start_date IS NULL ORDER BY sort, id').all(c.project_id);
  const add = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
  let cur = c.install_start;
  const upd = db.prepare('UPDATE schedule_items SET start_date = ?, end_date = ?, baseline_start = ?, baseline_end = ?, crew = NULL WHERE id = ?');
  for (const s of items) {
    const days = Math.max(1, parseInt(s.crew, 10) || 1);
    const end = add(cur, days - 1);
    upd.run(cur, end, cur, end, s.id);
    cur = add(end, 1);
  }
  const last = items.length ? add(cur, -1) : null;
  return { items: items.length, schedule_end: last, exceeds_deadline: !!(last && last > c.install_deadline) };
});

on('contract.signed', 'open_procurement', (db, ev) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(ev.entity_id);
  const key = `procure:${c.project_id}`;
  const due = c.delivery_deadline || c.install_start;
  db.prepare(`INSERT INTO tasks(code, project_id, title, description, assignee_dept, due_date, priority, source_event_id, dedupe_key) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`)
    .run(nextCode(db, 'TSK'), c.project_id, 'Заявка за материали по подписан договор', 'Договорът е подписан. Създайте заявка за материали и продукти по КС и рецептите.', 'contracts', due, 'high', ev.id, key);
  db.prepare(`INSERT INTO tasks(code, project_id, title, description, assignee_dept, due_date, priority, source_event_id, dedupe_key) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`)
    .run(nextCode(db, 'TSK'), c.project_id, 'Технически преглед на обекта с Бригадир', 'Прегледайте Картона на обекта, потвърдете логиката на изпълнение и определете Бригадир.', 'technical', c.install_start, 'high', ev.id, `review:${c.project_id}`);
  return { tasks: 2 };
});

on('contract.signed', 'notify', (db, ev) => {
  const p = db.prepare('SELECT p.code, p.name, c.code AS ccode FROM projects p JOIN contracts c ON c.project_id = p.id WHERE p.id = ?').get(ev.project_id);
  const total = progressSummary(db, ev.project_id).contract_value;
  return notify(db, ev, { departments: ['technical', 'warehouse', 'logistics', 'accounting', 'management'], title: `Подписан договор ${p.ccode} — ${p.code}`,
    body: `${p.name}. Договорна стойност ${total.toFixed(2)}. Сроковете и потребностите от материали са активни.`, link: `/projects/${ev.project_id}` });
});

// ------------------------------------------------ Phase 2: execution watch
// Progress/consumption/schedule figures are computed on read, so the work after a
// progress entry is watch-dogging: every alarm materializes as a tracked issue
// (one open issue per product / КС line per kind), never a bare notification.
on('progress.recorded', 'execution_watch', (db, ev) => {
  const pid = ev.project_id;
  if (!pid) return { skipped: true };
  const opened = [];
  const tol = Number(setting(db, 'overconsumption_tolerance_pct', '5'));
  for (const r of consumption(db, pid, tol)) {
    if (!r.over && !r.unplanned) continue;
    if (db.prepare("SELECT 1 FROM issues WHERE project_id = ? AND product_id = ? AND kind = 'overconsumption' AND status = 'open'").get(pid, r.product_id)) continue;
    const title = r.unplanned ? `Непланиран материал: ${r.name}` : `Наднормен разход: ${r.name}`;
    const body = r.unplanned ? `Изразходени ${r.consumed} ${r.unit} без ред в КС/рецепта.`
      : `Очаквано по рецепта за извършеното: ${r.expected} ${r.unit}; изразходено: ${r.consumed} ${r.unit} (допуск ${tol}%).`;
    opened.push(Number(db.prepare(`INSERT INTO issues(code, project_id, kind, severity, title, description, product_id, project_line_id, status, assigned_dept)
      VALUES (?,?,?,?,?,?,?,?,'open','technical')`).run(nextCode(db, 'ISS'), pid, 'overconsumption', 'high', title, body, r.product_id, ev.entity_id ?? null).lastInsertRowid));
  }
  if (ev.entity_id) for (const s of scheduleStatus(db, pid).filter(x => x.project_line_id === ev.entity_id && (x.late_days > 0 || x.behind))) {
    if (db.prepare("SELECT 1 FROM issues WHERE project_id = ? AND project_line_id = ? AND kind = 'schedule_delay' AND status = 'open'").get(pid, s.project_line_id)) continue;
    const body = s.late_days > 0 ? `Срокът ${s.end_date} е минал с ${s.late_days} дни при ${s.pct}% готовност.`
      : `Планирано изпълнение към днес ${s.planned_pct}%, реално ${s.pct}%.`;
    opened.push(Number(db.prepare(`INSERT INTO issues(code, project_id, kind, severity, title, description, project_line_id, status, assigned_dept)
      VALUES (?,?,?,?,?,?,?,'open','technical')`).run(nextCode(db, 'ISS'), pid, 'schedule_delay', 'medium', `Изоставане по график: ${s.name}`, body, s.project_line_id).lastInsertRowid));
  }
  if (opened.length) {
    const p = db.prepare('SELECT code FROM projects WHERE id = ?').get(pid);
    notify(db, ev, { departments: ['technical', 'management'], title: `Сигнали при изпълнение — ${p?.code || pid}`,
      body: `Открити са ${opened.length} нов(и) проблема при дневен отчет (наднормен разход / изоставане).`, link: `/technical/${pid}`, severity: 'warn' });
  }
  return { issues_opened: opened.length, ids: opened };
});

on('progress.voided', 'notify', (db, ev) => notify(db, ev, { departments: ['accounting'], title: 'Анулиран дневен отчет',
  body: `Запис #${ev.prev?.entry_id} (${ev.prev?.qty} от ${ev.prev?.work_date}) е анулиран. Извършените количества се преизчисляват.`, link: `/technical/${ev.project_id}` }));

on('schedule.changed', 'notify', (db, ev) => {
  const n = ev.next || {};
  const body = n.added ? `Нова дейност „${n.name}“ (${n.start_date || '—'} → ${n.end_date || '—'}).`
    : `„${n.name}“: ${ev.prev?.start_date || '—'} → ${ev.prev?.end_date || '—'} става ${n.start_date || '—'} → ${n.end_date || '—'}.`;
  return notify(db, ev, { departments: ['brigadier', 'logistics'], title: 'Промяна в линейния график', body, link: `/technical/${ev.project_id}` });
});

on('task.assigned', 'notify', (db, ev) => {
  const n = ev.next || {};
  return notify(db, ev, { departments: [n.assignee_dept].filter(Boolean), users: [n.assignee_id].filter(Boolean),
    title: `Нова задача ${n.code || ''}`, body: n.title || '', link: ev.project_id ? `/projects/${ev.project_id}` : '/' });
});

// §14.7 reopen: the request goes to Management; the decision reaches every linked role.
on('project.reopen_requested', 'notify', (db, ev) => {
  const p = db.prepare('SELECT code, name FROM projects WHERE id = ?').get(ev.project_id);
  return notify(db, ev, { departments: ['management'], severity: 'warn', title: `Заявка за връщане на ${p?.code || 'обект'} към „${ev.next?.stage_code || ''}“`,
    body: ev.next?.reason || '', link: ev.project_id ? `/projects/${ev.project_id}` : '/' });
});
on('project.reopened', 'notify', (db, ev) => {
  const p = db.prepare('SELECT code FROM projects WHERE id = ?').get(ev.project_id);
  return notify(db, ev, { departments: ['technical', 'brigadier', 'accounting', 'logistics', 'warehouse', 'management'], severity: 'warn',
    title: `Обект ${p?.code || ''} е върнат в изпълнение (етап „${ev.next?.stage_code || ''}“)`, body: `Предишен статус: ${ev.prev?.status || '—'}`,
    link: ev.project_id ? `/projects/${ev.project_id}` : '/' });
});
on('project.reopen_decided', 'notify', (db, ev) => {
  const p = db.prepare('SELECT code FROM projects WHERE id = ?').get(ev.project_id);
  const a = db.prepare("SELECT requested_by FROM approvals WHERE entity_type = 'project' AND entity_id = ? AND kind = 'project_reopen' ORDER BY id DESC").get(ev.project_id);
  return notify(db, ev, { departments: ['management'], users: [a?.requested_by], title: `Заявката за връщане на ${p?.code || 'обект'} е отхвърлена`,
    body: ev.next?.note || '', link: ev.project_id ? `/projects/${ev.project_id}` : '/' });
});

// ---- Склад: заявките и преносите достигат до хората, които ги чакат (§4 sync chain)
on('material_request.submitted', 'notify', (db, ev) => {
  const p = db.prepare('SELECT code FROM projects WHERE id = ?').get(ev.project_id);
  return notify(db, ev, { departments: ['warehouse'], title: `Нова заявка ${ev.next?.code || ''}${p ? ' — ' + p.code : ''}`,
    body: `Позиции: ${ev.next?.items ?? '—'}; от: ${ev.next?.origin || 'manual'}`, link: '/warehouse' });
});
const requesterOf = (db, id) => db.prepare('SELECT code, requested_by FROM material_requests WHERE id = ?').get(id) || {};
on('material_request.approved', 'notify', (db, ev) => {
  const m = requesterOf(db, ev.entity_id);
  return notify(db, ev, { users: [m.requested_by], title: `Заявка ${m.code || ''} е одобрена — материалите са резервирани`, link: '/warehouse' });
});
on('material_request.fulfilled', 'notify', (db, ev) => {
  const m = requesterOf(db, ev.entity_id);
  return notify(db, ev, { users: [m.requested_by], title: `Заявка ${m.code || ''} е изпълнена — изписано от склада`, link: '/warehouse' });
});
on('material_request.cancelled', 'notify', (db, ev) => {
  const m = requesterOf(db, ev.entity_id);
  return notify(db, ev, { users: [m.requested_by], severity: 'warn', title: `Заявка ${m.code || ''} е отменена`, link: '/warehouse' });
});
on('warehouse.transfer', 'notify', (db, ev) => {
  const p = db.prepare('SELECT code FROM projects WHERE id = ?').get(ev.project_id);
  const n = ev.next || {};
  return notify(db, ev, { departments: ['logistics', 'warehouse'], title: `Пренос на ${n.product || 'материал'}: ${p?.code || ''} → ${n.to_project_code || ''}`,
    body: `Количество: ${n.qty ?? '—'}.`, link: '/warehouse' });
});
