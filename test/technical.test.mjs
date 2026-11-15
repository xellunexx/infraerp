// Phase 2 slice — Technical: linear schedule, daily progress, consumption watch, tasks, workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

/** offer -> confirm -> contract dates -> submit -> approve -> sign -> drained events. install window is in the past so item 1 is late. */
async function signedProject(t, dates = { install_start: '2026-01-05', install_deadline: '2026-12-20', delivery_deadline: '2025-12-28' }) {
  const s = await seedOffer(t);
  const conf = await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
  assert.equal(conf.status, 200);
  t.sync();
  const p = (await t.admin.get('/api/projects')).data[0];
  const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
  const upd = await t.admin.patch(`/api/projects/${p.id}/contract`, { ...dates, row_version: c0.row_version });
  assert.equal(upd.status, 200);
  await t.admin.post(`/api/projects/${p.id}/contract/submit`);
  await t.admin.post(`/api/projects/${p.id}/contract/approve`);
  const sign = await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29' });
  assert.equal(sign.status, 200);
  t.sync();
  return { ...s, project: (await t.admin.get(`/api/projects/${p.id}`)).data };
}

test('Technical: schedule built on signing, editable with concurrency guard, emits schedule.changed', async () => {
  const t = await start();
  try {
    const tech = await t.mkUser('tech1', 'technical');
    const { project } = await signedProject(t);

    const sched = (await tech.get(`/api/projects/${project.id}/schedule`)).data;
    // two СМР lines (5 + 2 planned days) chained from install_start
    assert.equal(sched.items.length, 2);
    assert.equal(sched.items[0].start_date, '2026-01-05');
    assert.equal(sched.items[0].end_date, '2026-01-09');
    assert.equal(sched.items[1].start_date, '2026-01-10');
    assert.equal(sched.items[0].baseline_start, '2026-01-05', 'baseline preserved');
    assert.equal(sched.deadline, '2026-12-20');

    const item = sched.items[0];
    const moved = await tech.patch(`/api/schedule-items/${item.id}`, { start_date: '2026-01-07', end_date: '2026-01-12', row_version: item.row_version });
    assert.equal(moved.status, 200);
    const stale = await tech.patch(`/api/schedule-items/${item.id}`, { start_date: '2026-01-08', row_version: item.row_version });
    assert.equal(stale.status, 409, 'stale row_version rejected');
    const badOrder = await tech.patch(`/api/schedule-items/${item.id}`, { start_date: '2026-01-12', end_date: '2026-01-07', row_version: item.row_version + 1 });
    assert.equal(badOrder.status, 400, 'end before start rejected');
    const selfDep = await tech.patch(`/api/schedule-items/${item.id}`, { depends_on: item.id, row_version: item.row_version + 1 });
    assert.equal(selfDep.status, 400, 'self-dependency rejected');

    // schedule.changed event drained -> logistics + brigadier notified
    t.sync();
    const ev = t.db.prepare("SELECT * FROM events WHERE type = 'schedule.changed' ORDER BY id DESC LIMIT 1").get();
    assert.ok(ev, 'schedule.changed emitted');
    assert.equal(ev.status, 'processed');
    const n = t.db.prepare("SELECT DISTINCT department FROM notifications WHERE event_id = ?").all(ev.id).map(r => r.department);
    assert.deepEqual(n.sort(), ['brigadier', 'logistics']);

    // add a custom item
    const add = await tech.post(`/api/projects/${project.id}/schedule`, { name: 'Почистване', start_date: '2026-01-13', end_date: '2026-01-14', depends_on: item.id });
    assert.equal(add.status, 200);
    const after = (await tech.get(`/api/projects/${project.id}/schedule`)).data;
    assert.equal(after.items.length, 3);
    const movedItem = after.items.find(x => x.id === item.id);
    assert.equal(movedItem.slip_days, 3, 'slip vs baseline: 09 -> 12');
  } finally { await t.stop(); }
});

