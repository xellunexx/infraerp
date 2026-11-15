// Бригадир: работно място — само назначени обекти, присъствие, проблеми, съобщения, снимки/документи.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** offer -> confirm -> project; returns clients incl. a brigadier assigned to it. */
async function projectWithBrigadier(t) {
  const s = await seedOffer(t);
  const conf = await t.admin.post(`/api/offers/${s.offer.id}/confirm`);
  assert.equal(conf.status, 200);
  t.sync();
  const p = (await t.admin.get('/api/projects')).data[0];
  const mk = await t.admin.post('/api/users', { username: 'brig1', full_name: 'Бригадир Иван', role: 'brigadier', password: 'password123' });
  assert.equal(mk.status, 200);
  const brig = t.client();
  await brig.login('brig1');
  const detail = (await t.admin.get(`/api/projects/${p.id}`)).data;
  const up = await t.admin.patch(`/api/projects/${p.id}`, { brigadier_id: mk.data.id, row_version: detail.row_version });
  assert.equal(up.status, 200, 'admin assigns brigadier');
  return { ...s, project: (await t.admin.get(`/api/projects/${p.id}`)).data, brig, brigId: mk.data.id };
}

test('brigade: workspace scope — brigadir sees only assigned projects, gates hold', async () => {
  const t = await start();
  try {
    const { project: p, brig } = await projectWithBrigadier(t);

    const ws = (await brig.get('/api/brigade')).data;
    assert.equal(ws.projects.length, 1, 'brigadir sees exactly the assigned project');
    assert.equal(ws.projects[0].id, p.id);

    const other = await t.mkUser('other-brig', 'brigadier');
    const ws2 = (await other.get('/api/brigade')).data;
    assert.equal(ws2.projects.length, 0, 'unassigned brigadir sees no projects');
    assert.equal((await other.get(`/api/projects/${p.id}/attendance`)).status, 403, 'unassigned cannot read attendance');
    assert.equal((await other.post('/api/attendance', { project_id: p.id, work_date: '2026-02-01', worker: 'X' })).status, 403);

    const comm = await t.mkUser('comm1', 'commercial');
    assert.equal((await comm.get(`/api/projects/${p.id}/attendance`)).status, 200, 'commercial can read attendance');
    assert.equal((await comm.post('/api/attendance', { project_id: p.id, work_date: '2026-02-01', worker: 'X' })).status, 403, 'commercial cannot write attendance');
    assert.equal((await comm.post('/api/issues', { project_id: p.id, kind: 'problem', title: 'x' })).status, 403, 'commercial cannot report issues');
  } finally { await t.stop(); }
});

test('attendance: daily crew upserts per worker+date, never duplicates', async () => {
  const t = await start();
  try {
    const { project: p, brig } = await projectWithBrigadier(t);

    const a1 = await brig.post('/api/attendance', { project_id: p.id, work_date: '2026-02-02', worker: 'Иван Петров', hours: 8, team: 'Група 1' });
    assert.equal(a1.status, 200);
    const a2 = await brig.post('/api/attendance', { project_id: p.id, work_date: '2026-02-02', worker: 'Иван Петров', hours: 4, team: 'Група 2' });
    assert.equal(a2.status, 200);
    await brig.post('/api/attendance', { project_id: p.id, work_date: '2026-02-02', worker: 'Мария', hours: 8 });

    const day = (await brig.get(`/api/projects/${p.id}/attendance?date=2026-02-02`)).data;
    assert.equal(day.length, 2, 'same worker+date stays one row');
    const ivan = day.find(r => r.worker === 'Иван Петров');
    assert.equal(ivan.hours, 4, 're-post corrects hours');
    assert.equal(ivan.team, 'Група 2');
    assert.ok(ivan.recorded_by_name, 'recorder name joined');

    const other = (await brig.get(`/api/projects/${p.id}/attendance?date=2026-02-03`)).data;
    assert.equal(other.length, 0, 'other dates empty');
  } finally { await t.stop(); }
});

