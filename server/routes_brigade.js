// Бригадир: работно място на обекта — присъствие, дневен прогрес (в routes_technical), проблеми, съобщения, снимки/документи.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { tx, nextCode, FILES_DIR } from './db.js';
import { HttpError, bad, need, canSeeProject, audit, record, updateRow, emit, notify, on } from './core.js';
import { progressSummary } from './calc.js';
import { h, pick, num, reqStr } from './app.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const reqDate = (v, label, { required = true } = {}) => {
  if (v == null || v === '') { if (required) throw bad(`Полето „${label}“ е задължително`); return null; }
  const s = String(v);
  if (!DATE.test(s) || isNaN(Date.parse(s))) throw bad(`Невалидна дата за „${label}“`);
  return s;
};
const today = () => new Date().toISOString().slice(0, 10);
const ISSUE_KINDS = ['problem', 'delay', 'material_shortage', 'damage', 'additional_work', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'];
const ISSUE_FLOW = { open: ['in_progress', 'cancelled'], in_progress: ['resolved', 'cancelled', 'open'], resolved: ['open'], cancelled: ['open'] };
const DOC_CATEGORIES = ['photo', 'document', 'act', 'contract', 'appendix', 'other'];
const DOC_ENTITIES = { contract: 'contracts', appendix: 'contract_appendices', amendment: 'amendments', project_line: 'project_lines', offer_line: 'offer_lines', issue: 'issues', smr: 'smr_types', material_request: 'material_requests', supplier_order: 'supplier_orders', delivery: 'deliveries' };
const OK_MIME = /^(image\/(jpeg|png|gif|webp|heic|heif|vnd\.dwg)|application\/(pdf|json|msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.oasis\.opendocument\.[\w.]+|acad|dxf)|text\/(plain|csv))/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, defParamCharset: 'utf8' });

