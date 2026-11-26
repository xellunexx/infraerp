// Къде живее всеки вид запис: известията и опашките водят до самия запис (страница + таб), не до началото на модула.
// Едно място за всички — нов вид запис се добавя тук, а не във всеки обработчик поотделно.
const ACCOUNTING = { payment_request: 'requests', proforma: 'proformas', supplier_order: 'orders', accommodation: 'accommodations' };
const PROJECT_TAB = { document: 'docs', contract: 'contract', message: 'messages' };

const BRIGADE_TAB = { document: 'docs', message: 'messages' };

/** @returns {string|null} null = this kind has no fixed place; keep the link the handler chose.
 *  department: the reader's — a brigadier opens project records in the brigade module. */
export function recordLink(type, id, projectId, department = null) {
  if (department === 'brigadier' && BRIGADE_TAB[type] && projectId != null) return `/brigade/${projectId}?tab=${BRIGADE_TAB[type]}`;
  if (ACCOUNTING[type]) return `/accounting?tab=${ACCOUNTING[type]}${id != null ? `&focus=${id}` : ''}`;
  if (PROJECT_TAB[type] && projectId != null) return `/projects/${projectId}?tab=${PROJECT_TAB[type]}`;
  return null;
}
