// Къде живее всеки вид запис: известията и опашките водят до самия запис (страница + таб + ред), не до началото на модула.
// Едно място за всички — нов вид запис се добавя тук, а не във всеки обработчик поотделно.
const ACCOUNTING = { payment_request: 'requests', proforma: 'proformas', supplier_order: 'orders', accommodation: 'accommodations', transaction: 'transactions' };
const PROJECT_TAB = { document: 'docs', contract: 'contract', message: 'messages', task: 'tasks', issue: 'tasks', stage: 'overview', project: 'overview' };
const TECHNICAL_TAB = { schedule_item: 'schedule', progress_entry: 'progress', project_line: 'progress' };
const BRIGADE_TAB = { document: 'docs', message: 'messages', issue: 'issues', schedule_item: 'plan', progress_entry: 'progress', project: 'plan', task: 'plan' };

/** @returns {string|null} null = this kind has no fixed place; keep the link the handler chose.
 *  department: the reader's — a brigadier opens project records in the brigade module. */
export function recordLink(type, id, projectId, department = null) {
  const f = id != null ? `&focus=${id}` : '';
  if (department === 'brigadier' && BRIGADE_TAB[type] && projectId != null) return `/brigade/${projectId}?tab=${BRIGADE_TAB[type]}${f}`;
  if (ACCOUNTING[type]) return `/accounting?tab=${ACCOUNTING[type]}${f}`;
  if (type === 'material_request') return `/warehouse?tab=requests${f}`;
  if (type === 'stock_movement') return `/warehouse?tab=movements${f}`;
  if (type === 'change_request') return `/change-requests?tab=${department === 'management' ? 'queue' : 'mine'}${f}`;
  if (type === 'delivery' && projectId != null) return `/logistics?tab=deliveries&pid=${projectId}${f}`;
  if (type === 'asset_allocation' && projectId != null) return `/logistics?tab=assets&pid=${projectId}${f}`;
  if (TECHNICAL_TAB[type] && projectId != null) return `/technical/${projectId}?tab=${TECHNICAL_TAB[type]}${f}`;
  if (PROJECT_TAB[type] && projectId != null) return `/projects/${projectId}?tab=${PROJECT_TAB[type]}${type === 'task' || type === 'issue' ? f : ''}`;
  return null;
}

/** Rows shown away from their home (e.g. in the project card) carry the link to where they are managed. */
export const withLinks = (rows, type, department = null) => rows.map(r => ({ ...r, link: recordLink(type, r.id, r.project_id, department) }));
