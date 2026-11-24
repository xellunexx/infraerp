// Lifecycle: projects.status derives from project_stages; on_hold/closed are manual states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

/** offer -> confirm -> contract draft -> submit -> approve -> sign. */
async function signedProject(t, extra = {}) {
  const s = await seedOffer(t);
  const conf = await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
  assert.equal(conf.status, 200);
  t.sync();
  const p = (await t.admin.get('/api/projects')).data[0];
  const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
  const upd = await t.admin.patch(`/api/projects/${p.id}/contract`, { install_start: '2026-01-05', install_deadline: '2026-12-20', delivery_deadline: '2025-12-28', row_version: c0.row_version, ...extra });
  assert.equal(upd.status, 200);
  await t.admin.post(`/api/projects/${p.id}/contract/submit`);
  await t.admin.post(`/api/projects/${p.id}/contract/approve`);
  const sign = await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29' });
  assert.equal(sign.status, 200);
  t.sync();
  return { ...s, project: (await t.admin.get(`/api/projects/${p.id}`)).data };
}

const status = async (t, pid) => (await t.admin.get(`/api/projects/${pid}`)).data.status;
const setStage = (t, pid, code, st) => t.admin.post(`/api/projects/${pid}/stages`, { code, status: st });

test('lifecycle: status derives from stages — preparation -> execution -> completed', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t);
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
    t.sync();
    const p = (await t.admin.get('/api/projects')).data[0];
    assert.equal(await status(t, p.id), 'contract_pending', 'unsigned contract = contract_pending');

    // drive the contract through to signed
    const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
    await t.admin.patch(`/api/projects/${p.id}/contract`, { install_start: '2026-01-05', install_deadline: '2026-12-20', delivery_deadline: '2025-12-28', row_version: c0.row_version });
    await t.admin.post(`/api/projects/${p.id}/contract/submit`);
    await t.admin.post(`/api/projects/${p.id}/contract/approve`);
    await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29' });
    t.sync();
    assert.equal(await status(t, p.id), 'preparation', 'signed contract, pre-execution = preparation');

    await setStage(t, p.id, 'execution', 'active');
    assert.equal(await status(t, p.id), 'execution', 'execution stage reached = execution');

    // finish everything except closure -> wrap-up group still counts as completed
    const stages = (await t.admin.get(`/api/projects/${p.id}`)).data.stages;
    for (const st of stages) {
      if (st.code === 'closure') continue;
      await setStage(t, p.id, st.code, st.status === 'skipped' ? 'skipped' : 'done');
    }
    assert.equal(await status(t, p.id), 'completed', 'wrap-up stages done, closure pending = completed');

    await setStage(t, p.id, 'closure', 'done');
    assert.equal(await status(t, p.id), 'completed', 'all stages done = completed (closed is manual)');
  } finally { await t.stop(); }
});

test('lifecycle: on_hold is sticky, resume re-derives; archive closes and restores', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const pid = project.id;
    await setStage(t, pid, 'execution', 'active');
    assert.equal(await status(t, pid), 'execution');

    // hold pauses derivation even when stages move
    const hold = await t.admin.patch(`/api/projects/${pid}`, { status: 'on_hold' });
    assert.equal(hold.status, 200, JSON.stringify(hold.data));
    assert.equal(await status(t, pid), 'on_hold');
    await setStage(t, pid, 'delivery_monitoring', 'done');
    assert.equal(await status(t, pid), 'on_hold', 'stage change must not override on_hold');

    // resume clears the manual state and re-derives
    const resume = await t.admin.patch(`/api/projects/${pid}`, { status: 'resume' });
    assert.equal(resume.status, 200);
    assert.equal(await status(t, pid), 'execution');

    // finish all stages -> completed
    const stages = (await t.admin.get(`/api/projects/${pid}`)).data.stages;
    for (const st of stages) await setStage(t, pid, st.code, 'done');
    assert.equal(await status(t, pid), 'completed');

    // archive = explicit close; unarchive re-derives
    const arch = await t.admin.post(`/api/projects/${pid}/archive`, { archived: true });
    assert.equal(arch.status, 200, JSON.stringify(arch.data));
    let d = (await t.admin.get(`/api/projects/${pid}`)).data;
    assert.equal(d.status, 'closed');
    assert.equal(d.archived, 1);

    const unarch = await t.admin.post(`/api/projects/${pid}/archive`, { archived: false });
    assert.equal(unarch.status, 200);
    d = (await t.admin.get(`/api/projects/${pid}`)).data;
    assert.equal(d.status, 'completed', 'unarchive re-derives from stages');
    assert.equal(d.archived, 0);
  } finally { await t.stop(); }
});