export default function mountBrigade(app, db) {
  const project = id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const needField = (req, pid, { resource = 'progress', action = 'read' } = {}) => {
    need(req.user, resource, action);
    if (pid == null) return;
    if (!project(pid)) throw new HttpError(404, 'Обектът не е намерен');
    if (!canSeeProject(db, req.user, pid)) throw new HttpError(403, 'Нямате достъп до този обект');
  };
  const optPid = (req, v, opts) => { const pid = v == null || v === '' ? null : Number(v); if (pid != null) needField(req, pid, opts); return pid; };

  // ---- работно място: моите обекти + задача/проблеми в пощенската кутия
  app.get('/api/brigade', h(req => {
    need(req.user, 'progress');
    const projects = db.prepare(`SELECT p.id, p.code, p.name, p.status, p.site_address, p.planned_end, p.brigadier_id, c.name AS customer_name
      FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.archived = 0 ORDER BY p.id DESC`).all()
      .filter(p => canSeeProject(db, req.user, p.id))
      .map(p => {
        const issues = db.prepare("SELECT COUNT(*) n FROM issues WHERE project_id = ? AND status = 'open'").get(p.id).n;
        const crew = db.prepare('SELECT COUNT(*) n FROM attendance WHERE project_id = ? AND work_date = ?').get(p.id, today()).n;
        return { ...p, progress_pct: progressSummary(db, p.id).progress_pct, open_issues: issues, today_workers: crew };
      });
    const tasks = db.prepare(`SELECT t.*, p.code AS project_code, p.name AS project_name, u.full_name AS assignee_name
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.status = 'open' AND (t.assignee_id = ? OR t.assignee_dept = ?) ORDER BY t.due_date IS NULL, t.due_date, t.id DESC LIMIT 100`)
      .all(req.user.id, req.user.department).filter(t => !t.project_id || canSeeProject(db, req.user, t.project_id));
    const issues = db.prepare(`${issueView} WHERE i.status = 'open' AND (i.assigned_dept = ? OR i.reported_by = ?) ORDER BY i.id DESC LIMIT 100`)
      .all(req.user.department, req.user.id).filter(i => canSeeProject(db, req.user, i.project_id));
    return { projects, tasks, issues };
  }));

  // ---- Присъствие (дневна присъстваща листа)
  const attView = `SELECT a.*, u.full_name AS recorded_by_name FROM attendance a LEFT JOIN users u ON u.id = a.recorded_by`;
  app.get('/api/projects/:pid/attendance', h(req => {
    needField(req, Number(req.params.pid));
    const pid = Number(req.params.pid);
    const date = req.query.date ? reqDate(req.query.date, 'Дата') : null;
    return db.prepare(`${attView} WHERE a.project_id = ?${date ? ' AND a.work_date = ?' : ''} ORDER BY a.work_date DESC, a.id DESC LIMIT 200`)
      .all(...(date ? [pid, date] : [pid]));
  }));
  app.post('/api/attendance', h(req => tx(db, () => {
    const pid = Number(req.body?.project_id);
    if (!pid) throw bad('Обектът е задължителен');
    needField(req, pid, { action: 'write' });
    const b = req.body || {};
    const worker = reqStr(b.worker, 'Работник');
    const workDate = reqDate(b.work_date, 'Дата');
    const hours = b.hours != null && b.hours !== '' ? num(b.hours, 'Часове', { min: 0 }) : 8;
    db.prepare(`INSERT INTO attendance(project_id, work_date, worker, hours, team, recorded_by) VALUES (?,?,?,?,?,?)
      ON CONFLICT(project_id, work_date, worker) DO UPDATE SET hours = excluded.hours, team = excluded.team, recorded_by = excluded.recorded_by`)
      .run(pid, workDate, worker, hours, b.team || null, req.user.id);
    const row = db.prepare(`${attView} WHERE a.project_id = ? AND a.work_date = ? AND a.worker = ?`).get(pid, workDate, worker);
    record(db, req.user, { type: 'attendance.recorded', project_id: pid, entity_type: 'attendance', entity_id: row.id, action: 'upsert', after: { worker, work_date: workDate, hours, team: b.team || null }, module: 'brigade' });
    return row;
  })));

  // ---- Проблеми
  const issueView = `SELECT i.*, p.code AS project_code, p.name AS project_name, c.name AS customer_name,
      pr.code AS product_code, pr.name AS product_name, l.description AS line_description,
      u.full_name AS reported_by_name, d.name AS assigned_dept_name
    FROM issues i JOIN projects p ON p.id = i.project_id JOIN customers c ON c.id = p.customer_id
    LEFT JOIN products pr ON pr.id = i.product_id LEFT JOIN project_lines l ON l.id = i.project_line_id
    LEFT JOIN users u ON u.id = i.reported_by LEFT JOIN departments d ON d.code = i.assigned_dept`;
  app.get('/api/issues', h(req => {
    need(req.user, 'progress');
    const w = [], args = [];
    const pid = optPid(req, req.query.project_id);
    if (pid != null) { w.push('i.project_id = ?'); args.push(pid); }
    if (req.query.status) { w.push('i.status = ?'); args.push(String(req.query.status)); }
    if (req.query.assigned_dept) { w.push('i.assigned_dept = ?'); args.push(String(req.query.assigned_dept)); }
    return db.prepare(`${issueView}${w.length ? ' WHERE ' + w.join(' AND ') : ''} ORDER BY i.id DESC LIMIT 300`).all(...args)
      .filter(i => canSeeProject(db, req.user, i.project_id));
  }));
  app.post('/api/issues', h(req => tx(db, () => {
    const pid = Number(req.body?.project_id);
    if (!pid) throw bad('Обектът е задължителен');
    needField(req, pid, { action: 'write' });
    const b = req.body || {};
    const kind = ISSUE_KINDS.includes(b.kind) ? b.kind : (b.kind ? 'other' : 'problem');
    const severity = SEVERITIES.includes(b.severity) ? b.severity : 'medium';
    const assigned = b.assigned_dept || 'technical';
    if (!db.prepare('SELECT 1 FROM departments WHERE code = ?').get(assigned)) throw bad('Няма такъв отдел');
    let productId = null;
    if (b.product_id != null && b.product_id !== '') {
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(Number(b.product_id))) throw bad('Няма такъв продукт');
      productId = Number(b.product_id);
    }
    let lineId = null;
    if (b.project_line_id != null && b.project_line_id !== '') {
      const l = db.prepare('SELECT project_id FROM project_lines WHERE id = ?').get(Number(b.project_line_id));
      if (!l || l.project_id !== pid) throw bad('Редът не е от този обект');
      lineId = Number(b.project_line_id);
    }
    const code = nextCode(db, 'ISS');
    const id = Number(db.prepare(`INSERT INTO issues(code, project_id, kind, severity, title, description, product_id, project_line_id, status, reported_by, assigned_dept)
      VALUES (?,?,?,?,?,?,?,?,'open',?,?)`)
      .run(code, pid, kind, severity, reqStr(b.title, 'Заглавие'), b.description || null, productId, lineId, req.user.id, assigned).lastInsertRowid);
    audit(db, req.user, { project_id: pid, entity_type: 'issue', entity_id: id, action: 'report', after: { code, kind, severity, title: b.title, assigned_dept: assigned }, module: 'brigade' });
    emit(db, req.user, { type: 'issue.reported', origin: 'brigade', project_id: pid, entity_type: 'issue', entity_id: id,
      dedupe_key: `issue.reported:${id}`, next: { code, kind, severity, title: b.title, assigned_dept: assigned }, affected: [assigned] });
    return db.prepare(`${issueView} WHERE i.id = ?`).get(id);
  })));
  app.patch('/api/issues/:id', h(req => tx(db, () => {
    need(req.user, 'progress', 'write');
    const i = db.prepare('SELECT * FROM issues WHERE id = ?').get(Number(req.params.id));
    if (!i) throw new HttpError(404, 'Няма такъв проблем');
    needField(req, i.project_id, { action: 'write' });
    const b = req.body || {};
    const f = pick(b, ['title', 'description', 'kind', 'severity', 'assigned_dept', 'resolution', 'product_id', 'project_line_id']);
    if (f.title !== undefined) f.title = reqStr(f.title, 'Заглавие');
    if (f.kind !== undefined && !ISSUE_KINDS.includes(f.kind)) throw bad('Невалиден вид проблем');
    if (f.severity !== undefined && !SEVERITIES.includes(f.severity)) throw bad('Невалиден приоритет');
    if (f.assigned_dept !== undefined && !db.prepare('SELECT 1 FROM departments WHERE code = ?').get(f.assigned_dept)) throw bad('Няма такъв отдел');
    if (b.status !== undefined && b.status !== i.status) {
      if (!ISSUE_STATUSES.includes(b.status)) throw bad('Невалиден статус');
      if (!ISSUE_FLOW[i.status]?.includes(b.status)) throw bad(`Статусът не може да мине от „${i.status}“ към „${b.status}“`);
      f.status = b.status;
      if (b.status === 'resolved') {
        const res = String(b.resolution || f.resolution || '').trim();
        if (!res) throw bad('При затваряне е нужна бележка за решението');
        f.resolution = res; f.resolved_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      } else if (i.status === 'resolved') { f.resolved_at = null; f.resolution = null; }
    }
    updateRow(db, 'issues', i.id, f, b.row_version);
    audit(db, req.user, { project_id: i.project_id, entity_type: 'issue', entity_id: i.id, action: b.status && b.status !== i.status ? 'status' : 'update',
      before: pick(i, Object.keys(f)), after: f, module: 'brigade' });
    if (f.status !== 'resolved' && Object.keys(f).length)
      emit(db, req.user, { type: 'issue.updated', origin: 'brigade', project_id: i.project_id, entity_type: 'issue', entity_id: i.id, prev: pick(i, Object.keys(f)), next: f });
    if (f.status === 'resolved')
      emit(db, req.user, { type: 'issue.resolved', origin: 'brigade', project_id: i.project_id, entity_type: 'issue', entity_id: i.id,
        dedupe_key: `issue.resolved:${i.id}`, prev: { status: i.status }, next: { status: 'resolved', resolution: f.resolution }, affected: ['brigadier', 'technical'] });
    return db.prepare(`${issueView} WHERE i.id = ?`).get(i.id);
  })));

  // ---- Съобщения по обекта
  app.get('/api/projects/:pid/messages', h(req => {
    needField(req, Number(req.params.pid), { resource: 'messages' });
    // the newest page, oldest first; ?before=<id> pages back
    const before = Number(req.query.before) || null;
    return db.prepare(`SELECT m.*, u.full_name AS author_name FROM messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.project_id = ? AND (? IS NULL OR m.id < ?) ORDER BY m.id DESC LIMIT 300`).all(Number(req.params.pid), before, before).reverse();
  }));
  app.post('/api/messages', h(req => tx(db, () => {
    const pid = Number(req.body?.project_id);
    if (!pid) throw bad('Обектът е задължителен');
    needField(req, pid, { resource: 'messages', action: 'write' });
    const b = req.body || {};
    const body = reqStr(b.body, 'Съобщение');
    if (body.length > 4000) throw bad('Съобщението е твърде дълго');
    let entityType = null, entityId = null;
    if (b.entity_type && b.entity_id) {
      entityType = String(b.entity_type); entityId = Number(b.entity_id);
      if (entityType === 'issue' && !db.prepare('SELECT 1 FROM issues WHERE id = ? AND project_id = ?').get(entityId, pid)) throw bad('Проблемът не е от този обект');
    }
    const parentId = b.parent_id != null ? Number(b.parent_id) : null;
    if (parentId != null && !db.prepare('SELECT 1 FROM messages WHERE id = ? AND project_id = ?').get(parentId, pid)) throw bad('Няма такова нишка');
    const id = Number(db.prepare(`INSERT INTO messages(project_id, parent_id, entity_type, entity_id, kind, body, mentions, author_id) VALUES (?,?,?,?, 'comment', ?, '[]', ?)`)
      .run(pid, parentId, entityType, entityId, body, req.user.id).lastInsertRowid);
    record(db, req.user, { type: 'message.created', project_id: pid, entity_type: 'message', entity_id: id, action: 'create', after: { body: body.slice(0, 120) }, module: 'messages' });
    return db.prepare(`SELECT m.*, u.full_name AS author_name FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`).get(id);
  })));

  // ---- Документи и снимки
  const docView = `SELECT d.*, u.full_name AS created_by_name,
      (SELECT COUNT(*) FROM document_versions v WHERE v.document_id = d.id) AS versions_count,
      (SELECT v.id FROM document_versions v WHERE v.document_id = d.id ORDER BY v.version DESC LIMIT 1) AS latest_version_id
    FROM documents d LEFT JOIN users u ON u.id = d.created_by`;
  const docVersions = docId => db.prepare(`SELECT v.id, v.version, v.filename, v.stored_name, v.mime, v.size, v.sha256, v.note, v.created_at, u.full_name AS uploaded_by_name
    FROM document_versions v LEFT JOIN users u ON u.id = v.uploaded_by WHERE v.document_id = ? ORDER BY v.version`).all(docId);
  app.get('/api/projects/:pid/documents', h(req => {
    needField(req, Number(req.params.pid), { resource: 'documents' });
    return db.prepare(`${docView} WHERE d.project_id = ? ORDER BY d.shared_with_brigade DESC, d.id DESC`).all(Number(req.params.pid))
      .map(d => { const versions = docVersions(d.id); return { ...d, versions, uploaded_by_name: versions.at(-1)?.uploaded_by_name || d.created_by_name }; });
  }));
  app.post('/api/projects/:pid/documents', upload.single('file'), h(req => {
    needField(req, Number(req.params.pid), { resource: 'documents', action: 'write' });
    const pid = Number(req.params.pid);
    if (!req.file) throw bad('Файлът липсва');
    if (!OK_MIME.test(req.file.mimetype || '')) throw bad('Типът файл не е позволен');
    const title = reqStr(req.body?.title || req.file.originalname, 'Заглавие');
    const category = DOC_CATEGORIES.includes(req.body?.category) ? req.body.category : 'document';
    const entityType = req.body?.entity_type || null;
    const entityId = req.body?.entity_id ? Number(req.body.entity_id) : null;
    if (entityType != null || entityId != null) {
      const table = DOC_ENTITIES[entityType];
      if (!table || entityId == null || !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(entityId)) throw bad('Невалидна връзка към обект');
    }
    // the same place = same project and same link (contract, appendix, …): a file is never a second document there
    const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const here = db.prepare(`SELECT d.*, v.version AS v_version, v.sha256, v.filename FROM documents d JOIN document_versions v ON v.document_id = d.id
      WHERE d.project_id = ? AND d.entity_type IS ? AND d.entity_id IS ? ORDER BY d.id, v.version`).all(pid, entityType, entityId);
    const dup = here.find(x => x.sha256 === sha);
    if (dup) throw bad(`Този файл вече е качен: „${dup.title}“ (v${dup.v_version}).`);
    const sameName = here.filter(x => x.v_version === x.current_version).find(x => x.filename === String(req.file.originalname || ''));
    if (sameName) return addVersion(req, db.prepare('SELECT * FROM documents WHERE id = ?').get(sameName.id));
    const ext = (String(req.file.originalname || '').match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase();
    const stored = `${crypto.randomUUID()}.${ext}`;
    fs.mkdirSync(FILES_DIR, { recursive: true });
    fs.writeFileSync(path.join(FILES_DIR, stored), req.file.buffer);
    try {
      return tx(db, () => {
        const did = Number(db.prepare('INSERT INTO documents(project_id, entity_type, entity_id, category, title, created_by) VALUES (?,?,?,?,?,?)')
          .run(pid, entityType, entityId, category, title, req.user.id).lastInsertRowid);
        db.prepare('INSERT INTO document_versions(document_id, version, filename, stored_name, mime, size, sha256, note, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(did, 1, String(req.file.originalname || 'file').slice(0, 200), stored, req.file.mimetype, req.file.size, sha, req.body?.note || null, req.user.id);
        audit(db, req.user, { project_id: pid, entity_type: 'document', entity_id: did, action: 'upload', after: { title, category, filename: req.file.originalname, size: req.file.size }, module: 'documents' });
        emit(db, req.user, { type: 'document.uploaded', origin: 'brigade', project_id: pid, entity_type: 'document', entity_id: did,
          dedupe_key: `document.uploaded:${did}`, next: { title, category }, affected: ['technical', 'brigadier'] });
        return { ...db.prepare(`${docView} WHERE d.id = ?`).get(did), versions: docVersions(did) };
      });
    } catch (e) { try { fs.unlinkSync(path.join(FILES_DIR, stored)); } catch {} throw e; }
  }));
  /** Next version of an existing document (the caller has checked rights and the file). */
  function addVersion(req, doc) {
    const same = db.prepare('SELECT version FROM document_versions WHERE document_id = ? AND sha256 = ?').get(doc.id, crypto.createHash('sha256').update(req.file.buffer).digest('hex'));
    if (same) throw bad(`Този файл вече е качен: „${doc.title}“ (v${same.version}).`);
    const ext = (String(req.file.originalname || '').match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase();
    const stored = `${crypto.randomUUID()}.${ext}`;
    const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    fs.mkdirSync(FILES_DIR, { recursive: true });
    fs.writeFileSync(path.join(FILES_DIR, stored), req.file.buffer);
    try {
      return tx(db, () => {
        const ver = doc.current_version + 1;
        db.prepare('INSERT INTO document_versions(document_id, version, filename, stored_name, mime, size, sha256, note, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(doc.id, ver, String(req.file.originalname || 'file').slice(0, 200), stored, req.file.mimetype, req.file.size, sha, req.body?.note || null, req.user.id);
        db.prepare('UPDATE documents SET current_version = ? WHERE id = ?').run(ver, doc.id);
        audit(db, req.user, { project_id: doc.project_id, entity_type: 'document', entity_id: doc.id, action: 'new_version', after: { version: ver, filename: req.file.originalname, size: req.file.size }, module: 'documents' });
        emit(db, req.user, { type: 'document.versioned', origin: 'documents', project_id: doc.project_id, entity_type: 'document', entity_id: doc.id,
          dedupe_key: `document.versioned:${doc.id}:${ver}`, next: { title: doc.title, version: ver }, affected: ['technical', 'contracts'] });
        return { ...db.prepare(`${docView} WHERE d.id = ?`).get(doc.id), versions: docVersions(doc.id) };
      });
    } catch (e) { try { fs.unlinkSync(path.join(FILES_DIR, stored)); } catch {} throw e; }
  }
  // т.40: the office marks which project files go to the brigadier; the brigadier is told and sees them first
  app.post('/api/projects/:pid/documents/brigade', h(req => tx(db, () => {
    const pid = Number(req.params.pid);
    needField(req, pid, { resource: 'documents', action: 'write' });
    if (req.user.department === 'brigadier') throw new HttpError(403, 'Документите за бригадира се избират от офиса');
    const ids = [...new Set((req.body?.ids || []).map(Number))].filter(Boolean), share = req.body?.share !== false;
    if (!ids.length) throw bad('Изберете поне един файл');
    const sent = [];
    for (const id of ids) {
      const d = db.prepare('SELECT * FROM documents WHERE id = ? AND project_id = ?').get(id, pid);
      if (!d) throw bad(`Документ ${id} не е от този обект`);
      if (!!d.shared_with_brigade === share) continue;
      db.prepare("UPDATE documents SET shared_with_brigade = ?, shared_at = CASE WHEN ? THEN datetime('now') END, shared_by = CASE WHEN ? THEN ? END WHERE id = ?").run(share ? 1 : 0, share ? 1 : 0, share ? 1 : 0, req.user.id, id);
      audit(db, req.user, { project_id: pid, entity_type: 'document', entity_id: id, action: share ? 'share_brigade' : 'unshare_brigade', before: { shared_with_brigade: !!d.shared_with_brigade }, after: { shared_with_brigade: share, title: d.title }, module: 'documents' });
      if (share) { emit(db, req.user, { type: 'document.shared', origin: 'documents', project_id: pid, entity_type: 'document', entity_id: id,
        dedupe_key: `document.shared:${id}:${Date.now()}`, next: { title: d.title }, affected: ['brigadier'] }); sent.push(id); }
    }
    return { ok: true, shared: sent };
  })));
  app.post('/api/documents/:id/versions', upload.single('file'), h(req => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
    if (!doc) throw new HttpError(404, 'Няма такъв документ');
    if (doc.project_id != null) needField(req, doc.project_id, { resource: 'documents', action: 'write' });
    else need(req.user, 'documents', 'write');
    if (!req.file) throw bad('Файлът липсва');
    if (!OK_MIME.test(req.file.mimetype || '')) throw bad('Типът файл не е позволен');
    return addVersion(req, doc);
  }));
  app.get('/api/documents/:vid/file', h((req, res) => {
    need(req.user, 'documents');
    const v = db.prepare(`SELECT v.*, d.project_id, d.title FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ?`).get(Number(req.params.vid));
    if (!v) throw new HttpError(404, 'Няма такъв файл');
    if (v.project_id != null && !canSeeProject(db, req.user, v.project_id)) throw new HttpError(403, 'Нямате достъп до този обект');
    const file = path.join(FILES_DIR, v.stored_name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Файлът липсва на диска');
    res.setHeader('Content-Type', v.mime || 'application/octet-stream');
    res.setHeader('Content-Length', v.size);
    const name = String(v.filename || 'file');
    res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\x20-\x7e]|["\\%]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name.toWellFormed()).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`);
    fs.createReadStream(file).pipe(res);
  }));
}

// Събития -> известия до хора.
on('issue.reported', 'notify_assignee', (db, ev) => {
  const i = db.prepare('SELECT i.code, p.code AS pcode FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?').get(ev.entity_id);
  if (!i) return { skipped: true };
  const dept = ev.next?.assigned_dept || 'technical';
  return notify(db, ev, { departments: [dept], severity: ev.next?.severity === 'critical' || ev.next?.severity === 'high' ? 'warn' : 'info',
    title: `Нов проблем ${i.code}${i.pcode ? ' — ' + i.pcode : ''}`,
    body: `${ev.next?.kind || ''}: ${ev.next?.title || ''}`.trim(), link: `/brigade/${ev.project_id}` });
});
on('issue.resolved', 'notify_reporter', (db, ev) => {
  const i = db.prepare('SELECT i.code, i.reported_by, u.department AS rdept, p.code AS pcode FROM issues i JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = i.reported_by WHERE i.id = ?').get(ev.entity_id);
  if (!i) return { skipped: true };
  return notify(db, ev, { departments: i.rdept ? [i.rdept] : [], users: i.reported_by ? [i.reported_by] : [],
    title: `Проблем ${i.code} е решен${i.pcode ? ' — ' + i.pcode : ''}`,
    body: ev.next?.resolution || '', link: `/brigade/${ev.project_id}` });
});
on('document.shared', 'notify_brigadier', (db, ev) => {
  const d = db.prepare('SELECT d.title, p.code AS pcode, p.brigadier_id FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = ?').get(ev.entity_id);
  if (!d) return { skipped: true };
  return notify(db, ev, { users: d.brigadier_id ? [d.brigadier_id] : [], departments: d.brigadier_id ? [] : ['brigadier'],
    title: `Документ за обекта ${d.pcode || ''}: ${d.title}`, body: 'Изпратен от офиса', link: `/brigade/${ev.project_id}?tab=docs` });
});
on('document.uploaded', 'notify_technical', (db, ev) => {
  const d = db.prepare('SELECT d.title, p.code AS pcode FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = ?').get(ev.entity_id);
  if (!d) return { skipped: true };
  return notify(db, ev, { departments: ['technical'], title: `Нов документ: ${d.title}${d.pcode ? ' — ' + d.pcode : ''}`, link: `/brigade/${ev.project_id}` });
});
