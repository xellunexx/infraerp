// Управител: management bundle — KPIs, attention queues, portfolio finance, workload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

async function signedProject(t) {
  const s = await seedOffer(t);
  const conf = await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
  assert.equal(conf.status, 200);
  t.sync();
  const p = (await t.admin.get('/api/projects')).data[0];
  const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
  const upd = await t.admin.patch(`/api/projects/${p.id}/contract`, { install_start: '2026-01-05', install_deadline: '2026-12-20', delivery_deadline: '2025-12-28', row_version: c0.row_version });
  assert.equal(upd.status, 200);
  await t.admin.post(`/api/projects/${p.id}/contract/submit`);
  await t.admin.post(`/api/projects/${p.id}/contract/approve`);
  const sign = await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29' });
  assert.equal(sign.status, 200);
  t.sync();
  return { ...s, project: (await t.admin.get(`/api/projects/${p.id}`)).data };
}

test('management: gated to approvals-holding roles (admin/manager)', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const mgr = await t.mkUser('mgr1', 'manager');
    assert.equal((await mgr.get('/api/management')).status, 200, 'manager reads the bundle');
    assert.equal((await t.admin.get('/api/management')).status, 200, 'admin reads the bundle');
    for (const role of ['technical', 'commercial', 'accounting', 'warehouse', 'logistics', 'brigadier', 'contracts']) {
      const u = await t.mkUser('u-' + role, role);
      assert.equal((await u.get('/api/management')).status, 403, `${role} has no approvals right`);
    }
  } finally { await t.stop(); }
});

test('management: bundle carries KPIs, attention queues, portfolio finance, workload', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const pid = project.id;
    const mgr = await t.mkUser('mgr2', 'manager');

    // seed the attention queues
    const pr = await t.admin.post('/api/payment-requests', { project_id: pid, category: 'материали', amount: 2500, payee: 'Доставчик ООД' });
    assert.equal(pr.status, 200);
    const task = await t.admin.post('/api/tasks', { project_id: pid, title: 'Просрочена задача', due_date: '2020-01-01', priority: 'high' });
    assert.equal(task.status, 200);
    const issue = await t.admin.post('/api/issues', { project_id: pid, kind: 'problem', severity: 'critical', title: 'Критичен проблем' });
    assert.equal(issue.status, 200);

    const m = (await mgr.get('/api/management')).data;
    assert.ok(m.kpis, 'kpis present');
    assert.equal(m.kpis.active_projects, 1);
    assert.equal(m.kpis.pending_approvals, 1, 'payment request approval pending');
    assert.ok(m.kpis.overdue_tasks >= 1, 'my overdue task counted (contract signing may add more)');
    assert.equal(m.kpis.critical_issues, 1);

    assert.ok(Array.isArray(m.attention.approvals) && m.attention.approvals.length >= 1, 'approvals queue');
    assert.ok(m.attention.approvals.some(a => (a.title || a.code || '').includes('PAY-')), 'payment request in approvals queue');
    assert.ok(m.attention.tasks.some(x => x.title === 'Просрочена задача'), 'overdue task listed');
    assert.ok(m.attention.issues.some(i => i.title === 'Критичен проблем' && i.severity === 'critical'), 'critical issue listed');

    const row = m.projects.find(p => p.id === pid);
    assert.ok(row, 'project in portfolio');
    assert.equal(typeof row.contract_value, 'number', 'finance fields visible to manager');
    assert.equal(typeof row.progress_pct, 'number');
    assert.ok(m.kpis.contract_value > 0, 'portfolio money total present');

    assert.ok(Array.isArray(m.workload), 'workload per department');
    const wd = m.workload.find(w => w.department === 'management' || w.open_tasks >= 0);
    assert.ok(wd, 'workload rows exist');

    // decision drains the queue: manager approves -> pending_approvals back to 0
    const dec = await mgr.post(`/api/payment-requests/${pr.data.id}/approve`, {});
    assert.equal(dec.status, 200, JSON.stringify(dec.data));
    const m2 = (await mgr.get('/api/management')).data;
    assert.equal(m2.kpis.pending_approvals, 0, 'decided approval leaves the queue');
    assert.ok(!m2.attention.approvals.some(a => (a.title || a.code || '').includes('PAY-')), 'no stale approval row');
  } finally { await t.stop(); }
});

test('management: money sections hide when finance permission is stripped', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const pid = project.id;
    const mgr = await t.mkUser('mgr3', 'manager');
    // strip finance read from manager role, then re-login so perms reload
    t.db.prepare("UPDATE role_permissions SET can_read = 0 WHERE role = 'manager' AND resource = 'finance'").run();
    const mgr2 = t.client();
    await mgr2.login('mgr3');

    const m = (await mgr2.get('/api/management')).data;
    const row = m.projects.find(p => p.id === pid);
    assert.ok(row, 'project still listed');
    assert.equal(row.contract_value, null, 'money hidden without finance read');
    assert.equal(m.kpis.contract_value ?? null, null, 'portfolio money total hidden');
    t.db.prepare("UPDATE role_permissions SET can_read = 1 WHERE role = 'manager' AND resource = 'finance'").run();
  } finally { await t.stop(); }
});
