// Бригадир: терен интерфейс — моите обекти, дневен план, прогрес, присъствие, проблеми, снимки, съобщения.
import React, { useRef, useState } from 'react';
import { api, fmtDate, fmtDateTime, fmtNum, today } from '../api';
import { Card, Empty, Field, Link, Loader, Modal, NewVersionButton, Progress, Status, Table, Tabs, useAction, useAuth, useCan, useForm, useLoad, usePath, useToast, VersionLinks } from '../ui';

const KIND: Record<string, string> = { problem: 'Проблем', delay: 'Закъснение', material_shortage: 'Липса на материал', damage: 'Повреда', additional_work: 'Допълнителна работа', other: 'Друго' };
const SEV: Record<string, string> = { low: 'Нисък', medium: 'Среден', high: 'Висок', critical: 'Критичен' };
const ISTATUS: Record<string, [string, string]> = { open: ['Отворен', 'warn'], in_progress: ['В работа', 'info'], resolved: ['Решен', 'ok'], cancelled: ['Отменен', ''] };

export function Brigade() {
  const ws = useLoad<any>('/brigade');
  const can = useCan();
  const write = can('progress', 'write');
  const projects: any[] = ws.data?.projects || [];
  return <Loader state={ws}>
    <div className="page-head"><h1>Бригадир</h1><span className="spacer" /><Link className="btn sm" to="/technical">Технически модул →</Link></div>
    <div className="grid g3" style={{ marginBottom: 14 }}>
      {projects.map(p => <Link key={p.id} to={`/brigade/${p.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{p.code} — {p.name}</b><Status value={p.status} /></div>
        <div className="small muted">{p.customer_name}{p.site_address ? ' · ' + p.site_address : ''}</div>
        <div style={{ margin: '10px 0' }}><Progress pct={p.progress_pct} /></div>
        <div className="row small">
          <span>{p.progress_pct}% изпълнение</span><span className="spacer" />
          {p.open_issues ? <span className="badge warn">{p.open_issues} проб.</span> : null}
          {p.today_workers ? <span className="badge info">{p.today_workers} човека днес</span> : null}
        </div>
      </Link>)}
      {!projects.length && <div className="card" style={{ gridColumn: '1 / -1' }}><Empty title="Няма назначени обекти">Обектите се появяват когато администраторът ви назначи като бригадир.</Empty></div>}
    </div>
    <div className="grid c2">
      <Card title="Моите задачи" pad={false}><Table rows={ws.data?.tasks || []} empty={<Empty title="Няма отворени задачи" />} cols={[
        { key: 'code', title: '№', width: 80 }, { key: 'title', title: 'Задача' },
        { key: 'pj', title: 'Обект', render: (r: any) => r.project_code ? `${r.project_code} — ${r.project_name}` : '—' },
        { key: 'due_date', title: 'Срок', render: (r: any) => fmtDate(r.due_date) },
        { key: 'x', title: '', width: 90, render: (r: any) => write ? <button className="sm primary" onClick={async () => { await api.post(`/tasks/${r.id}/done`); ws.reload(); }}>Готово</button> : null },
      ]} /></Card>
      <Card title="Проблеми за мен" pad={false}><Table rows={ws.data?.issues || []} empty={<Empty title="Няма проблеми" />} cols={[
        { key: 'code', title: '№', width: 80 },
        { key: 'title', title: 'Проблем', render: (r: any) => <>{r.title}<div className="small muted">{r.project_code} — {r.project_name} · {KIND[r.kind] || r.kind}</div></> },
        { key: 'severity', title: 'Приоритет', render: (r: any) => <span className={'badge ' + (r.severity === 'critical' || r.severity === 'high' ? 'bad' : 'warn')}>{SEV[r.severity] || r.severity}</span> },
        { key: 'status', title: 'Статус', render: (r: any) => <span className={'badge ' + (ISTATUS[r.status]?.[1] || '')}>{ISTATUS[r.status]?.[0] || r.status}</span> },
      ]} /></Card>
    </div>
  </Loader>;
}

export function BrigadeProject({ id }: { id: number }) {
  const path = usePath();
  const [tab, setTab] = useState('plan');
  const proj = useLoad<any>(`/projects/${id}`);
  const sched = useLoad<any>(tab === 'plan' ? `/projects/${id}/schedule` : null);
  const logi = useLoad<any>(tab === 'plan' ? `/projects/${id}/logistics` : null);
  const prog = useLoad<any>(tab === 'progress' ? `/projects/${id}/progress` : null);
  const att = useLoad<any>(tab === 'attendance' ? `/projects/${id}/attendance` : null);
  const issues = useLoad<any[]>(tab === 'issues' ? `/issues?project_id=${id}` : null);
  const docs = useLoad<any[]>(tab === 'photos' ? `/projects/${id}/documents` : null);
  const msgs = useLoad<any[]>(tab === 'messages' ? `/projects/${id}/messages` : null);
  const p = proj.data;
  const reloadAll = () => { proj.reload(); sched.reload(); prog.reload(); att.reload(); issues.reload(); docs.reload(); msgs.reload(); };
  const can = useCan();
  const write = can('progress', 'write');
  const docWrite = can('documents', 'write');
  const msgWrite = can('messages', 'write');
  return <>
    <div className="page-head"><h1>{p ? `${p.code} — ${p.name}` : '…'}</h1><span className="spacer" />
      <Link className="btn sm ghost" to="/brigade">← Бригадир</Link></div>
    <Loader state={proj}>
      {p && <div className="small muted" style={{ marginBottom: 10 }}>{p.customer?.name} · {p.site_address || '—'}{p.contract?.install_deadline ? ` · монтаж до ${fmtDate(p.contract.install_deadline)}` : ''}</div>}
      <Tabs value={tab} onChange={setTab} tabs={[['plan', 'План'], ['progress', 'Прогрес'], ['attendance', 'Присъствие'], ['issues', 'Проблеми'], ['photos', 'Снимки'], ['messages', 'Съобщения']]} />
      {tab === 'plan' && <PlanTab sched={sched} logi={logi} />}
      {tab === 'progress' && <ProgressTab pid={id} prog={prog} write={write} onChanged={reloadAll} />}
      {tab === 'attendance' && <AttendanceTab pid={id} att={att} write={write} onChanged={reloadAll} />}
      {tab === 'issues' && <IssuesTab pid={id} issues={issues} write={write} onChanged={reloadAll} />}
      {tab === 'photos' && <PhotosTab pid={id} docs={docs} write={docWrite} onChanged={reloadAll} />}
      {tab === 'messages' && <MessagesTab pid={id} msgs={msgs} write={msgWrite} onChanged={reloadAll} />}
    </Loader>
  </>;
}

// ---------------------------------------------------------------- План
function PlanTab({ sched, logi }: { sched: any; logi: any }) {
  const items: any[] = sched.data?.items || [];
  const lf: any = logi.data?.logistics_fields || {};
  const notes = [['Достъп', lf.access_notes], ['Разтоварване', lf.unloading_notes], ['Съхранение', lf.storage_notes], ['Паркиране', lf.parking_notes], ['Куриерски офис', lf.courier_office]]
    .filter(([, v]) => v);
  return <div className="grid c2">
    <Loader state={sched}><Card title={`Линеен график${sched.data?.deadline ? ` · краен срок ${fmtDate(sched.data.deadline)}` : ''}`} pad={false}>
      <Table rows={items} empty={<Empty title="Няма график">Линейният график се поддържа от Техническия модул.</Empty>} cols={[
        { key: 'name', title: 'Дейност' },
        { key: 'start', title: 'Период', render: (r: any) => `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` },
        { key: 'pct', title: '%', num: true, render: (r: any) => r.pct != null ? fmtNum(r.pct, 0) + '%' : '—' },
        { key: 'st', title: 'Статус', render: (r: any) => r.behind ? <span className="badge bad">изостава</span> : r.late_days > 0 ? <span className="badge bad">къснее {r.late_days} дни</span> : <span className="badge ok">ок</span> },
      ]} /></Card></Loader>
    <div>
      {notes.length ? <Card title="Логистика на обекта" pad={false}><Table rows={notes.map(([k, v]) => ({ k, v }))} cols={[
        { key: 'k', title: '', width: 160 }, { key: 'v', title: 'Бележка' }]} /></Card> : null}
      <Card title="Инструкции към редовете" pad={false}><Loader state={sched}><Table rows={(sched.data?.lines || []).filter((l: any) => l.tech_note)} empty={<Empty title="Няма допълнителни инструкции" />} cols={[
        { key: 'code', title: 'Код', width: 90 }, { key: 'description', title: 'Ред' }, { key: 'tech_note', title: 'Инструкция' }]} /></Loader></Card>
    </div>
  </div>;
}

// ---------------------------------------------------------------- Прогрес
function ProgressTab({ pid, prog, write, onChanged }: { pid: number; prog: any; write: boolean; onChanged: () => void }) {
  const { run } = useAction();
  const f = useForm({ project_line_id: '', work_date: today(), qty: '', note: '' });
  const [uid, setUid] = useState(() => crypto.randomUUID());
  const lines: any[] = prog.data?.lines || [];
  const entries: any[] = prog.data?.entries || [];
  const toast = useToast();
  const submit = async () => {
    let over: any = null;
    const ok = await run(async () => {
      const res = await api.post<any>(`/projects/${pid}/progress`, { uid, project_line_id: Number(f.v.project_line_id), work_date: f.v.work_date, qty: Number(f.v.qty), note: f.v.note || null });
      over = res?.over_contract || null;
      setUid(crypto.randomUUID()); f.setV({ ...f.v, qty: '', note: '' }); onChanged();
    });
    if (!ok) return;
    const unit = lines.find(l => l.id === Number(f.v.project_line_id))?.unit || '';
    toast(over ? `Отчетът е записан — над договора с ${fmtNum(over.excess, 3)} ${unit}` : 'Отчетът е записан', !!over);
  };
  return <Loader state={prog}>
    {write && <Card title="Запис на извършено"><div className="form c3">
      <Field label="Ред от КС"><select {...f.bind('project_line_id')}>
        <option value="">— избери —</option>
        {lines.map(l => <option key={l.id} value={l.id}>{l.code ? l.code + ' · ' : ''}{l.description} — {fmtNum(l.done_qty)}/{fmtNum(l.qty)} {l.unit}</option>)}
      </select></Field>
      <Field label="Дата"><input type="date" {...f.bind('work_date')} max={today()} /></Field>
      <Field label="Количество"><input type="number" min="0" step="any" {...f.bind('qty')} /></Field>
      <Field label="Бележка" full><input {...f.bind('note')} placeholder="по желание" /></Field>
      <div><button className="primary" disabled={!f.v.project_line_id || !f.v.work_date || !(Number(f.v.qty) > 0)} onClick={submit}>Запиши отчет</button></div>
    </div></Card>}
    <Card title="Изпълнение по редове" pad={false}><Table rows={lines} empty={<Empty title="Няма редове" />} cols={[
      { key: 'code', title: 'Код', width: 90 }, { key: 'description', title: 'Ред' }, { key: 'unit', title: 'Мярка', width: 60 },
      { key: 'qty', title: 'Договорено', num: true, render: (r: any) => fmtNum(r.qty) }, { key: 'done_qty', title: 'Извършено', num: true, render: (r: any) => <>{fmtNum(r.done_qty)}{r.qty > 0 && r.done_qty > r.qty ? <div><span className="badge bad">над договора +{fmtNum(r.done_qty - r.qty, 3)}</span></div> : null}</> },
      { key: 'pct', title: '%', width: 130, render: (r: any) => r.pct != null ? <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.pct} /><span className="small num" style={{ width: 40 }}>{r.pct}%</span></div> : '—' },
      { key: 'spec', title: '', width: 70, render: (r: any) => r.spec_url ? <a className="sm" href={r.spec_url} target="_blank" rel="noreferrer" title="Техническа спецификация">Спец ↗</a> : null },
    ]} /></Card>
    <Card title="Дневни отчети" pad={false}><Table rows={entries} empty={<Empty title="Няма записани отчети" />} cols={[
      { key: 'work_date', title: 'Дата', render: (r: any) => fmtDate(r.work_date) }, { key: 'line_description', title: 'Ред' },
      { key: 'qty', title: 'Кол-во', num: true, render: (r: any) => <span className={r.voided ? 'muted' : ''} style={r.voided ? { textDecoration: 'line-through' } : {}}>{fmtNum(r.qty)} {r.unit}</span> },
      { key: 'note', title: 'Бележка' }, { key: 'reported_by_name', title: 'От' },
      { key: 'st', title: '', width: 110, render: (r: any) => r.voided ? <span className="badge">анулиран</span> :
        write ? <button className="sm" onClick={() => run(async () => { await api.post(`/progress-entries/${r.id}/void`); onChanged(); }, 'Записът е анулиран')}>Анулирай</button> : null },
    ]} /></Card>
  </Loader>;
}

// ---------------------------------------------------------------- Присъствие
function AttendanceTab({ pid, att, write, onChanged }: { pid: number; att: any; write: boolean; onChanged: () => void }) {
  const { run } = useAction();
  const [date, setDate] = useState(today());
  const f = useForm({ worker: '', hours: '8', team: '' });
  const rows: any[] = att.data || [];
  const dayRows = rows.filter(r => r.work_date === date);
  const add = () => run(async () => {
    await api.post('/attendance', { project_id: pid, work_date: date, worker: f.v.worker, hours: Number(f.v.hours) || 8, team: f.v.team || undefined });
    f.setV({ ...f.v, worker: '', team: '' }); onChanged();
  }, 'Присъствието е записано');
  return <>
    <Card title="Дневна присъстваща листа"><div className="form c4">
      <Field label="Дата"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      {write && <>
        <Field label="Работник"><input {...f.bind('worker')} placeholder="име и фамилия" /></Field>
        <Field label="Часове"><input type="number" min="0" step="any" {...f.bind('hours')} /></Field>
        <Field label="Екип"><input {...f.bind('team')} placeholder="група/бригада" /></Field>
        <div><button className="primary" disabled={!f.v.worker || !date} onClick={add}>Добави</button></div>
      </>}
    </div></Card>
    <Card title={`Присъстващи на ${fmtDate(date)}`} pad={false}><Table rows={dayRows} empty={<Empty title="Няма записани за датата" />} cols={[
      { key: 'worker', title: 'Работник' }, { key: 'team', title: 'Екип' }, { key: 'hours', title: 'Часове', num: true },
      { key: 'recorded_by_name', title: 'Записал' },
    ]} foot={<tr><td colSpan={2}>Общо</td><td className="num">{fmtNum(dayRows.reduce((s, r) => s + (r.hours || 0), 0), 1)}</td><td /></tr>} /></Card>
    <Card title="Последни дни" pad={false}><Table rows={rows.filter(r => r.work_date !== date).slice(0, 30)} empty={<Empty title="Няма предишни записи" />} cols={[
      { key: 'work_date', title: 'Дата', render: (r: any) => fmtDate(r.work_date) }, { key: 'worker', title: 'Работник' }, { key: 'team', title: 'Екип' }, { key: 'hours', title: 'Часове', num: true },
    ]} /></Card>
  </>;
}

// ---------------------------------------------------------------- Проблеми
function IssuesTab({ pid, issues, write, onChanged }: { pid: number; issues: any; write: boolean; onChanged: () => void }) {
  const { run, busy } = useAction();
  const { state } = useAuth();
  const [modal, setModal] = useState(false);
  const rows: any[] = issues.data || [];
  const act = (r: any, status: string, resolution?: string) => run(async () => {
    await api.patch(`/issues/${r.id}`, { status, resolution, row_version: r.row_version }); onChanged();
  }, status === 'resolved' ? 'Проблемът е решен' : 'Статусът е обновен');
  const resolve = (r: any) => { const res = window.prompt('Решение / какво е направено:'); if (res) act(r, 'resolved', res); };
  const f = useForm({ kind: 'problem', severity: 'medium', title: '', description: '', assigned_dept: 'technical' });
  const report = () => run(async () => {
    await api.post('/issues', { project_id: pid, kind: f.v.kind, severity: f.v.severity, title: f.v.title, description: f.v.description || undefined, assigned_dept: f.v.assigned_dept });
    setModal(false); onChanged();
  }, 'Проблемът е докладван');
  return <>
    {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal(true)}>+ Докладвай проблем</button></div>}
    <Card pad={false}><Loader state={issues}><Table rows={rows} empty={<Empty title="Няма проблеми">Докладвайте закъснения, липси и повреди.</Empty>} cols={[
      { key: 'code', title: '№', width: 80 },
      { key: 'title', title: 'Проблем', render: (r: any) => <>{r.title}<div className="small muted">{KIND[r.kind] || r.kind}{r.product_name ? ' · ' + r.product_name : ''}{r.line_description ? ' · ' + r.line_description : ''}</div>{r.description ? <div className="small">{r.description}</div> : null}</> },
      { key: 'severity', title: 'Приоритет', render: (r: any) => <span className={'badge ' + (r.severity === 'critical' || r.severity === 'high' ? 'bad' : 'warn')}>{SEV[r.severity] || r.severity}</span> },
      { key: 'assigned_dept_name', title: 'Към', render: (r: any) => r.assigned_dept_name || r.assigned_dept || '—' },
      { key: 'status', title: 'Статус', render: (r: any) => <>{r.status === 'resolved' && r.resolution ? <div className="small muted">{r.resolution}</div> : null}<span className={'badge ' + (ISTATUS[r.status]?.[1] || '')}>{ISTATUS[r.status]?.[0] || r.status}</span></> },
      { key: 'x', title: '', width: 220, render: (r: any) => write && r.status !== 'resolved' && r.status !== 'cancelled' ? <span className="row" style={{ flexWrap: 'nowrap' }}>
        {r.status === 'open' && <button className="sm" disabled={busy} onClick={() => act(r, 'in_progress')}>Вземи</button>}
        <button className="sm primary" disabled={busy} onClick={() => resolve(r)}>Решен</button>
        {r.status !== 'cancelled' && <button className="sm ghost" disabled={busy} onClick={() => act(r, 'cancelled')}>Отказ</button>}
      </span> : write && (r.status === 'resolved' || r.status === 'cancelled') ? <button className="sm ghost" disabled={busy} onClick={() => act(r, 'open')}>Отвори отново</button> : null },
    ]} /></Loader></Card>
    {modal && <Modal title="Докладвай проблем" onClose={() => setModal(false)} footer={<><button className="ghost" onClick={() => setModal(false)}>Отказ</button><button className="primary" disabled={busy || !f.v.title} onClick={report}>Докладвай</button></>}>
      <div className="form c2">
        <Field label="Вид"><select {...f.bind('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Приоритет"><select {...f.bind('severity')}><option value="low">Нисък</option><option value="medium">Среден</option><option value="high">Висок</option><option value="critical">Критичен</option></select></Field>
        <Field label="Към отдел"><select {...f.bind('assigned_dept')}>{state.departments.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></Field>
        <Field label="Заглавие" full><input {...f.bind('title')} required placeholder="напр. Липсва лепило за днешната работа" /></Field>
        <Field label="Описание" full><textarea {...f.bind('description')} /></Field>
      </div>
    </Modal>}
  </>;
}

// ---------------------------------------------------------------- Снимки и документи
function PhotosTab({ pid, docs, write, onChanged }: { pid: number; docs: any; write: boolean; onChanged: () => void }) {
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('photo');
  const rows: any[] = docs.data || [];
  const latest = (d: any) => d.versions?.[d.versions.length - 1];
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file); fd.append('title', title || file.name); fd.append('category', category);
    const res = await fetch(`/api/projects/${pid}/documents`, { method: 'POST', credentials: 'same-origin', body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Грешка ${res.status}`);
    setTitle(''); onChanged();
  };
  return <>
    {write && <Card title="Качи снимка или документ"><div className="row" style={{ flexWrap: 'wrap' }}>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) run(() => upload(f), 'Файлът е качен'); e.target.value = ''; }} />
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Заглавие (по желание)" style={{ minWidth: 220 }} />
      <select value={category} onChange={e => setCategory(e.target.value)}><option value="photo">Снимка</option><option value="document">Документ</option><option value="act">Акт</option><option value="other">Друго</option></select>
      <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>Избери файл</button>
    </div></Card>}
    <Card pad={false}><Loader state={docs}><Table rows={rows} empty={<Empty title="Няма файлове">Качвайте снимки от обекта и документи.</Empty>} cols={[
      { key: 'title', title: 'Файл', render: (r: any) => { const v = latest(r); return <>{r.title}<div className="small muted">{v?.filename} · {v ? Math.round(v.size / 1024) + ' KB' : ''} · {fmtDateTime(v?.created_at)}</div></> } },
      { key: 'category', title: 'Вид', render: (r: any) => ({ photo: 'Снимка', document: 'Документ', act: 'Акт', contract: 'Договор', appendix: 'Приложение', other: 'Друго' } as any)[r.category] || r.category },
      { key: 'versions', title: 'Версии', render: (r: any) => <VersionLinks doc={r} /> },
      { key: 'uploaded_by_name', title: 'Качил' },
      { key: 'x', title: '', width: 140, render: (r: any) => { const v = latest(r); return <span style={{ display: 'inline-flex', gap: 4 }}>{v ? <a className="btn sm" href={`/api/documents/${v.id}/file`} target="_blank" rel="noreferrer">Отвори</a> : null}{write && <NewVersionButton doc={r} onDone={onChanged} />}</span>; } },
    ]} /></Loader></Card>
    <div className="grid g3">{rows.flatMap(r => (r.versions || []).filter((v: any) => (v.mime || '').startsWith('image/')).map((v: any) =>
      <a key={v.id} href={`/api/documents/${v.id}/file`} target="_blank" rel="noreferrer"><img src={`/api/documents/${v.id}/file`} alt={r.title} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} /></a>))}
    </div>
  </>;
}

