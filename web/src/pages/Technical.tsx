// Техник: работно място (обекти, задачи, проблеми) и екран на обект — график, прогрес, материали.
import React, { useState } from 'react';
import { api, fmtDate, fmtMoney, fmtNum, today } from '../api';
import { Card, Empty, Field, Link, Loader, Modal, Progress, Status, Table, Tabs, navigate, useAction, useCan, useCurrency, useForm, useLoad, useToast } from '../ui';

const SEV: Record<string, [string, string]> = { low: ['Нисък', ''], medium: ['Среден', 'warn'], high: ['Висок', 'bad'], critical: ['Критичен', 'bad'] };
const ISSUE_KIND: Record<string, string> = { overconsumption: 'Наднормен разход', schedule_delay: 'Изоставане', shortage: 'Липса', quality: 'Качество', other: 'Друго' };
const PRI: Record<string, [string, string]> = { low: ['Нисък', ''], normal: ['Нормален', ''], high: ['Висок', 'warn'], urgent: ['Спешен', 'bad'] };
const Sev = ({ v }: { v: string }) => { const s = SEV[v] || [v, '']; return <span className={'badge ' + s[1]}>{s[0]}</span>; };
const Pri = ({ v }: { v: string }) => { const s = PRI[v] || [v, '']; return <span className={'badge ' + s[1]}>{s[0]}</span>; };

export function Technical() {
  const d = useLoad<any>('/technical');
  const { run } = useAction();
  const cur = useCurrency();
  const can = useCan();
  const t = today();
  return <>
    <div className="page-head"><h1>Техник — работно място</h1></div>
    <Loader state={d}>{d.data && <>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="label">Обекти в работа</div><div className="value">{d.data.projects.length}</div></div>
        <div className="kpi warn"><div className="label">Изоставащи дейности</div><div className="value">{d.data.projects.reduce((s: number, p: any) => s + p.overdue_items, 0)}</div></div>
        <div className="kpi bad"><div className="label">Отворени проблеми</div><div className="value">{d.data.issues.length}</div></div>
        <div className="kpi"><div className="label">Отворени задачи</div><div className="value">{d.data.tasks.length}</div></div>
      </div>
      <Card title="Обекти" pad={false}>
        <Table rows={d.data.projects} onRow={(r: any) => navigate(`/technical/${r.id}`)}
          empty={<Empty title="Няма активни обекти">Обектите пристигат при потвърдена оферта и подписан договор.</Empty>} cols={[
            { key: 'code', title: '№', width: 110 }, { key: 'name', title: 'Обект' }, { key: 'customer_name', title: 'Клиент' },
            { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
            { key: 'progress_pct', title: 'Изпълнение', width: 140, render: (r: any) => <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.progress_pct} /><span className="small num" style={{ width: 44 }}>{r.progress_pct}%</span></div> },
            { key: 'next_end', title: 'Следващ край', render: (r: any) => fmtDate(r.next_end) },
            { key: 'overdue_items', title: 'Изоставащи', num: true, render: (r: any) => r.overdue_items ? <span className="badge bad">{r.overdue_items}</span> : '—' },
            { key: 'open_issues', title: 'Проблеми', num: true, render: (r: any) => r.open_issues ? <span className={'badge ' + (r.critical_issues ? 'bad' : 'warn')}>{r.open_issues}</span> : '—' },
            { key: 'technical_name', title: 'Техник' }, { key: 'brigadier_name', title: 'Бригадир' },
            ...(can('finance') ? [{ key: 'contract_value', title: `Договор, ${cur}`, num: true, render: (r: any) => fmtMoney(r.contract_value) }] : []),
          ]} />
      </Card>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Задачи към Техник" pad={false}>
          <Table rows={d.data.tasks} empty={<Empty title="Няма отворени задачи" />} cols={[
            { key: 'code', title: '№', width: 90 },
            { key: 'title', title: 'Задача', render: (r: any) => <>{r.title}{r.project_code && <div className="small muted"><Link to={`/technical/${r.project_id}`}>{r.project_code} — {r.project_name}</Link></div>}</> },
            { key: 'priority', title: 'Приоритет', render: (r: any) => <Pri v={r.priority} /> },
            { key: 'due_date', title: 'Срок', render: (r: any) => <span className={r.due_date && r.due_date < t ? 'badge bad' : ''}>{fmtDate(r.due_date)}</span> },
            { key: 'x', title: '', width: 90, render: (r: any) => <button className="sm" onClick={() => run(async () => { await api.post(`/tasks/${r.id}/done`); d.reload(); }, 'Задачата е изпълнена')}>Готово</button> },
          ]} />
        </Card>
        <Card title="Отворени проблеми" pad={false}>
          <Table rows={d.data.issues} empty={<Empty title="Няма отворени проблеми" />} cols={[
            { key: 'code', title: '№', width: 90 },
            { key: 'title', title: 'Проблем', render: (r: any) => <>{r.title}<div className="small muted"><Link to={`/technical/${r.project_id}`}>{r.project_code} — {r.project_name}</Link>{r.product_code ? ` · ${r.product_code} ${r.product_name}` : ''}</div></> },
            { key: 'kind', title: 'Вид', render: (r: any) => <span className="badge">{ISSUE_KIND[r.kind] || r.kind}</span> },
            { key: 'severity', title: 'Важност', render: (r: any) => <Sev v={r.severity} /> },
            { key: 'created_at', title: 'От', render: (r: any) => fmtDate(r.created_at) },
          ]} />
        </Card>
      </div>
    </>}</Loader>
  </>;
}

