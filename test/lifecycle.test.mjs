// Lifecycle: projects.status derives from project_stages; on_hold/closed are manual states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

/** offer -> confirm -> contract draft -> submit -> approve -> sign. */
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
