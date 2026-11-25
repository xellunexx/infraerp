// Заявки за промяна: всеки потребител може да заяви редакция или изтриване на запис;
// само администратор решава и заявката се прилага в една транзакция с пълен одит.
import { need, needAdmin, needProject, scopeRows, canSeeMoney, redactMoney, audit, updateRow, reindex, emit, HttpError, bad } from './core.js';
import { h, pick, reqStr } from './app.js';
import { tx, nextCode } from './db.js';
import { advancePct } from './domain.js';
import { settleRow } from './ledger_rules.js';

// ---- колони с числови стойности (по име — общ механизъм, не по конкретен запис)
const NUM_RE = /(^|_)(qty|amount|price|cost|pct|percent|days|hours|beds|pallets|sort|version|latitude|longitude|norm|min_stock|pallet_qty|terms_days|pallets|advance|vat|discount|prelim|validity|labour)/;
const INT_RE = /_id$|^id$/;
const BOOL_RE = /^(active|exceptional|palletized|removed|locked|voided|archived|paid|needs_approval)$/;
const coerce = (key, v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (BOOL_RE.test(key)) return v ? 1 : 0;
  if (INT_RE.test(key)) { const n = Math.round(Number(v)); if (!Number.isFinite(n)) throw bad(`Невалидна числова стойност за ${key}`); return n; }
  if (NUM_RE.test(key)) { const n = Number(v); if (!Number.isFinite(n)) throw bad(`Невалидна числова стойност за ${key}`); return n; }
  return String(v);
};

const COL_LABEL = { name: 'Име', code: 'Код', title: 'Заглавие', description: 'Описание', notes: 'Бележки', note: 'Бележка', status: 'Статус', kind: 'Вид',
  unit: 'Мярка', qty: 'Количество', unit_price: 'Ед. цена', unit_cost: 'Ед. цена на доставка', amount: 'Сума', vat_pct: 'ДДС %',
  phone: 'Телефон', email: 'Имейл', address: 'Адрес', contact_person: 'Лице за контакт', vat_no: 'ЕИК/ДДС',
  site_address: 'Адрес на обекта', customer_id: 'Клиент', project_id: 'Обект', due_date: 'Срок', due_on: 'Падеж',
  planned_date: 'Планирана дата', planned_start: 'Планиран старт', planned_end: 'Планиран край', start_date: 'Начало', end_date: 'Край',
  work_date: 'Работен ден', hours: 'Часове', team: 'Екип', worker: 'Работник', resolution: 'Решение', severity: 'Тежест',
  priority: 'Приоритет', assignee_id: 'Изпълнител', assignee_dept: 'Отдел', carrier: 'Превозвач', plate: 'Рег. номер',
  location: 'Местоположение', category: 'Категория', direction: 'Посока', status_: 'Статус', counterparty: 'Контрагент',
  document_ref: 'Документ', tx_date: 'Дата', issued_on: 'Издадена', needed_by: 'Нужна до', place: 'Място', beds: 'Легла',
  cost_per_night: 'Цена/нощувка', payment_method: 'Начин на плащане', parking: 'Паркинг', workers: 'Работници',
  template: 'Шаблон', special_terms: 'Специални условия', delivery_deadline: 'Срок доставка', install_start: 'Монтаж начало',
  install_deadline: 'Монтаж край', advance_pct: 'Аванс %', payment_terms_days: 'Срок плащане (дни)', readiness_note: 'Бележка за готовност',
  access_notes: 'Достъп', unloading_notes: 'Разтоварване', storage_notes: 'Съхранение', parking_notes: 'Паркинг',
  courier_office: 'Куриерски офис', courier_pallets: 'Палети', payment_urgency: 'Спешност', latitude: 'Гео ширина',
  longitude: 'Гео дължина', geo_label: 'Гео етикет', execution_logic: 'Логика на изпълнение', prelim_days: 'Дни за подготовка',
  attention_to: 'Внимание към', offer_date: 'Дата на оферта', validity_months: 'Валидност (месеци)', discount_pct: 'Отстъпка %',
  tech_note: 'Техническа бележка', date_from: 'От дата', date_to: 'До дата', vehicle_asset_id: 'Превозно средство',
  pallets: 'Палети', palletized: 'Палетирано', unloading: 'Разтоварване', min_stock: 'Мин. склад', pallet_qty: 'Палети/касa',
  unit_price_offer: 'Ед. цена', labour_norm_h: 'Нормирани часове', active: 'Активен', received_on: 'Получена на',
  payment_urgency_: 'Спешност', kind_: 'Вид', office: 'Офис', offer_letter: 'Буква оферти', full_name: 'Име', username: 'Потребител',
  exceptional: 'Извънреден', payee: 'Получател', reason: 'Причина', requested_by: 'Заявен от', created_at: 'Създаден',
};
const colMeta = cols => cols.map(key => ({ key, label: COL_LABEL[key] || key.replace(/_/g, ' ') }));