test('issues: report -> in_progress -> resolved (resolution required) -> reopen, notifies assigned dept', async () => {
  const t = await start();
  try {
    const { project: p, brig } = await projectWithBrigadier(t);
    const tech = await t.mkUser('tech1', 'technical');

    const bad = await brig.post('/api/issues', { project_id: p.id, kind: 'problem' });
    assert.equal(bad.status, 400, 'title required');

    const i = (await brig.post('/api/issues', { project_id: p.id, kind: 'material_shortage', severity: 'high',
      title: 'Липсва лепило', description: 'Няма достатъчно за днешния обем', assigned_dept: 'technical' })).data;
    assert.ok(i.code.startsWith('ISS-'), 'issue gets ISS code');
    assert.equal(i.status, 'open');
    assert.equal(i.assigned_dept, 'technical');

    t.sync();
    const notes = t.db.prepare("SELECT department, title FROM notifications WHERE project_id = ? AND title LIKE '%" + i.code + "%'").all(p.id);
    assert.ok(notes.some(n => n.department === 'technical'), 'technical dept notified of new issue');

    const ip = (await tech.patch(`/api/issues/${i.id}`, { status: 'in_progress', row_version: i.row_version })).data;
    assert.equal(ip.status, 'in_progress');
    assert.equal((await tech.patch(`/api/issues/${i.id}`, { status: 'resolved', row_version: ip.row_version })).status, 400, 'resolution note required');
    const res = (await tech.patch(`/api/issues/${i.id}`, { status: 'resolved', resolution: 'Доставено количество', row_version: ip.row_version })).data;
    assert.equal(res.status, 'resolved');
    assert.ok(res.resolved_at, 'resolved_at stamped');

    const re = (await brig.patch(`/api/issues/${i.id}`, { status: 'open', row_version: res.row_version })).data;
    assert.equal(re.status, 'open', 'brigadir can reopen');

    const list = (await brig.get(`/api/issues?project_id=${p.id}`)).data;
    assert.ok(list.some(x => x.id === i.id && x.reported_by_name), 'issue list joins reporter');
    const ws = (await brig.get('/api/brigade')).data;
    assert.ok(ws.issues.some(x => x.id === i.id), 'workspace inbox carries the issue');
  } finally { await t.stop(); }
});

test('messages: project thread, author join, permission gate', async () => {
  const t = await start();
  try {
    const { project: p, brig } = await projectWithBrigadier(t);

    const m = (await brig.post('/api/messages', { project_id: p.id, body: 'Складът закъснява с доставката' })).data;
    assert.ok(m.id);
    const thread = (await brig.get(`/api/projects/${p.id}/messages`)).data;
    assert.equal(thread.length, 1);
    assert.equal(thread[0].author_name, 'Бригадир Иван');
    assert.equal((await brig.post('/api/messages', { project_id: p.id, body: '' })).status, 400, 'empty body rejected');

    const comm = await t.mkUser('comm1', 'commercial');
    assert.equal((await comm.get(`/api/projects/${p.id}/messages`)).status, 200);
    assert.equal((await comm.post('/api/messages', { project_id: p.id, body: 'Ок, бригадир' })).status, 200);
  } finally { await t.stop(); }
});

test('documents: photo upload -> list -> download roundtrip with mime + sha256', async () => {
  const t = await start();
  try {
    const { project: p, brig } = await projectWithBrigadier(t);
    const login = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'brig1', password: 'password123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'site.png');
    fd.append('title', 'Снимка на обекта');
    fd.append('category', 'photo');
    const up = await fetch(t.base + `/api/projects/${p.id}/documents`, { method: 'POST', headers: { cookie }, body: fd });
    assert.equal(up.status, 200, 'upload accepted: ' + await up.clone().text().catch(() => ''));
    const doc = await up.json();
    assert.equal(doc.category, 'photo');
    assert.equal(doc.current_version, 1);
    assert.ok(doc.versions[0].sha256, 'sha256 stored');
    assert.ok(doc.versions[0].stored_name, 'file stored on disk');

    const list = (await brig.get(`/api/projects/${p.id}/documents`)).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].uploaded_by_name, 'Бригадир Иван');

    const dl = await fetch(t.base + `/api/documents/${doc.versions[0].id}/file`, { headers: { cookie } });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.deepEqual(buf, PNG, 'bytes roundtrip identical');

    const bad = new FormData();
    bad.append('file', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'evil.exe');
    bad.append('title', 'x'); bad.append('category', 'photo');
    const rej = await fetch(t.base + `/api/projects/${p.id}/documents`, { method: 'POST', headers: { cookie }, body: bad });
    assert.equal(rej.status, 400, 'exe mime rejected');
  } finally { await t.stop(); }
});