test('Technical: daily progress — dedupe, actual_start, execution stage, void', async () => {
  const t = await start();
  try {
    const tech = await t.mkUser('tech1', 'technical');
    const { project } = await signedProject(t);
    const line = t.db.prepare('SELECT * FROM project_lines WHERE project_id = ? ORDER BY sort LIMIT 1').get(project.id);

    const post = await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-1', project_line_id: line.id, work_date: '2026-01-06', qty: 40, note: 'ден 1' });
    assert.equal(post.status, 200);
    assert.equal(post.data.deduped, false);
    const dup = await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-1', project_line_id: line.id, work_date: '2026-01-06', qty: 40 });
    assert.equal(dup.data.deduped, true, 'same uid is a no-op (field double-tap)');
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM progress_entries WHERE project_id = ?').get(project.id).n, 1);

    const view = (await tech.get(`/api/projects/${project.id}/progress`)).data;
    assert.equal(view.lines.find(l => l.id === line.id).done_qty, 40);
    assert.equal(view.entries.length, 1);

    const p2 = (await tech.get(`/api/projects/${project.id}`)).data;
    assert.equal(p2.actual_start, '2026-01-06', 'first entry sets actual start');
    assert.equal(p2.stages.find(s => s.code === 'execution').status, 'active', 'execution stage activated');
    t.sync();
    const ev = t.db.prepare("SELECT * FROM events WHERE type = 'progress.recorded'").get();
    assert.equal(ev.status, 'processed', 'execution_watch handler ran');

    // void: quantity rolls back, correction stays in history
    const voidRes = await tech.post(`/api/progress-entries/${post.data.entry.id}/void`);
    assert.equal(voidRes.status, 200);
    const view2 = (await tech.get(`/api/projects/${project.id}/progress`)).data;
    assert.equal(view2.lines.find(l => l.id === line.id).done_qty, 0);
    assert.equal(view2.entries[0].voided, 1);
    assert.equal((await tech.post(`/api/progress-entries/${post.data.entry.id}/void`)).status, 400, 'double void rejected');
    t.sync();
    assert.ok(t.db.prepare("SELECT 1 FROM events WHERE type = 'progress.voided'").get(), 'progress.voided emitted');

    // bad input
    assert.equal((await tech.post(`/api/projects/${project.id}/progress`, { project_line_id: line.id, work_date: '2026-01-06', qty: 0 })).status, 400);
    assert.equal((await tech.post(`/api/projects/${project.id}/progress`, { project_line_id: 99999, work_date: '2026-01-06', qty: 1 })).status, 400);
    assert.equal((await tech.post(`/api/projects/${project.id}/progress`, { project_line_id: line.id, work_date: 'не дата', qty: 1 })).status, 400);

    // warn-and-allow: cumulative over contract is flagged in the response, the entry still saves
    const w1 = await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-w1', project_line_id: line.id, work_date: '2026-01-07', qty: 90 });
    assert.equal(w1.status, 200);
    assert.equal(w1.data.over_contract, null, '90/100 within contract -> no flag');
    const w2 = await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-w2', project_line_id: line.id, work_date: '2026-01-08', qty: 20 });
    assert.equal(w2.status, 200, 'over-contract entry still saves');
    assert.ok(w2.data.over_contract, '110/100 flagged');
    assert.equal(w2.data.over_contract.contract_qty, 100);
    assert.equal(w2.data.over_contract.excess, 10);
    const dupOver = await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-w2', project_line_id: line.id, work_date: '2026-01-08', qty: 20 });
    assert.equal(dupOver.data.deduped, true);
    assert.ok(dupOver.data.over_contract, 'deduped replay still reports current over-contract state');
  } finally { await t.stop(); }
});