test('lifecycle: archived objects leave the Обекти list; ?archived=1 reveals them', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const pid = project.id;

    let list = (await t.admin.get('/api/projects')).data;
    assert.ok(list.some(p => p.id === pid), 'active project is listed');

    const arch = await t.admin.post(`/api/projects/${pid}/archive`, { archived: true });
    assert.equal(arch.status, 200);

    list = (await t.admin.get('/api/projects')).data;
    assert.ok(!list.some(p => p.id === pid), 'archived project must not leak into the Обекти list');

    list = (await t.admin.get('/api/projects?archived=1')).data;
    assert.ok(list.some(p => p.id === pid), '?archived=1 is the explicit opt-in to archived objects');
  } finally { await t.stop(); }
});

test('project list carries себестойност for finance roles, hides money from field roles', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const list = (await t.admin.get('/api/projects')).data;
    const row = list.find(p => p.id === project.id);
    assert.ok(row, 'project listed');
    assert.equal(row.contract_value, 6200, 'contract value from the confirmed offer');
    assert.equal(row.cost_price, 3700, 'себестойност = Σ qty×unit_cost over offer lines');

    const brig = t.client();
    const mk = await t.admin.post('/api/users', { username: 'brig-list', full_name: 'Бригадир Б', role: 'brigadier', password: 'password123' });
    const detail = (await t.admin.get(`/api/projects/${project.id}`)).data;
    await t.admin.patch(`/api/projects/${project.id}`, { brigadier_id: mk.data.id, row_version: detail.row_version });
    await brig.login('brig-list');
    const prow = (await brig.get('/api/projects')).data.find(p => p.id === project.id);
    assert.ok(prow, 'assigned brigadier sees the project');
    assert.equal(prow.contract_value, null, 'field role sees no contract value');
    assert.equal(prow.cost_price, null, 'field role sees no себестойност');
  } finally { await t.stop(); }
});

test('contract calendar: delivery deadline anchors to the real advance payment', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t, { prod_delivery_days: 30, install_days: 10 });
    const pid = project.id;
    // typed delivery_deadline (2025-12-28) predates the real advance pay date -> confused order before the fix
    const pay = await t.admin.put(`/api/projects/${pid}/contract/payments`, { kind: 'advance', paid_at: '2026-01-10' });
    assert.equal(pay.status, 200, JSON.stringify(pay.data));
    const c = (await t.admin.get(`/api/projects/${pid}/contract`)).data;
    assert.equal(c.advance_paid_at, '2026-01-10');
    assert.equal(c.delivery_due, '2026-02-09', 'delivery_due must be advance + prod days, not the stale typed date');
    assert.equal(c.delivery_due_real, true);
    assert.ok(c.delivery_due > c.advance_paid_at, 'delivery point lands AFTER the advance on the calendar');
    assert.equal(c.delivery_deadline, '2025-12-28', 'typed contract date itself is preserved');
  } finally { await t.stop(); }
});

test('contract calendar: post-signing production days are enterable; missing days never resurrect the stale typed date', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t); // срок за производство не е уточнен — идва след потвърждение от доставчик
    const pid = project.id;
    const pay = await t.admin.put(`/api/projects/${pid}/contract/payments`, { kind: 'advance', paid_at: '2026-01-10' });
    assert.equal(pay.status, 200);

    // авансът е реален, дните липсват -> въведеният преди подписа срок не може да позира като прогноза
    let c = (await t.admin.get(`/api/projects/${pid}/contract`)).data;
    assert.equal(c.advance_paid_at, '2026-01-10');
    assert.equal(c.delivery_due, null, 'typed delivery_deadline must not pose as forecast once the advance is real');
    assert.equal(c.delivery_due_real, false);

    // доставчикът потвърждава срока СЛЕД подписване — собственият поток на системата
    const upd = await t.admin.patch(`/api/projects/${pid}/contract`, { prod_delivery_days: 30, install_days: 10, row_version: c.row_version });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    c = upd.data;
    assert.equal(c.prod_delivery_days, 30);
    assert.equal(c.delivery_due, '2026-02-09');
    assert.equal(c.delivery_due_real, true);

    // договорените клаузи остават заключени след подпис — само дневните срокове се уточняват
    const bad = await t.admin.patch(`/api/projects/${pid}/contract`, { delivery_deadline: '2026-06-01', row_version: c.row_version });
    assert.equal(bad.status, 400);
  } finally { await t.stop(); }
});

