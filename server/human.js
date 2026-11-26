// Хронология и одит, четими от човек: изречение + списък „поле: старо → ново" на български.
// Едно място за имената на събития, действия, записи и полета — страниците само показват готовия текст.
export const EVENT_LABEL = {
  'offer.confirmed': 'Потвърдена оферта', 'contract.submitted': 'Договорът е изпратен за одобрение', 'contract.signed': 'Подписан договор',
  'contract.payment_recorded': 'Плащане по договора', 'payment.rejected': 'Отказано плащане', 'project.assigned': 'Смяна на отговорник',
  'stage.changed': 'Промяна на етап', 'progress.recorded': 'Отчетено изпълнение', 'progress.voided': 'Анулиран отчет', 'schedule.changed': 'Промяна в линейния график',
  'issue.reported': 'Докладван проблем', 'issue.resolved': 'Решен проблем', 'task.assigned': 'Нова задача',
  'project.reopen_requested': 'Заявка за връщане на обекта', 'project.reopened': 'Обектът е върнат в изпълнение', 'project.reopen_decided': 'Решение по връщането',
  'supplier_order.created': 'Нова поръчка към доставчик', 'material_request.submitted': 'Заявка за материали', 'material_request.approved': 'Одобрена заявка за материали',
  'material_request.fulfilled': 'Изпълнена заявка за материали', 'material_request.cancelled': 'Отменена заявка за материали',
  'warehouse.transfer': 'Пренос на материали', 'warehouse.movement': 'Складово движение', 'delivery.created': 'Планирана доставка',
  'delivery.delivered': 'Доставката е пристигнала', 'delivery.cancelled': 'Отменена доставка', 'asset.allocated': 'Разпределена техника',
  'proforma.issued': 'Издадена проформа', 'proforma.paid': 'Платена проформа', 'proforma.cancelled': 'Анулирана проформа',
  'payment_request.created': 'Заявка за плащане', 'payment_request.decided': 'Решение по заявка за плащане', 'transaction.recorded': 'Запис в книгата',
  'accommodation.recorded': 'Настаняване', 'document.uploaded': 'Качен документ', 'document.versioned': 'Нова версия на документ',
  'change_request.created': 'Заявка за промяна',
};
const ACTION = {
  create: 'създаде', add: 'добави', update: 'промени', write: 'промени', upsert: 'записа', replace: 'замени', save_lines: 'записа редовете на',
  upload: 'качи', new_version: 'качи нова версия на', attach: 'прикачи', confirm: 'потвърди', sign: 'подписа', approve: 'одобри', reject: 'отказа',
  cancel: 'отмени', void: 'анулира', paid: 'отбеляза като платена', send: 'изпрати', request: 'заяви', report: 'докладва', fulfil: 'изпълни',
  issue: 'изписа', transfer: 'прехвърли', status: 'смени статуса на', revise: 'направи ревизия на', applied: 'приложи', payment_plan: 'промени графика за плащане на',
  payment_confirm: 'потвърди плащане по', payment_reject: 'отказа плащане по', payment_merge: 'обедини плащане по', reopen_request: 'поиска връщане на',
  clear_unmatched_date: 'изчисти непотвърдената дата на', create_from_offer: 'създаде от оферта', repair_filename: 'поправи името на файла на',
  overrides: 'промени правата на', retry: 'повтори', sweep: 'провери', failed: 'неуспешно действие по', setup_admin: 'настрои администратор',
  share_brigade: 'изпрати на бригадира', unshare_brigade: 'спря за бригадира',
};
const ENTITY = {
  project: 'обекта', contract: 'договора', document: 'документа', delivery: 'доставка', issue: 'проблем', task: 'задача', offer: 'офертата',
  proforma: 'проформа', transaction: 'запис в книгата', payment_request: 'заявка за плащане', material_request: 'заявка за материали',
  supplier_order: 'поръчка към доставчик', progress_entry: 'отчет за изпълнение', schedule_item: 'дейност в графика', project_line: 'ред от КС',
  stage: 'етап', asset: 'техника', asset_allocation: 'разпределение на техника', accommodation: 'настаняване', stock_movement: 'складово движение',
  change_request: 'заявка за промяна', message: 'съобщение', recipe: 'рецепта', product: 'продукт', user: 'потребител', settings: 'настройките',
};
const FIELD = {
  status: 'Статус', title: 'Заглавие', name: 'Име', amount: 'Сума', qty: 'Количество', unit: 'Мярка', note: 'Бележка', reason: 'Причина',
  description: 'Описание', category: 'Категория', filename: 'Файл', version: 'Версия', code: 'Номер', technical_id: 'Техник', brigadier_id: 'Бригадир',
  site_address: 'Адрес', planned_date: 'Планирана дата', planned_start: 'Начало', planned_end: 'Край', start_date: 'Начало', end_date: 'Край',
  signed_on: 'Подписан на', install_start: 'Начало на монтажа', install_deadline: 'Краен срок за монтаж', paid_at: 'Платено на', tx_date: 'Дата',
  pct: '%', kind: 'Вид', payee: 'Получател', supplier: 'Доставчик', carrier: 'Превозвач', pallets: 'Палети', work_date: 'Дата на работа',
  stage_code: 'Етап', advance_pct: 'Аванс %', total: 'Общо', total_value: 'Стойност', vat_pct: 'ДДС %', exceptional: 'Над лимита', size: 'Размер',
  access_notes: 'Достъп', unloading_notes: 'Разтоварване', storage_notes: 'Съхранение', parking_notes: 'Паркиране', courier_office: 'Куриерски офис',
  payment_urgency: 'Спешност', shared_with_brigade: 'За бригадира', crew: 'Хора', depends_on: 'Зависи от', items: 'Артикули',
};
const STATUS = { draft: 'чернова', sent: 'изпратена', confirmed: 'потвърдена', submitted: 'подадена', approved: 'одобрена', rejected: 'отхвърлена', signed: 'подписан',
  pending: 'чака', paid: 'платено', reported: 'докладвано', committed: 'дължимо', planned: 'планирано', in_transit: 'на път', delivered: 'доставено',
  cancelled: 'отменено', voided: 'анулирано', open: 'отворен', resolved: 'решен', done: 'готово', execution: 'в изпълнение', closed: 'закрит', fulfilled: 'изпълнена' };

