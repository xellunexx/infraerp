// Управител: портфолио табло — KPI, опашки за внимание (одобрения, проблеми, закъснели задачи, неуспешна синхронизация), проектна таблица, натоварване по отдели.
import { can, canSeeProject, need } from './core.js';
import { h } from './app.js';
import { finance, progressSummary } from './calc.js';

export default function mountManagement(app, db) {
  app.get('/api/management', h(req => {
    need(req.user, 'approvals'); // само роли с право на одобрение (Управител / Админ)
    const money = can(req.user, 'finance');
    const today = new Date().toISOString().slice(0, 10);

    const projects = db.prepare(`SELECT p.id, p.code, p.name, p.status, c.name AS customer_name,
        (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status = 'open' AND i.severity IN ('high','critical')) AS critical_issues
      FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.archived = 0 ORDER BY p.id DESC`).all()
      .filter(p => canSeeProject(db, req.user, p.id));

    const rows = projects.map(p => {
      const ps = progressSummary(db, p.id);
      const f = money ? finance(db, p.id) : null;
      return { id: p.id, code: p.code, name: p.name, customer_name: p.customer_name, status: p.status,
        progress_pct: ps.progress_pct, critical_issues: p.critical_issues,
        contract_value: f?.contract_value ?? null, invoiced: f?.invoiced ?? null, received: f?.payments_received ?? null,
        payables: f?.payables ?? null, receivables: f?.receivables ?? null,
        result_to_date: f?.result_to_date ?? null, forecast_result: f?.forecast_result ?? null };
    });
    const active = rows.filter(r => !['closed', 'completed'].includes(r.status));

    // ---- опашки за внимание
    const approvals = db.prepare(`SELECT e.id, e.type, e.project_id, e.ts, e.new_value, p.code AS project_code
      FROM events e LEFT JOIN projects p ON p.id = e.project_id
      WHERE e.approval_status = 'pending' ORDER BY e.id DESC LIMIT 50`).all()
      .map(e => {
        let nv = {}; try { nv = JSON.parse(e.new_value || '{}'); } catch { /* keep {} */ }
        return { id: e.id, type: e.type, project_id: e.project_id, project_code: e.project_code, ts: e.ts, ...nv,
          title: nv.title || nv.code || e.type,
          link: e.type === 'payment_request.created' ? '/accounting' : e.project_id ? `/projects/${e.project_id}` : null };
      });

    const issues = db.prepare(`SELECT i.id, i.code, i.project_id, i.kind, i.severity, i.title, i.status, i.created_at,
        p.code AS project_code, d.name AS assigned_dept_name
      FROM issues i LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN departments d ON d.code = i.assigned_dept
      WHERE i.status = 'open' AND i.severity IN ('high','critical') ORDER BY i.severity = 'critical' DESC, i.id DESC LIMIT 50`).all()
      .map(i => ({ ...i, link: i.project_id ? `/brigade/${i.project_id}` : '/brigade' }));

    const tasks = db.prepare(`SELECT t.id, t.code, t.project_id, t.title, t.due_date, t.priority, t.created_at,
        p.code AS project_code, u.full_name AS assignee_name, d.name AS assignee_dept_name
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN departments d ON d.code = t.assignee_dept
      WHERE t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date < ? ORDER BY t.due_date LIMIT 50`).all(today)
      .map(t => ({ ...t, link: t.project_id ? `/projects/${t.project_id}` : null }));

    const events = db.prepare(`SELECT e.id, e.type, e.project_id, e.ts, e.last_error, p.code AS project_code
      FROM events e LEFT JOIN projects p ON p.id = e.project_id WHERE e.status = 'failed' ORDER BY e.id DESC LIMIT 20`).all()
      .map(e => ({ ...e, link: e.project_id ? `/projects/${e.project_id}` : '/settings' }));

    // ---- натоварване по отдели
    const workload = db.prepare(`SELECT d.code AS department, d.name,
        (SELECT COUNT(*) FROM tasks t WHERE t.status = 'open' AND t.assignee_dept = d.code) AS open_tasks,
        (SELECT COUNT(*) FROM issues i WHERE i.status = 'open' AND i.assigned_dept = d.code) AS open_issues,
        (SELECT COUNT(*) FROM issues i WHERE i.status = 'open' AND i.severity IN ('high','critical') AND i.assigned_dept = d.code) AS critical_issues
      FROM departments d ORDER BY d.code`).all();

    const kpis = {
      active_projects: active.length,
      critical_issues: rows.reduce((s, r) => s + (r.critical_issues || 0), 0),
      pending_approvals: approvals.length,
      overdue_tasks: tasks.length,
      failed_events: db.prepare("SELECT COUNT(*) n FROM events WHERE status = 'failed'").get().n,
      in_transit: db.prepare("SELECT COUNT(*) n FROM deliveries WHERE status = 'in_transit'").get().n,
    };
    if (money) {
      const sum = k => Math.round(active.reduce((s, r) => s + (r[k] || 0), 0) * 100) / 100;
      Object.assign(kpis, { contract_value: sum('contract_value'), receivables: sum('receivables'),
        payables: sum('payables'), result_to_date: sum('result_to_date'), forecast_result: sum('forecast_result') });
    }

    return { kpis, attention: { approvals, issues, tasks, events }, projects: rows, workload };
  }));
}
