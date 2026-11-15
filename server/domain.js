// Phase 1 business operations and the event handlers that keep departments in sync.
import { tx, nextCode } from './db.js';
import { on, emit, notify, audit, reindex, bad, HttpError, setting } from './core.js';
import { progressSummary, round2 } from './calc.js';
import { validUntil } from './pricing.js';

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

export function signContract(db, user, projectId, signedOn) {
  return tx(db, () => {
    const c = db.prepare('SELECT * FROM contracts WHERE project_id = ?').get(projectId);
    if (!c) throw new HttpError(404, 'Няма договор за този обект');
    if (c.status === 'signed') throw bad('Договорът вече е подписан');
    if (c.status !== 'approved') throw bad('Договорът трябва първо да бъде одобрен');
    if (!c.install_start || !c.install_deadline) throw bad('Въведете начало и краен срок за монтаж преди подписване');
    db.prepare("UPDATE contracts SET status = 'signed', signed_on = ?, row_version = row_version + 1 WHERE id = ?").run(signedOn || new Date().toISOString().slice(0, 10), c.id);
    audit(db, user, { project_id: projectId, entity_type: 'contract', entity_id: c.id, action: 'sign', before: { status: c.status }, after: { status: 'signed' }, module: 'contracts' });
    return emit(db, user, { type: 'contract.signed', origin: 'contracts', project_id: projectId, entity_type: 'contract', entity_id: c.id, dedupe_key: `contract.signed:${c.id}`,
      prev: { status: c.status }, next: { status: 'signed', install_start: c.install_start, install_deadline: c.install_deadline, delivery_deadline: c.delivery_deadline },
      affected: ['technical', 'warehouse', 'logistics', 'accounting', 'management'] });
  });
}

export function setStage(db, projectId, code, status, user = null, note = null) {
  const s = db.prepare('SELECT * FROM project_stages WHERE project_id = ? AND code = ?').get(projectId, code);
  if (!s || s.status === status) return false;
  db.prepare("UPDATE project_stages SET status = ?, done_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE done_at END, done_by = ?, note = COALESCE(?, note) WHERE id = ?").run(status, status, user?.id ?? null, note, s.id);
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
    if (l.smr_type_id) {
      for (const r of db.prepare('SELECT * FROM recipe_items WHERE smr_type_id = ?').all(l.smr_type_id)) insRec.run(lid, r.product_id, r.norm_per_unit, r.waste_pct);
      sched.run(pid, lid, l.description, l.sort, String(l.planned_days || 1)); // crew column holds planned days until dates exist
      cursor += l.planned_days || 1;
    } else if (l.product_id) insRec.run(lid, l.product_id, 1, 0);
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