const parse = v => { if (v == null || v === '') return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
const DATE = /^\d{4}-\d{2}-\d{2}/;
function show(db, key, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'не';
  if (/_id$/.test(key) && ['technical_id', 'brigadier_id', 'user_id', 'assignee_id'].includes(key) && db) return db.prepare('SELECT full_name FROM users WHERE id = ?').get(v)?.full_name || `#${v}`;
  if (key === 'status' || key === 'stage_code') return STATUS[v] || String(v);
  if (typeof v === 'string' && DATE.test(v)) return v.slice(0, 10).split('-').reverse().join('.');
  if (Array.isArray(v)) return `${v.length} бр.`;
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${FIELD[k] || k}: ${show(db, k, x)}`).join('; ');
  if (typeof v === 'number') return new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 3 }).format(v);
  return String(v);
}
/** "Поле: старо → ново" for every field that changed (or was set). */
export function changes(db, before, after) {
  const b = parse(before), a = parse(after);
  const bo = b && typeof b === 'object' && !Array.isArray(b) ? b : {}, ao = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  const keys = [...new Set([...Object.keys(bo), ...Object.keys(ao)])];
  const out = [];
  for (const k of keys) {
    const x = bo[k], y = ao[k];
    if (x == null && y == null) continue;                      // nothing to say (or hidden money)
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    out.push(`${FIELD[k] || k}: ${k in bo ? show(db, k, x) + ' → ' : ''}${show(db, k, y)}`);
  }
  if (!out.length && typeof a === 'string') out.push(a);
  return out;
}
export function humanEvent(db, e) {
  const label = EVENT_LABEL[e.type] || e.type;
  return { ...e, label, sentence: `${e.user_name || 'Системата'}: ${label.charAt(0).toLowerCase() + label.slice(1)}`, changes: changes(db, e.prev_value, e.new_value) };
}
export function humanAudit(db, r) {
  const what = ENTITY[r.entity_type] || r.entity_type;
  return { ...r, sentence: `${r.user_name || 'Системата'} ${ACTION[r.action] || r.action} ${what}${r.entity_id ? ' №' + r.entity_id : ''}`, changes: changes(db, r.before, r.after) };
}