test('Technical: consumption watch opens tracked issues once, notifications follow', async () => {
  const t = await start();
  try {
    const tech = await t.mkUser('tech1', 'technical');
    const { project, tile } = await signedProject(t);
    const misc = (await t.admin.post('/api/products', { code: 'M-009', name: 'Разтворител', unit: 'л', unit_cost: 1, unit_price: 2, kind: 'material' })).data;
    const line = t.db.prepare('SELECT * FROM project_lines WHERE project_id = ? ORDER BY sort LIMIT 1').get(project.id);

    // warehouse "consume" movement over the recipe expectation (10 done -> 10.5 tiles expected; 20 consumed)
    await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-1', project_line_id: line.id, work_date: '2026-01-06', qty: 10 });
    t.db.prepare("INSERT INTO stock_movements(uid, product_id, kind, qty, project_id) VALUES (?,?,?,?,?)").run('m-1', tile.id, 'consume', 20, project.id);
    // a product that is in no recipe -> unplanned consumption
    t.db.prepare("INSERT INTO stock_movements(uid, product_id, kind, qty, project_id) VALUES (?,?,?,?,?)").run('m-2', misc.id, 'consume', 5, project.id);
    await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-2', project_line_id: line.id, work_date: '2026-01-07', qty: 1 });
    t.sync();

    const cons = (await tech.get(`/api/projects/${project.id}/consumption`)).data;
    const tileRow = cons.rows.find(r => r.product_id === tile.id);
    assert.equal(tileRow.over, true, `tile over: expected ${tileRow.expected}, consumed ${tileRow.consumed}`);
    const miscRow = cons.rows.find(r => r.product_id === misc.id);
    assert.equal(miscRow.unplanned, true, 'product outside every recipe -> unplanned');

    const issues = t.db.prepare("SELECT * FROM issues WHERE project_id = ? AND kind = 'overconsumption' AND status = 'open'").all(project.id);
    assert.equal(issues.length, 2, 'one issue per offending product');
    // second progress entry: no duplicate issues
    await tech.post(`/api/projects/${project.id}/progress`, { uid: 'u-3', project_line_id: line.id, work_date: '2026-01-08', qty: 1 });
    t.sync();
    assert.equal(t.db.prepare("SELECT COUNT(*) n FROM issues WHERE project_id = ? AND kind = 'overconsumption' AND status = 'open'").get(project.id).n, 2, 'no duplicate issues');
    // line 1 schedule item is late (ends 2026-01-09, today later, pct < 100) -> schedule_delay issue
    const delay = t.db.prepare("SELECT * FROM issues WHERE project_id = ? AND kind = 'schedule_delay'").all(project.id);
    assert.equal(delay.length, 1, 'schedule slip materialized as issue');
    const notes = t.db.prepare("SELECT * FROM notifications WHERE project_id = ? AND severity = 'warn'").all(project.id);
    assert.ok(notes.length >= 1, 'departments notified');
  } finally { await t.stop(); }
});

test('Technical: permissions — brigadier reports progress but cannot touch schedule; commercial cannot write progress', async () => {
  const t = await start();
  try {
    const tech = await t.mkUser('tech1', 'technical');
    const brig = await t.mkUser('brig1', 'brigadier');
    const com = await t.mkUser('com1', 'commercial');
    const { project } = await signedProject(t);
    const item = t.db.prepare('SELECT * FROM schedule_items WHERE project_id = ? ORDER BY sort LIMIT 1').get(project.id);
    const line = t.db.prepare('SELECT * FROM project_lines WHERE project_id = ? ORDER BY sort LIMIT 1').get(project.id);

    assert.equal((await brig.patch(`/api/schedule-items/${item.id}`, { crew: 'x', row_version: item.row_version })).status, 403, 'brigadier cannot edit schedule');
    assert.equal((await com.post(`/api/projects/${project.id}/progress`, { project_line_id: line.id, work_date: '2026-01-06', qty: 1 })).status, 403, 'commercial has no progress write');
    // brigadier is not assigned to the project -> project-level gate
    assert.equal((await brig.post(`/api/projects/${project.id}/progress`, { project_line_id: line.id, work_date: '2026-01-06', qty: 1 })).status, 403, 'unassigned brigadier blocked');
    // assign him -> allowed
    const brigId = t.db.prepare("SELECT id FROM users WHERE username = 'brig1'").get().id;
    t.db.prepare('INSERT INTO project_members(project_id, user_id, role) VALUES (?,?,?)').run(project.id, brigId, 'brigadier');
    assert.equal((await brig.post(`/api/projects/${project.id}/progress`, { project_line_id: line.id, work_date: '2026-01-06', qty: 2 })).status, 200, 'assigned brigadier reports');
  } finally { await t.stop(); }
});