// ---- регистър на покритите записи: таблица + бели списъци + пикър + незадължителен custom apply
const ENT = {
  customer: { table: 'customers', resource: 'customers', label: 'Клиент', labelOf: r => `${r.code} — ${r.name}`,
    cols: ['name', 'kind', 'vat_no', 'contact_person', 'phone', 'email', 'address', 'notes'],
    picker: db => db.prepare('SELECT id, code, name, phone FROM customers ORDER BY id DESC LIMIT 200').all(),
    reindex: (db, r) => reindex(db, 'customer', r.id, r.code, r.name, [r.contact_person, r.address, r.email, r.phone, r.description, r.vat_no].filter(Boolean).join(' ')) },
  product: { table: 'products', resource: 'catalog', label: 'Продукт', labelOf: r => `${r.code} — ${r.name}`,
    cols: ['name', 'kind', 'unit', 'unit_cost', 'unit_price', 'description', 'min_stock', 'pallet_qty', 'active'],
    picker: db => db.prepare('SELECT id, code, name, unit FROM products WHERE active = 1 ORDER BY id DESC LIMIT 200').all(),
    softDelete: db => db.prepare('UPDATE products SET active = 0 WHERE id = ?'),
    reindex: (db, r) => reindex(db, 'product', r.id, r.code, r.name, [r.description].filter(Boolean).join(' ')) },
  smr: { table: 'smr_types', resource: 'catalog', label: 'СМР вид', labelOf: r => `${r.code} — ${r.name}`,
    cols: ['name', 'unit', 'labour_norm_h', 'description', 'active'],
    picker: db => db.prepare('SELECT id, code, name, unit FROM smr_types WHERE active = 1 ORDER BY id DESC LIMIT 200').all(),
    softDelete: db => db.prepare('UPDATE smr_types SET active = 0 WHERE id = ?'),
    reindex: (db, r) => reindex(db, 'smr', r.id, r.code, r.name, [r.description].filter(Boolean).join(' ')) },
  inquiry: { table: 'inquiries', resource: 'offers', label: 'Запитване', labelOf: r => `${r.code} — ${r.title}`,
    cols: ['title', 'site_address', 'description', 'status', 'received_on'],
    picker: db => db.prepare('SELECT id, code, title, status FROM inquiries ORDER BY id DESC LIMIT 200').all() },
  offer: { table: 'offers', resource: 'offers', label: 'Оферта', labelOf: r => `${r.code} — ${r.title}`,
    cols: ['title', 'site_address', 'readiness_note', 'notes', 'execution_logic', 'prelim_days', 'attention_to', 'offer_date', 'validity_months', 'discount_pct'],
    versionCols: ['notes', 'execution_logic', 'prelim_days', 'attention_to', 'offer_date', 'validity_months', 'discount_pct'],
    picker: db => db.prepare('SELECT id, code, title, status FROM offers ORDER BY id DESC LIMIT 200').all(),
    // offering header fields go to offers; version fields go to the current offer_versions row (same split as PUT /api/offers/:id)
    apply: (db, id, fields, user) => {
      const head = pick(fields, ['title', 'site_address', 'readiness_note']);
      const vf = pick(fields, ['notes', 'execution_logic', 'prelim_days', 'attention_to', 'offer_date', 'validity_months', 'discount_pct']);
      const o = db.prepare('SELECT current_version FROM offers WHERE id = ?').get(id);
      const v = db.prepare('SELECT * FROM offer_versions WHERE offer_id = ? AND version = ?').get(id, o.current_version);
      if (v?.locked && Object.keys(vf).length) throw bad('Текущата версия е заключена — полетата на версията не могат да се променят');
      if (Object.keys(head).length) updateRow(db, 'offers', id, head);
      if (Object.keys(vf).length) db.prepare(`UPDATE offer_versions SET ${Object.keys(vf).map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(vf), v.id);
      return { head: Object.keys(head), version: Object.keys(vf) };
    } },
  project: { table: 'projects', resource: 'projects', label: 'Обект', labelOf: r => `${r.code} — ${r.name}`,
    cols: ['name', 'site_address', 'access_notes', 'unloading_notes', 'storage_notes', 'parking_notes', 'courier_office', 'courier_pallets',
      'payment_urgency', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'latitude', 'longitude', 'geo_label'],
    picker: db => db.prepare('SELECT id, code, name, status FROM projects WHERE archived = 0 ORDER BY id DESC LIMIT 200').all(),
    // обектът не може да изчезне физически (десетки свързани записи) — одобрено „изтриване“ = архивиране, както /api/projects/:id/archive
    softDelete: db => db.prepare(`UPDATE projects SET archived = 1, status = 'closed', row_version = row_version + 1 WHERE id = ?`) },
  project_line: { table: 'project_lines', resource: 'projects', label: 'КС ред', labelOf: r => `${r.code || '#' + r.id} — ${String(r.description || '').slice(0, 60)}`,
    cols: ['code', 'description', 'unit', 'qty', 'unit_price', 'unit_cost', 'tech_note'],
    picker: db => db.prepare(`SELECT l.id, l.code, l.description, p.code AS pcode FROM project_lines l JOIN projects p ON p.id = l.project_id
      WHERE l.removed = 0 ORDER BY l.id DESC LIMIT 200`).all(),
    softDelete: db => db.prepare('UPDATE project_lines SET removed = 1 WHERE id = ?') },
  contract: { table: 'contracts', resource: 'contracts', label: 'Договор', labelOf: r => r.code,
    cols: ['template', 'special_terms', 'delivery_deadline', 'install_start', 'install_deadline', 'advance_pct', 'payment_terms_days'],
    picker: db => db.prepare('SELECT id, code, status FROM contracts ORDER BY id DESC LIMIT 200').all(),
    // договорът носи версии/приложения/плащания още от чернова — заявка за изтриване винаги ще се провали на FK;
    // отказваме я при подаване и сочим истинските пътища (анекс за промени, архив за обекта)
    noDelete: 'Договорът е юридически документ и не се изтрива. Промените се правят с анекс; обектът се затваря чрез архивиране.' },
  transaction: { table: 'transactions', resource: 'finance', label: 'Транзакция', labelOf: r => `${r.code} — ${r.amount}`,
    cols: ['direction', 'category', 'amount', 'status', 'tx_date', 'due_on', 'counterparty', 'document_ref', 'note'],
    picker: db => db.prepare('SELECT id, code, direction, amount, status FROM transactions ORDER BY id DESC LIMIT 200').all() },
  proforma: { table: 'proformas', resource: 'finance', label: 'Проформа', labelOf: r => `${r.code} — ${r.amount}`,
    cols: ['kind', 'amount', 'vat_pct', 'issued_on', 'due_on', 'status', 'note'],
    picker: db => db.prepare('SELECT id, code, kind, amount, status FROM proformas ORDER BY id DESC LIMIT 200').all() },
  payment_request: { table: 'payment_requests', resource: 'finance', label: 'Заявка за плащане', labelOf: r => `${r.code} — ${r.payee}`,
    cols: ['category', 'amount', 'payee', 'reason', 'exceptional'],
    picker: db => db.prepare('SELECT id, code, payee, amount, status FROM payment_requests ORDER BY id DESC LIMIT 200').all() },
  accommodation: { table: 'accommodations', resource: 'finance', label: 'Настаняване', labelOf: r => `${r.place} (${r.date_from || '—'} → ${r.date_to || '—'})`,
    cols: ['place', 'address', 'date_from', 'date_to', 'beds', 'cost_per_night', 'payment_method', 'parking', 'workers', 'note'],
    picker: db => db.prepare(`SELECT a.id, a.place, a.date_from, a.date_to, p.code AS pcode FROM accommodations a JOIN projects p ON p.id = a.project_id
      ORDER BY a.id DESC LIMIT 200`).all() },
  delivery: { table: 'deliveries', resource: 'logistics', label: 'Доставка', labelOf: r => `${r.code} — ${r.status}`,
    cols: ['kind', 'planned_date', 'status', 'carrier', 'courier_office', 'pallets', 'palletized', 'vehicle_asset_id', 'unloading', 'address', 'access_notes', 'note'],
    picker: db => db.prepare('SELECT id, code, planned_date, status FROM deliveries ORDER BY id DESC LIMIT 200').all() },
  asset: { table: 'assets', resource: 'logistics', label: 'Актив', labelOf: r => `${r.code} — ${r.name}`,
    cols: ['name', 'kind', 'plate', 'status', 'location', 'notes'],
    picker: db => db.prepare('SELECT id, code, name, kind, status FROM assets ORDER BY id DESC LIMIT 200').all() },
  asset_allocation: { table: 'asset_allocations', resource: 'logistics', label: 'Разпределение на актив',
    labelOf: r => `актив #${r.asset_id} → обект #${r.project_id} (${r.date_from} → ${r.date_to})`,
    cols: ['date_from', 'date_to', 'status', 'note'],
    picker: db => db.prepare(`SELECT a.id, a.asset_id, a.project_id, a.date_from, a.date_to, a.status FROM asset_allocations a
      ORDER BY a.id DESC LIMIT 200`).all() },
  task: { table: 'tasks', resource: 'tasks', label: 'Задача', labelOf: r => `${r.code} — ${r.title}`,
    cols: ['title', 'description', 'due_date', 'priority', 'status', 'assignee_id', 'assignee_dept'],
    picker: db => db.prepare('SELECT id, code, title, status, due_date FROM tasks ORDER BY id DESC LIMIT 200').all() },
  issue: { table: 'issues', resource: 'progress', label: 'Проблем', labelOf: r => `${r.code} — ${r.title}`,
    cols: ['kind', 'severity', 'title', 'description', 'status', 'resolution', 'assigned_dept'],
    picker: db => db.prepare('SELECT id, code, title, severity, status FROM issues ORDER BY id DESC LIMIT 200').all() },
  schedule_item: { table: 'schedule_items', resource: 'technical', label: 'График', labelOf: r => `${r.name} (${r.start_date || '—'} → ${r.end_date || '—'})`,
    cols: ['name', 'sort', 'start_date', 'end_date', 'depends_on', 'crew'],
    picker: db => db.prepare(`SELECT s.id, s.name, s.start_date, s.end_date, p.code AS pcode FROM schedule_items s JOIN projects p ON p.id = s.project_id
      ORDER BY s.id DESC LIMIT 200`).all() },
  project_stage: { table: 'project_stages', resource: 'projects', label: 'Етап от жизнен цикъл', labelOf: r => `${r.name} [${r.status}]`,
    cols: ['note', 'due_date'],
    picker: db => db.prepare(`SELECT s.id, s.name, s.status, s.due_date, p.code AS pcode FROM project_stages s JOIN projects p ON p.id = s.project_id
      WHERE s.status = 'pending' ORDER BY s.id DESC LIMIT 200`).all() },
  material_request: { table: 'material_requests', resource: 'warehouse', label: 'Заявка за материали', labelOf: r => `${r.code} — ${r.status}`,
    cols: ['needed_by', 'status', 'note'],
    picker: db => db.prepare('SELECT id, code, status, needed_by FROM material_requests ORDER BY id DESC LIMIT 200').all() },
  attendance: { table: 'attendance', resource: 'progress', label: 'Присъствие', labelOf: r => `${r.worker} — ${r.work_date} (${r.hours}ч)`,
    cols: ['work_date', 'hours', 'team'],
    picker: db => db.prepare(`SELECT a.id, a.worker, a.work_date, a.hours, p.code AS pcode FROM attendance a JOIN projects p ON p.id = a.project_id
      ORDER BY a.id DESC LIMIT 200`).all() },
  document: { table: 'documents', resource: 'documents', label: 'Документ', labelOf: r => `${r.title} (v${r.current_version || 1})`,
    cols: ['title', 'category'],
    picker: db => db.prepare('SELECT id, title, category FROM documents ORDER BY id DESC LIMIT 200').all() },
};
export const ENTITY_TYPES = ENT;

const entRow = (db, type, id) => db.prepare(`SELECT * FROM ${ENT[type].table} WHERE id = ?`).get(id);
/** Money already paid and values already signed are not edited around: payments are voided in the ledger, contracts change by annex. */
const signedContract = (db, projectId) => !!db.prepare("SELECT 1 FROM contracts WHERE project_id = ? AND status = 'signed'").get(projectId);
const FROZEN = {
  transaction: (db, r) => ({ keys: ['amount', 'direction', 'status', 'tx_date'], why: 'Сума, посока, състояние и дата се коригират само в книгата',
    del: ['paid', 'reported'].includes(r.status) || r.proforma_id != null || r.contract_payment_id != null || r.supplier_order_id != null || !!db.prepare('SELECT 1 FROM transactions WHERE document_id = ?').get(r.id) }),
  proforma: (db, r) => ({ keys: db.prepare("SELECT 1 FROM transactions WHERE proforma_id = ? AND status IN ('paid', 'reported')").get(r.id) ? ['status', 'amount', 'vat_pct', 'kind'] : ['status'], why: 'Състоянието на проформата следва плащанията' }),
  project_line: (db, r) => signedContract(db, r.project_id) ? { keys: ['qty', 'unit_price'], del: true, why: 'Договорът е подписан — количества и цени се менят само с анекс' } : null,
  contract: (db, r) => r.status !== 'draft' ? { keys: ['advance_pct'], why: 'Договорът е изпратен или подписан — авансът е част от него' } : null,
};
function needUnfrozen(db, type, row, kind, payload) {
  const z = FROZEN[type]?.(db, row);
  if (z && (kind === 'delete' ? z.del : Object.keys(payload || {}).some(k => z.keys.includes(k)))) throw bad(z.why);
  if (type === 'contract' && payload?.advance_pct !== undefined) advancePct(payload.advance_pct);
}

/** The project a record belongs to: the project itself, or the project it hangs on. */
const projectOf = (type, r) => (type === 'project' ? r.id : r.project_id ?? null);
const entityLabel = (db, type, id) => { const r = entRow(db, type, id); return r ? ENT[type].labelOf(r) : `#${id}`; };

function applyEdit(db, type, id, payload, user) {
  const e = ENT[type];
  const fields = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!e.cols.includes(k)) throw bad(`Полето „${k}“ не може да се променя за ${e.label}`);
    fields[k] = coerce(k, v);
  }
  if (!Object.keys(fields).length) throw bad('Няма предложени промени');
  const before = entRow(db, type, id);
  if (!before) throw new HttpError(404, 'Записът не е намерен');
  if (type === 'contract' && fields.advance_pct !== undefined) fields.advance_set = 1;
  const result = e.apply ? e.apply(db, id, fields, user) : updateRow(db, e.table, id, fields);
  const after = entRow(db, type, id);
  if (type === 'transaction') settleRow(db, id, { before, separate: true });
  e.reindex?.(db, after);
  return { before, after, result };
}
function applyDelete(db, type, id, user) {
  const e = ENT[type];
  const before = entRow(db, type, id);
  if (!before) throw new HttpError(404, 'Записът не е намерен');
  // корекциите са одитируеми, никога разрушителни: физическо изтриване, когато е безопасно;
  // при свързани записи типът с надгробен флаг се архивира/деактивира вместо заявката да виси с FK грешка
  if (e.noDelete) throw bad(e.noDelete);
  if (e.softDelete) {
    try { db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).run(id); return { before }; }
    catch { e.softDelete(db).run(id); return { before, result: { archived: true } }; }
  }
  try { db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).run(id); }
  catch (err) { throw bad(`Записът не може да се изтрие (${err.message})`); }
  return { before };
}