export function TechnicalProject({ id }: { id: number }) {
  const proj = useLoad<any>(`/projects/${id}`);
  const sched = useLoad<any>(`/projects/${id}/schedule`);
  const prog = useLoad<any>(`/projects/${id}/progress`);
  const cons = useLoad<any>(`/projects/${id}/consumption`);
  const [tab, setTab] = useState('schedule');
  const reloadAll = () => { sched.reload(); prog.reload(); cons.reload(); };
  return <>
    <div className="page-head">
      <Loader state={proj}><h1>{proj.data?.code} — {proj.data?.name}</h1><Status value={proj.data?.status} /></Loader>
      <span className="spacer" />
      <Link to={`/projects/${id}`}>Картон на обекта →</Link>
    </div>
    <Tabs tabs={[['schedule', 'Линеен график'], ['progress', 'Дневен прогрес'], ['materials', 'Материали']]} value={tab} onChange={setTab} />
    {tab === 'schedule' && <ScheduleTab pid={id} sched={sched} onChanged={reloadAll} />}
    {tab === 'progress' && <ProgressTab pid={id} prog={prog} onChanged={reloadAll} />}
    {tab === 'materials' && <MaterialsTab cons={cons} />}
  </>;
}

// ---------------------------------------------------------------- График
const DAY = 86400000;
function ScheduleTab({ pid, sched, onChanged }: { pid: number; sched: ReturnType<typeof useLoad>; onChanged: () => void }) {
  const { run } = useAction();
  const can = useCan();
  const writable = can('technical', 'write');
  const [edit, setEdit] = useState<any>(null);
  const [add, setAdd] = useState(false);
  const ef = useForm<any>({ name: '', start_date: '', end_date: '', depends_on: '', crew: '', project_line_id: '' });
  const items: any[] = sched.data?.items || [];
  const deadline: string | null = sched.data?.deadline || null;
  const dated = items.flatMap(s => [s.baseline_start, s.baseline_end, s.start_date, s.end_date]).filter(Boolean) as string[];
  if (deadline) dated.push(deadline);
  const t = today();
  dated.push(t);
  const lo = dated.length ? dated.reduce((a, b) => a < b ? a : b) : t;
  const hi = dated.length ? dated.reduce((a, b) => a > b ? a : b) : t;
  const spanMs = Date.parse(hi) + DAY - Date.parse(lo);
  const pos = (d: string) => (Date.parse(d) - Date.parse(lo)) / spanMs * 100;
  const w = (a: string, b: string) => pos(new Date(Date.parse(b) + DAY).toISOString().slice(0, 10)) - pos(a);

  const openEdit = (s: any) => { ef.setV({ name: s.name, start_date: s.start_date || '', end_date: s.end_date || '', depends_on: s.depends_on || '', crew: s.crew || '', project_line_id: s.project_line_id || '' }); setEdit(s); };
  const openAdd = () => { ef.setV({ name: '', start_date: '', end_date: '', depends_on: '', crew: '', project_line_id: '' }); setAdd(true); };
  const saveEdit = () => run(async () => {
    await api.patch(`/schedule-items/${edit.id}`, { ...ef.v, depends_on: ef.v.depends_on === '' ? null : Number(ef.v.depends_on), crew: ef.v.crew || null, row_version: edit.row_version });
    setEdit(null); onChanged();
  }, 'Графикът е записан');
  const saveAdd = () => run(async () => {
    await api.post(`/projects/${pid}/schedule`, { name: ef.v.name, start_date: ef.v.start_date || null, end_date: ef.v.end_date || null, depends_on: ef.v.depends_on === '' ? null : Number(ef.v.depends_on), crew: ef.v.crew || null, project_line_id: ef.v.project_line_id === '' ? null : Number(ef.v.project_line_id) });
    setAdd(false); onChanged();
  }, 'Дейността е добавена');

  return <Loader state={sched}>
    <Card pad={false} title="Линеен график" actions={<>
      <span className="small muted">пунктирано = първоначален план · <span style={{ color: 'var(--bad)' }}>┆</span> договорен край · <span style={{ color: 'var(--accent)' }}>┆</span> днес</span>
      {writable && <button className="sm" onClick={openAdd}>+ Дейност</button>}
    </>}>
      {items.length === 0 ? <Empty title="Няма дейности по графика">Графикът се изгражда автоматично при подписване на договора от планираните дни на СМР редовете.</Empty> :
        <div className="table-wrap"><table className="t"><thead><tr>
          <th style={{ width: 30 }}>№</th><th>Дейност</th><th>План</th><th>Текущ срок</th><th>Екип</th><th style={{ width: 130 }}>Изпълнение</th><th className="gantt-wrap">Хронология</th>{writable && <th style={{ width: 40 }}></th>}
        </tr></thead><tbody>
          {items.map((s, i) => {
            const cls = s.late_days > 0 ? 'late' : s.behind ? 'behind' : '';
            return <tr key={s.id}>
              <td className="muted">{i + 1}</td>
              <td>{s.name}
                {s.late_days > 0 && <div className="small"><span className="badge bad">закъснение {s.late_days} дн.</span></div>}
                {s.late_days === 0 && s.behind && <div className="small"><span className="badge warn">изостава от плана</span></div>}
                {s.slip_days > 0 && <div className="small muted">изместване +{s.slip_days} дн.</div>}
              </td>
              <td className="small nowrap muted">{fmtDate(s.baseline_start)} — {fmtDate(s.baseline_end)}</td>
              <td className="small nowrap">{fmtDate(s.start_date)} — {fmtDate(s.end_date)}</td>
              <td className="small">{s.crew || '—'}</td>
              <td>{s.pct != null ? <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={s.pct} tone={cls === 'late' ? 'bad' : cls === 'behind' ? 'warn' : undefined} /><span className="small num" style={{ width: 40 }}>{s.pct}%</span></div> : <span className="muted">—</span>}</td>
              <td className="gantt-wrap"><div className="gtrack">
                {s.baseline_start && s.baseline_end && <div className="gbar base" style={{ left: pos(s.baseline_start) + '%', width: w(s.baseline_start, s.baseline_end) + '%' }} />}
                {s.start_date && s.end_date && <div className={'gbar cur ' + cls} style={{ left: pos(s.start_date) + '%', width: w(s.start_date, s.end_date) + '%' }}><i style={{ width: (s.pct ?? 0) + '%' }} /></div>}
                {!s.start_date && <span className="faint small">без дати</span>}
                {deadline && <div className="gmark deadline" style={{ left: pos(deadline) + '%' }} />}
                <div className="gmark today" style={{ left: pos(t) + '%' }} />
              </div></td>
              {writable && <td><button className="ghost sm" onClick={() => openEdit(s)}>✎</button></td>}
            </tr>;
          })}
        </tbody></table></div>}
    </Card>
    {(edit || add) && <Modal title={edit ? 'Дейност по графика' : 'Нова дейност'} onClose={() => { setEdit(null); setAdd(false); }} footer={
      <><button className="ghost" onClick={() => { setEdit(null); setAdd(false); }}>Отказ</button><button className="primary" onClick={edit ? saveEdit : saveAdd}>Запази</button></>}>
      <div className="form c2">
        <Field label="Дейност" full><input {...ef.bind('name')} required /></Field>
        {add && <Field label="Ред от КС (по желание)" full><select {...ef.bind('project_line_id')}><option value="">—</option>{(sched.data?.lines || []).map((l: any) => <option key={l.id} value={l.id}>{l.code ? l.code + ' · ' : ''}{l.description} ({l.qty} {l.unit})</option>)}</select></Field>}
        <Field label="Начало"><input type="date" {...ef.bind('start_date')} /></Field>
        <Field label="Край"><input type="date" {...ef.bind('end_date')} /></Field>
        <Field label="Зависи от"><select {...ef.bind('depends_on')}><option value="">—</option>{items.filter(x => x.id !== edit?.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Екип"><input {...ef.bind('crew')} placeholder="напр. екип 1, 3 души" /></Field>
      </div>
    </Modal>}
  </Loader>;
}

// ---------------------------------------------------------------- Прогрес
function ProgressTab({ pid, prog, onChanged }: { pid: number; prog: ReturnType<typeof useLoad>; onChanged: () => void }) {
  const { run } = useAction();
  const can = useCan();
  const writable = can('progress', 'write');
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
    {writable && <Card title="Запис на извършено"><div className="form c3">
      <Field label="Ред от КС"><select {...f.bind('project_line_id')}>
        <option value="">— избери —</option>
        {lines.map(l => <option key={l.id} value={l.id}>{l.code ? l.code + ' · ' : ''}{l.description} — {fmtNum(l.done_qty)}/{fmtNum(l.qty)} {l.unit}</option>)}
      </select></Field>
      <Field label="Дата"><input type="date" {...f.bind('work_date')} max={today()} /></Field>
      <Field label="Количество"><input type="number" min="0" step="any" {...f.bind('qty')} placeholder={f.v.project_line_id ? (lines.find(l => l.id === Number(f.v.project_line_id))?.unit || '') : ''} /></Field>
      <Field label="Бележка" full><input {...f.bind('note')} placeholder="по желание" /></Field>
      <div><button className="primary" disabled={!f.v.project_line_id || !f.v.work_date || !(Number(f.v.qty) > 0)} onClick={submit}>Запиши отчет</button></div>
    </div></Card>}
    <Card title="Изпълнение по редове КС" pad={false}><Table rows={lines} empty={<Empty title="Няма редове" />} cols={[
      { key: 'code', title: 'Код', width: 90 }, { key: 'description', title: 'Ред' }, { key: 'unit', title: 'Мярка', width: 60 },
      { key: 'qty', title: 'Договорено', num: true, render: (r: any) => fmtNum(r.qty) }, { key: 'done_qty', title: 'Извършено', num: true, render: (r: any) => <>{fmtNum(r.done_qty)}{r.qty > 0 && r.done_qty > r.qty ? <div><span className="badge bad">над договора +{fmtNum(r.done_qty - r.qty, 3)}</span></div> : null}</> },
      { key: 'pct', title: '%', width: 130, render: (r: any) => r.pct != null ? <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.pct} /><span className="small num" style={{ width: 40 }}>{r.pct}%</span></div> : '—' },
    ]} /></Card>
    <Card title="Дневни отчети" pad={false}><Table rows={entries} empty={<Empty title="Няма записани отчети" />} cols={[
      { key: 'work_date', title: 'Дата', render: (r: any) => fmtDate(r.work_date) }, { key: 'line_description', title: 'Ред' },
      { key: 'qty', title: 'Кол-во', num: true, render: (r: any) => <span className={r.voided ? 'muted' : ''} style={r.voided ? { textDecoration: 'line-through' } : {}}>{fmtNum(r.qty)} {r.unit}</span> },
      { key: 'note', title: 'Бележка' }, { key: 'reported_by_name', title: 'От' },
      { key: 'st', title: '', width: 110, render: (r: any) => r.voided ? <span className="badge">анулиран</span> :
        writable ? <button className="sm" onClick={() => run(async () => { await api.post(`/progress-entries/${r.id}/void`); onChanged(); }, 'Записът е анулиран')}>Анулирай</button> : null },
    ]} /></Card>
  </Loader>;
}

// ---------------------------------------------------------------- Материали
function MaterialsTab({ cons }: { cons: ReturnType<typeof useLoad> }) {
  const rows: any[] = cons.data?.rows || [];
  return <Loader state={cons}>
    <Card title="Материали: планирано по рецепта срещу реално изразходено" actions={<span className="small muted">допуск на наднормен разход: {cons.data?.tolerance_pct}%</span>} pad={false}>
      <Table rows={rows} empty={<Empty title="Няма материали">Материалите идват от рецептите на СМР редовете и от складовите движения по обекта.</Empty>} cols={[
        { key: 'code', title: 'Код', width: 90 }, { key: 'name', title: 'Материал' }, { key: 'unit', title: 'Мярка', width: 60 },
        { key: 'required', title: 'По договор', num: true, render: (r: any) => fmtNum(r.required) },
        { key: 'expected', title: 'По извършено', num: true, render: (r: any) => fmtNum(r.expected) },
        { key: 'consumed', title: 'Изразходено', num: true, render: (r: any) => fmtNum(r.consumed) },
        { key: 'on_site', title: 'На обекта', num: true, render: (r: any) => fmtNum(r.on_site) },
        { key: 'variance', title: 'Отклонение', num: true, render: (r: any) => <span className={r.variance > 0 ? 'badge bad' : ''}>{fmtNum(r.variance)}</span> },
        { key: 'flag', title: '', render: (r: any) => r.over ? <span className="badge bad">Наднормен</span> : r.unplanned ? <span className="badge warn">Непланиран</span> : null },
      ]} />
    </Card>
  </Loader>;
}