test('Technical: schedule gate — free-text work lines land on the schedule, product lines do not', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t);
    await t.admin.put(`/api/offers/${s.offer.id}`, { discount_pct: 0, lines: [
      { smr_type_id: s.smr.id, description: 'Полагане на плочи', unit: 'м2', qty: 100, unit_price: 50, unit_cost: 30, planned_days: 5 },
      { description: 'Сертифициране съгласно Наредба', unit: 'бр.', qty: 1, unit_price: 300, unit_cost: 100 },
      { product_id: s.tile.id, description: 'Доставка плочи', unit: 'м2', qty: 100, unit_price: 30, unit_cost: 20 }] });
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`); t.sync();
    const p = (await t.admin.get('/api/projects')).data[0];
    const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
    await t.admin.patch(`/api/projects/${p.id}/contract`, { install_start: '2026-12-01', install_deadline: '2026-12-31', row_version: c0.row_version });
    await t.admin.post(`/api/projects/${p.id}/contract/submit`);
    await t.admin.post(`/api/projects/${p.id}/contract/approve`);
    await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2026-11-15' });
    t.sync();
    const sched = (await t.admin.get(`/api/projects/${p.id}/schedule`)).data;
    assert.equal(sched.items.length, 2, 'smr + free-text lines scheduled; product line excluded');
    assert.ok(sched.items.some(i => i.name.includes('Сертифициране')), 'free-text work line scheduled');
    assert.equal(sched.items[0].start_date, '2026-12-01');
    assert.equal(sched.items[1].start_date, '2026-12-06', 'free-text line chained after the 5-day line');
    // the product line still got its 1:1 recipe row (procurement side intact)
    const prodLine = t.db.prepare("SELECT id FROM project_lines WHERE project_id = ? AND description LIKE 'Доставка%'").get(p.id);
    assert.ok(t.db.prepare('SELECT 1 FROM project_line_recipe WHERE project_line_id = ? AND product_id = ?').get(prodLine.id, s.tile.id), 'product line recipe kept');
  } finally { await t.stop(); }
});

test('Technical: workspace + tasks — open task created on signing, complete/reopen, assigned task notifies', async () => {
  const t = await start();
  try {
    const tech = await t.mkUser('tech1', 'technical');
    const { project } = await signedProject(t);

    const ws = (await tech.get('/api/technical')).data;
    const row = ws.projects.find(p => p.id === project.id);
    assert.ok(row, 'project listed in technical workspace');
    const reviewTask = ws.tasks.find(x => x.title.includes('Технически преглед'));
    assert.ok(reviewTask, 'contract.signed created the technical review task');
    assert.equal(reviewTask.project_id, project.id);

    const done = await tech.post(`/api/tasks/${reviewTask.id}/done`);
    assert.equal(done.status, 200);
    assert.equal(done.data.status, 'done');
    assert.ok(done.data.done_at);
    const reopen = await tech.post(`/api/tasks/${reviewTask.id}/reopen`);
    assert.equal(reopen.data.status, 'open');
    assert.equal(reopen.data.done_at, null);
    assert.equal((await tech.post(`/api/tasks/${reviewTask.id}/bogus`)).status, 400);

    const mk = await tech.post('/api/tasks', { project_id: project.id, title: 'Проверка на доставка', assignee_dept: 'warehouse', due_date: '2026-01-15', priority: 'high' });
    assert.equal(mk.status, 200);
    assert.ok(mk.data.code.startsWith('TSK-'));
    t.sync();
    const n = t.db.prepare("SELECT * FROM notifications WHERE department = 'warehouse' ORDER BY id DESC LIMIT 1").get();
    assert.ok(n && n.title.includes('TSK-'), 'assigned department notified');
    assert.equal((await tech.post('/api/tasks', { title: '' })).status, 400, 'title required');

    // per-project bundle for the Project Card tasks tab
    const pt = await tech.get(`/api/projects/${project.id}/tasks`);
    assert.equal(pt.status, 200);
    assert.ok(pt.data.tasks.some(x => x.id === mk.data.id), 'project tasks listed');
    assert.ok(Array.isArray(pt.data.issues), 'project issues listed');
    const comm = await t.mkUser('comm-t', 'commercial');
    assert.equal((await comm.get(`/api/projects/${project.id}/tasks`)).status, 200, 'commercial reads the bundle');
  } finally { await t.stop(); }
});