// ---------------------------------------------------------------- Съобщения
function MessagesTab({ pid, msgs, write, onChanged }: { pid: number; msgs: any; write: boolean; onChanged: () => void }) {
  const { run } = useAction();
  const f = useForm({ body: '' });
  const rows: any[] = msgs.data || [];
  const send = () => run(async () => {
    await api.post('/messages', { project_id: pid, body: f.v.body });
    f.setV({ ...f.v, body: '' }); onChanged();
  }, 'Съобщението е изпратено');
  return <Card title="Разговор по обекта">
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: 420, overflowY: 'auto' }}>
      {rows.map(m => <div key={m.id} style={{ background: 'var(--panel2)', borderRadius: 8, padding: '8px 12px' }}>
        <div className="small muted">{m.author_name || 'системата'} · {fmtDateTime(m.created_at)}{m.entity_type ? ` · към ${m.entity_type} #${m.entity_id}` : ''}</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
      </div>)}
      {!rows.length && <Empty title="Няма съобщения">Пишете за доставки, проблеми и координация.</Empty>}
    </div>
    {write && <div className="row"><input {...f.bind('body')} placeholder="Съобщение…" style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
      <button className="primary" disabled={!f.v.body.trim()} onClick={send}>Изпрати</button></div>}
  </Card>;
}