test('contract sign collects the install window agreed at signing; papered dates stay locked', async () => {
  const t = await start();
  try {
    const s = await seedOffer(t);
    await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
    t.sync();
    const p = (await t.admin.get('/api/projects')).data[0];
    await t.admin.post(`/api/projects/${p.id}/contract/submit`);
    await t.admin.post(`/api/projects/${p.id}/contract/approve`);
    // одобрен договор без монтажен прозорец — а датите са заключени след чернова:
    // актът на подписване събира ги сам, не изисква ги предварително
    assert.equal((await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29' })).status, 400, 'без прозорец — отказ');
    assert.equal((await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29', install_start: '2026-06-01', install_deadline: '2026-01-05' })).status, 400, 'край преди начало — отказ');
    const c0 = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
    assert.equal((await t.admin.patch(`/api/projects/${p.id}/contract`, { install_start: '2026-01-05', row_version: c0.row_version })).status, 400, 'печатните дати остават заключени');
    const sign = await t.admin.post(`/api/projects/${p.id}/contract/sign`, { signed_on: '2025-12-29', install_start: '2026-01-05', install_deadline: '2026-12-20' });
    assert.equal(sign.status, 200, JSON.stringify(sign.data));
    const c = (await t.admin.get(`/api/projects/${p.id}/contract`)).data;
    assert.equal(c.status, 'signed');
    assert.equal(c.install_start, '2026-01-05');
    assert.equal(c.install_deadline, '2026-12-20');
  } finally { await t.stop(); }
});

test('stage revert clears the completion stamp and marks „върнат“; contract stages are domain-owned', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const stagesOf = async () => (await t.admin.get(`/api/projects/${project.id}`)).data.stages;
    await setStage(t, project.id, 'execution', 'done');
    let exec = (await stagesOf()).find(s => s.code === 'execution');
    assert.ok(exec.done_at && exec.done_by, 'done носи печат на изпълнение');
    assert.equal((await setStage(t, project.id, 'execution', 'pending')).status, 200);
    exec = (await stagesOf()).find(s => s.code === 'execution');
    assert.equal(exec.status, 'pending');
    assert.equal(exec.done_at, null, 'връщането чисти датата на изпълнение');
    assert.equal(exec.done_by, null, 'връщането чисти изпълнилия');
    assert.equal(exec.reverted, 1, 'етапът е маркиран „върнат“');
    await setStage(t, project.id, 'execution', 'done');
    exec = (await stagesOf()).find(s => s.code === 'execution');
    assert.equal(exec.reverted, 0, 'ново завършване чисти маркера');
    // етапите на договора са огледало на подписания факт — не се пипат с отметка
    assert.equal((await setStage(t, project.id, 'contract_approval', 'pending')).status, 400, 'няма ръчно връщане на одобрението');
    assert.equal((await setStage(t, project.id, 'contract_approval', 'done')).status, 200, 'done→done остава no-op');
    const ca = (await stagesOf()).find(s => s.code === 'contract_approval');
    assert.equal(ca.status, 'done', 'етапът остава отражение на подписания договор');
  } finally { await t.stop(); }
});

test('lifecycle: skipped stages count as finished; reopening regresses status', async () => {
  const t = await start();
  try {
    const { project } = await signedProject(t);
    const pid = project.id;

    // skip a mid-lifecycle stage, finish the rest -> still completed
    const stages = (await t.admin.get(`/api/projects/${pid}`)).data.stages;
    for (const st of stages) await setStage(t, pid, st.code, st.code === 'site_validation' ? 'skipped' : 'done');
    assert.equal(await status(t, pid), 'completed', 'skipped stage does not block completion');

    // reopen the wrap-up frontier -> status falls back to the execution group
    for (const code of ['completion', 'reconciliation', 'closure']) await setStage(t, pid, code, 'pending');
    assert.equal(await status(t, pid), 'execution', 'reopened frontier regresses status to delivery_monitoring phase');

    // a pending earlier stage does not hold the status back while execution is the frontier
    await setStage(t, pid, 'technical_review', 'pending');
    assert.equal(await status(t, pid), 'execution', 'pending prep stage does not mask executed work');
    await setStage(t, pid, 'completion', 'done');
    assert.equal(await status(t, pid), 'completed', 'frontier back in wrap-up = completed');
  } finally { await t.stop(); }
});