export default function mountChangeRequests(app, db) {
  const view = r => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null, result: r.result ? JSON.parse(r.result) : null,
    requester_name: db.prepare('SELECT full_name FROM users WHERE id = ?').get(r.requested_by)?.full_name || null,
    decider_name: r.decided_by ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(r.decided_by)?.full_name || null : null });

  app.get('/api/change-requests/meta', h(() =>
    Object.entries(ENT).map(([type, e]) => ({ type, label: e.label, resource: e.resource, cols: colMeta(e.cols),
      versionCols: e.versionCols ? colMeta(e.versionCols) : undefined }))));

  app.get('/api/change-requests/entities', h(req => {
    const type = String(req.query.type || '');
    const e = ENT[type];
    if (!e) throw bad('Невалиден тип запис');
    need(req.user, e.resource); // заявителят трябва да вижда записа, за да го заяви
    return scopeRows(db, req.user, e.picker(db), r => projectOf(type, entRow(db, type, r.id))).map(r => ({ id: r.id, label: e.labelOf(r), sub: Object.entries(r).filter(([k]) => !['id'].includes(k)).map(([k, v]) => `${k}: ${v}`).join(' · ').slice(0, 160) }));
  }));

  app.get('/api/change-requests', h(req => {
    const scope = String(req.query.scope || 'mine');
    if (scope !== 'mine') needAdmin(req.user);
    const where = scope === 'mine' ? 'WHERE r.requested_by = ?' : scope === 'queue' ? "WHERE r.status = 'pending'" : '';
    const args = scope === 'mine' ? [req.user.id] : [];
    const rows = db.prepare(`SELECT r.*, ru.full_name AS requester_name, du.full_name AS decider_name FROM change_requests r
      JOIN users ru ON ru.id = r.requested_by LEFT JOIN users du ON du.id = r.decided_by
      ${where} ORDER BY r.id DESC LIMIT 300`).all(...args);
    return rows.map(r => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null, result: r.result ? JSON.parse(r.result) : null,
      entity_gone: !entRow(db, r.entity_type, r.entity_id) }));
  }));

  app.post('/api/change-requests', h(req => {
    const b = req.body || {};
    const type = String(b.entity_type || ''), e = ENT[type];
    if (!e) throw bad('Невалиден тип запис');
    need(req.user, e.resource); // need(…, 'read') — заявката не изисква право на запис, но изисква видимост
    const id = Number(b.entity_id);
    if (!Number.isInteger(id) || id < 1) throw bad('Невалиден запис');
    const kind = String(b.kind || '');
    if (!['edit', 'delete'].includes(kind)) throw bad('Видът трябва да е „промяна“ или „изтриване“');
    if (kind === 'delete' && e.noDelete) throw bad(e.noDelete);
    const reason = reqStr(b.reason, 'Причина');
    const row = entRow(db, type, id);
    if (!row) throw new HttpError(404, 'Записът не е намерен');
    const pid = projectOf(type, row);
    if (pid != null) needProject(db, req.user, pid);
    needUnfrozen(db, type, row, kind, b.payload);
    let payload = null;
    if (kind === 'edit' && b.payload != null) {
      if (typeof b.payload !== 'object' || Array.isArray(b.payload)) throw bad('Предложените стойности трябва да са обект');
      for (const k of Object.keys(b.payload)) if (!e.cols.includes(k)) throw bad(`Полето „${k}“ не може да се променя за ${e.label}`);
      if (Object.keys(b.payload).length) payload = JSON.stringify(b.payload);
      // празен/липсващ payload = само сигнализация: администраторът коригира ръчно и затваря заявката
    }
    const out = tx(db, () => {
      const code = nextCode(db, 'CRQ');
      const crid = Number(db.prepare(`INSERT INTO change_requests(code, entity_type, entity_id, kind, payload, reason, entity_label, requested_by)
        VALUES (?,?,?,?,?,?,?,?)`).run(code, type, id, kind, payload, reason, e.labelOf(row), req.user.id).lastInsertRowid);
      audit(db, req.user, { entity_type: 'change_request', entity_id: crid, action: 'request', after: { code, entity_type: type, entity_id: id, kind, payload }, module: 'governance' });
      const ev = emit(db, req.user, { type: 'change_request.created', origin: 'governance', entity_type: 'change_request', entity_id: crid,
        next: { code, entity_label: e.labelOf(row), kind }, affected: ['management'] });
      db.prepare('INSERT INTO notifications(event_id, department, title, body, link, severity) VALUES (?,?,?,?,?,?)')
        .run(ev, 'management', `Заявка за ${kind === 'delete' ? 'изтриване' : 'промяна'}: ${e.labelOf(row)}`, `${reason} — очаква администратор`, '/change-requests?scope=queue', 'warn');
      return { id: crid, code };
    });
    return out;
  }));

  app.get('/api/change-requests/:id', h(req => {
    const r = db.prepare('SELECT * FROM change_requests WHERE id = ?').get(Number(req.params.id));
    if (!r) throw new HttpError(404, 'Заявката не е намерена');
    if (r.requested_by !== req.user.id) needAdmin(req.user);
    const e = ENT[r.entity_type];
    const current = e ? entRow(db, r.entity_type, r.entity_id) : null;
    return { ...view(r), entity_gone: !current, current: canSeeMoney(req.user) ? current : redactMoney(current), cols: e ? colMeta(e.cols) : [], label: e?.label };
  }));

  app.post('/api/change-requests/:id/decide', h(req => {
    needAdmin(req.user);
    const id = Number(req.params.id), b = req.body || {};
    const decision = String(b.decision || '');
    if (!['approve', 'reject'].includes(decision)) throw bad('Решението трябва да е „одобри“ или „откажи“');
    const note = b.note ? String(b.note).slice(0, 2000) : null;
    return tx(db, () => {
      const r = db.prepare('SELECT * FROM change_requests WHERE id = ?').get(id);
      if (!r) throw new HttpError(404, 'Заявката не е намерена');
      if (r.status !== 'pending') throw bad('Заявката вече е решена');
      const e = ENT[r.entity_type];
      if (!e) throw bad('Типът запис не се поддържа');
      let result = null;
      if (decision === 'approve') {
        try {
          const row = entRow(db, r.entity_type, r.entity_id);
          if (row) needUnfrozen(db, r.entity_type, row, r.kind, JSON.parse(r.payload || '{}'));
          if (r.kind === 'delete') result = applyDelete(db, r.entity_type, r.entity_id, req.user);
          else {
            const p = JSON.parse(r.payload || '{}');
            result = Object.keys(p).length ? applyEdit(db, r.entity_type, r.entity_id, p, req.user) : { manual: true };
          }
        } catch (err) { if (err instanceof HttpError) throw err; throw bad(`Неуспешно прилагане: ${err.message}`); }
        audit(db, req.user, { entity_type: 'change_request', entity_id: id, action: 'applied', after: { kind: r.kind, entity_type: r.entity_type, entity_id: r.entity_id, result: result.result ?? null }, module: 'governance' });
      }
      db.prepare(`UPDATE change_requests SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ?,
        applied_at = CASE WHEN ? = 'approve' THEN datetime('now') END, result = ? WHERE id = ?`)
        .run(decision === 'approve' ? 'approved' : 'rejected', req.user.id, note, decision,
          result ? JSON.stringify({ applied: r.kind === 'delete' ? 'delete' : result.manual ? 'manual' : 'update', ...(result.result || {}) }) : null, id);
      audit(db, req.user, { entity_type: 'change_request', entity_id: id, action: decision === 'approve' ? 'approve' : 'reject', after: { note }, module: 'governance' });
      const title = decision === 'approve' ? `Заявката е приложена: ${r.entity_label || r.code}` : `Заявката е отказана: ${r.entity_label || r.code}`;
      db.prepare('INSERT INTO notifications(user_id, title, body, link, severity) VALUES (?,?,?,?,?)')
        .run(r.requested_by, title, note || (decision === 'approve' ? 'Промяната е записана.' : ''), '/change-requests', decision === 'approve' ? 'info' : 'warn');
      return { ok: true, status: decision === 'approve' ? 'approved' : 'rejected' };
    });
  }));
}
