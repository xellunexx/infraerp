// Картон на обекта: the single project workspace. Every tab reads the shared project records; nothing is copied.
import React, { useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../api';
import { WeatherCard } from './Weather';
import { Card, DeptBadge, Empty, Field, Kpi, Link, Loader, Modal, NewVersionButton, Progress, Status, Table, Tabs, navigate, useAction, useCan, useCurrency, useForm, useLoad, usePath, VersionLinks } from '../ui';

const EVENT_LABEL: Record<string, string> = { 'offer.confirmed': 'Потвърдена оферта', 'contract.submitted': 'Договор изпратен за одобрение', 'contract.signed': 'Подписан договор',
  'project.assigned': 'Определен отговорник', 'stage.changed': 'Промяна на етап', 'request.created': 'Заявка за материали', 'progress.recorded': 'Отчетено изпълнение',
  'amendment.approved': 'Одобрен анекс', 'delivery.changed': 'Промяна по доставка', 'issue.reported': 'Докладван проблем',
  'contract.payment_recorded': 'Плащане по договора', 'project.reopen_requested': 'Заявка за връщане', 'project.reopened': 'Обектът е върнат в изпълнение',
  'project.reopen_decided': 'Решение по връщане', 'supplier_order.created': 'Нова поръчка към доставчик', 'supplier_order.payment': 'Плащане по поръчка',
  'material_request.submitted': 'Заявка за материали', 'material_request.approved': 'Одобрена заявка', 'material_request.fulfilled': 'Изпълнена заявка',
  'material_request.cancelled': 'Отменена заявка', 'warehouse.transfer': 'Пренос на материали', 'warehouse.movement': 'Складово движение' };
const PLANNED = ['Технически спецификации', 'Склад'];

function ContractTab({ pid, onChange }: { pid: number; onChange: () => void }) {
  const c = useLoad<any>(`/projects/${pid}/contract`);
  const can = useCan();
  const cur = useCurrency();
  const { run, busy } = useAction();
  const f = useForm<any>({});
  const [ver, setVer] = useState<any | null>(null);
  useEffect(() => { if (c.data) f.setV({ template: c.data.template, special_terms: c.data.special_terms || '', delivery_deadline: c.data.delivery_deadline || '', install_start: c.data.install_start || '',
    install_deadline: c.data.install_deadline || '', advance_pct: c.data.advance_pct, payment_terms_days: c.data.payment_terms_days,
    contract_kind: c.data.contract_kind || 'standard', prod_delivery_days: c.data.prod_delivery_days ?? '', install_days: c.data.install_days ?? '' }); }, [c.data?.row_version]);
  const docs = useLoad<any[]>(`/projects/${pid}/documents`);
  const d = c.data;
  if (!d) return <Loader state={c}><Empty title="Няма договор за този обект" /></Loader>;
  const write = can('contracts', 'write'), draft = d.status === 'draft' && write;
  const daysDirty = !draft && write && (String(f.v.prod_delivery_days ?? '') !== String(d.prod_delivery_days ?? '') || String(f.v.install_days ?? '') !== String(d.install_days ?? ''));
  const saveContract = () => run(async () => {
    const body = draft ? { ...f.v } : { prod_delivery_days: f.v.prod_delivery_days === '' ? null : f.v.prod_delivery_days, install_days: f.v.install_days === '' ? null : f.v.install_days };
    await api.patch(`/projects/${pid}/contract`, { ...body, row_version: d.row_version }); await c.reload();
  }, 'Договорът е записан');
  const special = d.template !== 'standard' || !!d.special_terms;
  const act = (name: string, body: any = {}, ok?: string) => run(async () => { await api.post(`/projects/${pid}/contract/${name}`, body); await c.reload(); onChange(); }, ok);
  return <>
    <Card title={<span>Договор {d.code} <Status value={d.status} /> {d.active_version ? <span className="badge">версия {d.active_version}</span> : null}</span>} actions={<>
      {(draft || daysDirty) && <button disabled={busy} onClick={saveContract}>Запис</button>}
      {draft && <button className="primary" disabled={busy} onClick={() => act('submit', {}, 'Изпратен за одобрение')}>Изпрати за одобрение</button>}
      {d.status === 'review' && write && <button disabled={busy} onClick={() => act('return', { note: window.prompt('Причина за връщане:') || '' }, 'Върнат за корекция')}>Върни за корекция</button>}
      {d.status === 'review' && (special ? can('approvals', 'approve') : write) && <button className="primary" disabled={busy} onClick={() => act('approve', {}, 'Договорът е одобрен. Създадена е версия 1.')}>Одобри</button>}
      {d.status === 'approved' && write && <button className="primary" disabled={busy} onClick={() => act('sign', { signed_on: window.prompt('Дата на подписване (ГГГГ-ММ-ДД):', new Date().toISOString().slice(0, 10)) || undefined }, 'Договорът е подписан. Сроковете са активни.')}>Отбележи като подписан</button>}</>}>
      {d.status === 'review' && special && <div className="alert warn">Договорът е със специални условия и се одобрява от Управител.</div>}
      {d.status !== 'draft' && <div className="alert">Договорените клаузи са заключени — промени в количества, цени и дати се правят с анекс. Дневните срокове се уточняват и след подпис.</div>}
      <div className="form c3">
        <Field label="Образец"><select {...f.bind('template')} disabled={!draft}><option value="standard">Стандартен</option><option value="special">Със специални условия</option></select></Field>
        <Field label="Вид на договора"><select {...f.bind('contract_kind')} disabled={!draft}><option value="standard">Наш образец</option><option value="client_template">По образец на възложителя</option></select></Field>
        <Field label="Аванс %"><input type="number" min="0" max="100" {...f.bind('advance_pct')} disabled={!draft} /></Field>
        <Field label="Срок за плащане (дни)"><input type="number" min="0" {...f.bind('payment_terms_days')} disabled={!draft} /></Field>
        <Field label="Срок производство + доставка (дни)"><input type="number" min="0" {...f.bind('prod_delivery_days')} disabled={!write} /></Field>
        <Field label="Срок за монтаж (дни)"><input type="number" min="0" {...f.bind('install_days')} disabled={!write} /></Field>
        <Field label="Срок за доставка"><input type="date" {...f.bind('delivery_deadline')} disabled={!draft} /></Field>
        <Field label="Начало на монтажа"><input type="date" {...f.bind('install_start')} disabled={!draft} /></Field>
        <Field label="Краен срок за монтаж"><input type="date" {...f.bind('install_deadline')} disabled={!draft} /></Field>
        <Field label="Специални условия (от Управител или Оферти)" full><textarea {...f.bind('special_terms')} disabled={!draft} /></Field>
      </div>
    </Card>
    <ContractTimeline d={d} />
    <PaymentsCard pid={pid} d={d} cur={cur} write={write} busy={busy} onSaved={async () => { await c.reload(); onChange(); }} />
    <ContractFiles pid={pid} contract={d} docs={docs} write={write} />
    <Card title={`Приложения${d.active_version ? ` към версия ${d.active_version}` : ' (проект)'}`}>
      {d.appendices.map((a: any) => <details key={a.id} style={{ marginBottom: 8 }} open={a.number === 3}><summary><b>{a.title}</b></summary><div className="pre mono" style={{ padding: '8px 0 0 14px' }}>{a.body}</div></details>)}
    </Card>
    <Card title="Версии на договора" pad={false}><Table rows={d.versions} onRow={async r => setVer(await api.get(`/contract-versions/${r.id}`))} empty={<Empty title="Още няма одобрена версия">Версия 1 се създава при одобрение на договора.</Empty>} cols={[
      { key: 'version', title: 'Версия', render: r => 'v' + r.version }, { key: 'reason', title: 'Основание' }, { key: 'total_value', title: `Стойност, ${cur}`, num: true, render: r => fmtMoney(r.total_value) },
      { key: 'approved_by_name', title: 'Одобрил' }, { key: 'created_at', title: 'Дата', render: r => fmtDateTime(r.created_at) }]} /></Card>
    {ver && <Modal wide title={`Договор ${d.code} — версия ${ver.version}`} onClose={() => setVer(null)}>
      <p className="muted">{ver.reason} · {fmtDateTime(ver.created_at)} · неизменяем запис</p>
      <Table rows={ver.snapshot.lines} cols={[{ key: 'description', title: 'Описание' }, { key: 'unit', title: 'Мярка' }, { key: 'qty', title: 'Количество', num: true, render: (r: any) => fmtNum(r.qty, 3) },
        { key: 'unit_price', title: 'Ед. цена', num: true, render: (r: any) => fmtMoney(r.unit_price) }, { key: 't', title: 'Стойност', num: true, render: (r: any) => fmtMoney(r.qty * r.unit_price) }]}
        foot={<tr><td colSpan={4}>Общо без ДДС</td><td className="num">{fmtMoney(ver.snapshot.total)}</td></tr>} />
    </Modal>}
  </>;
}

// Прикачени файлове към договора/приложенията: всяка версия се пази, новата не презаписва старата.
function ContractFiles({ pid, contract, docs, write }: { pid: number; contract: any; docs: any; write: boolean }) {
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState('contract');
  const rows: any[] = (docs.data || []).filter((r: any) => r.entity_type === 'contract' || r.entity_type === 'appendix');
  const attach = (file: File) => {
    const fd = new FormData();
    fd.append('file', file); fd.append('title', file.name);
    if (target === 'contract') { fd.append('entity_type', 'contract'); fd.append('entity_id', String(contract.id)); fd.append('category', 'contract'); }
    else { fd.append('entity_type', 'appendix'); fd.append('entity_id', target); fd.append('category', 'appendix'); }
    return run(async () => {
      const res = await fetch(`/api/projects/${pid}/documents`, { method: 'POST', credentials: 'same-origin', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Грешка ${res.status}`);
      await docs.reload();
    }, 'Файлът е прикачен');
  };
  return <Card title="Прикачени файлове" actions={write && <>
    <select value={target} onChange={e => setTarget(e.target.value)}>
      <option value="contract">Договор</option>
      {(contract.appendices || []).map((a: any) => <option key={a.id} value={a.id}>{a.title}</option>)}
    </select>
    <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.txt,.csv,image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ''; }} />
    <button disabled={busy} onClick={() => fileRef.current?.click()}>Прикачи файл</button></>}>
    <Loader state={docs}><Table rows={rows} empty={<Empty title="Няма прикачени файлове">Договорът и приложенията приемат файлове — всяка нова версия се пази отделно.</Empty>} cols={[
      { key: 'title', title: 'Файл', render: (r: any) => { const v = r.versions?.[r.versions.length - 1]; return <>{r.title}<div className="small muted">{v?.filename} · {fmtDateTime(v?.created_at)} · {r.uploaded_by_name || ''}</div></> } },
      { key: 'entity', title: 'Към', render: (r: any) => r.entity_type === 'appendix' ? `Приложение #${r.entity_id}` : 'Договор' },
      { key: 'versions', title: 'Версии', render: (r: any) => <VersionLinks doc={r} /> },
      { key: 'x', title: '', width: 140, render: (r: any) => { const v = r.versions?.[r.versions.length - 1]; return <span style={{ display: 'inline-flex', gap: 4 }}>{v ? <a className="btn sm" href={`/api/documents/${v.id}/file`} target="_blank" rel="noreferrer">Отвори</a> : null}{write && <NewVersionButton doc={r} onDone={() => docs.reload()} />}</span>; } },
    ]} /></Loader>
  </Card>;
}

// Договорен календар: етапите на договора върху реалните им дати — лента с напредъка
// на времето и маркер „днес“. Данните идват от contractView: signed_on, advance_paid_at,
// срокове в дни, install_*/delivery_deadline, payments[].paid_at, final_deadline.
const DAY_MS = 86400000;
function ContractTimeline({ d }: { d: any }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const T = today.getTime();
  const ts = (s: any) => (s ? Date.parse(s) : NaN);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const prodEnd = d.advance_paid_at && d.prod_delivery_days != null ? ts(d.advance_paid_at) + Number(d.prod_delivery_days) * DAY_MS : NaN;
  const instStart = ts(d.install_start) || prodEnd;
  const instEnd = ts(d.install_deadline) || ts(d.final_deadline);

  const unpaid = (d.payments || []).some((p: any) => !p.paid_at);
  const pastDeadline = ts(d.final_deadline) && ts(d.final_deadline) < T;
  const deliveryDue = ts(d.delivery_due); // delivery_due се дерива на сървъра — отпада когато срокът не е уточнен
  type Pt = { t: number; label: string; state: 'done' | 'active' | 'pending' | 'late' };
  const pts: Pt[] = ([
    { t: ts(d.signed_on), label: 'Подписан', state: d.signed_on ? 'done' : 'pending' },
    { t: ts(d.advance_paid_at), label: 'Аванс платен', state: d.advance_paid_at ? 'done' : 'pending' },
    { t: deliveryDue, label: d.delivery_due_real ? 'Доставка до' : 'Доставка до (прогноза)', state: (deliveryDue && deliveryDue < T ? 'done' : 'pending') as Pt['state'] },
    { t: ts(d.final_deadline), label: 'Краен срок', state: pastDeadline ? (unpaid ? 'late' : 'done') : 'pending' },
  ] as Pt[]).filter(p => !isNaN(p.t));

  type Seg = { a: number; b: number; label: string; state: 'done' | 'active' | 'pending' | 'late' };
  const segs: Seg[] = [];
  if (!isNaN(ts(d.advance_paid_at)) && !isNaN(prodEnd)) segs.push({ a: ts(d.advance_paid_at), b: prodEnd, label: 'Производство и доставка', state: prodEnd < T ? 'done' : T >= ts(d.advance_paid_at) ? 'active' : 'pending' });
  if (!isNaN(instStart) && !isNaN(instEnd)) segs.push({ a: instStart, b: instEnd, label: 'Монтаж', state: instEnd < T ? 'done' : T >= instStart ? 'active' : 'pending' });
  const payDots = (d.payments || []).filter((p: any) => p.paid_at && p.kind !== 'advance').map((p: any) => ({ t: ts(p.paid_at), label: p.kind === 'interim' ? 'Междинно плащане' : 'Окончателно плащане' }));

  const known = [...pts.map(p => p.t), ...segs.flatMap(s => [s.a, s.b]), ...payDots.map((p: any) => p.t)].filter(t => !isNaN(t));
  const late = pastDeadline && unpaid;
  if (known.length < 2) return <Card title="Договорен календар"><div className="muted small">
    Етапите ще се подредят на лентата, щом има поне две дати — подписване, платен аванс и сроковете в дни активират графика.{d.final_deadline ? ` Краен срок: ${fmtDate(d.final_deadline)}.` : ''}</div></Card>;

  const pad = Math.max((Math.max(...known) - Math.min(...known)) * 0.03, 2 * DAY_MS);
  const t0 = Math.min(...known) - pad, t1 = Math.max(Math.max(...known), T) + pad;
  const X = (t: number) => ((t - t0) / (t1 - t0)) * 100;
  const fillTo = Math.min(Math.max(T, t0), t1);

  return <Card title="Договорен календар" actions={late ? <span className="badge bad">просрочен краен срок</span> : d.final_deadline ? <span className="badge">към {fmtDate(d.final_deadline)}</span> : undefined}>
    <div className="ctline">
      <div className="ctl-track"><i className={late ? 'ctl-fill late' : 'ctl-fill'} style={{ width: X(fillTo) + '%' }} /></div>
      {segs.map((s, i) => <div key={i} className={'ctl-seg ' + s.state} style={{ left: X(s.a) + '%', width: Math.max(X(s.b) - X(s.a), 0.8) + '%' }}><span>{s.label}<br />{fmtDate(iso(s.a))}–{fmtDate(iso(s.b))}</span></div>)}
      {pts.filter(p => !isNaN(p.t)).map((p, i) => <div key={i} className={'ctl-pt ' + p.state} style={{ left: X(p.t) + '%' }}><i /><div><b>{p.label}</b><span>{fmtDate(iso(p.t))}</span></div></div>)}
      {payDots.map((p: any, i: number) => <div key={'p' + i} className="ctl-pay" style={{ left: X(p.t) + '%' }}><i /><span>{p.label}<br />{fmtDate(iso(p.t))}</span></div>)}
      <div className="ctl-today" style={{ left: X(T) + '%' }}><span>днес</span></div>
    </div>
    {d.advance_paid_at && <div className="muted small" style={{ marginTop: 10 }}>
      Аванс {fmtDate(d.advance_paid_at)}{d.prod_delivery_days != null ? ` → производство/доставка до ${fmtDate(iso(prodEnd))}` : ' — въведете срок производство + доставка за реална дата'}{d.install_days != null && d.final_deadline ? ` → монтаж до ${fmtDate(d.final_deadline)}` : ''}</div>}
  </Card>;
}

const MS: [string, string][] = [['advance', 'Аванс'], ['interim', 'Междинно плащане'], ['final', 'Окончателно плащане']];
function PaymentsCard({ pid, d, cur, write, busy, onSaved }: { pid: number; d: any; cur: string; write: boolean; busy: boolean; onSaved: () => Promise<void> }) {
  const { run } = useAction();
  const rows = MS.map(([k, label]) => ({ k, label, p: (d.payments || []).find((x: any) => x.kind === k) || { kind: k, pct: null, amount: null, paid_at: null, note: null } }));
  const save = (k: string, f: any) => run(async () => { await api.put(`/projects/${pid}/contract/payments`, { kind: k, pct: f.pct === '' ? null : Number(f.pct), amount: f.amount === '' ? null : Number(f.amount), paid_at: f.paid_at || null, note: f.note || null }); await onSaved(); }, 'Плащането е записано');
  return <Card title="Разплащателен график" actions={d.final_deadline ? <span className="badge warn">Краен срок по договора: {fmtDate(d.final_deadline)}</span> : <span className="muted small">крайният срок се изчислява след платен аванс + срокове</span>}>
    <div className="table-wrap"><table className="t"><thead><tr>
      <th>Плащане</th><th className="num">%</th><th className="num">Сума, {cur}</th><th>Платено на</th><th>Бележка</th>{write && <th style={{ width: 60 }} />}</tr></thead>
      <tbody>{rows.map(({ k, label, p }) => <MilestoneRow key={k} kind={k} label={label} p={p} disabled={!write || busy} onSave={save} />)}</tbody></table></div>
    {d.advance_paid_at && <div className="muted small" style={{ marginTop: 8 }}>Аванс платен {fmtDate(d.advance_paid_at)}{d.prod_delivery_days != null ? ` + ${d.prod_delivery_days} дн. производство/доставка` : ''}{d.install_days != null ? ` + ${d.install_days} дн. монтаж` : ''}{d.final_deadline ? ` → ${fmtDate(d.final_deadline)}` : ' — въведете двата срока за изчисление'}</div>}
  </Card>;
}
function MilestoneRow({ kind, label, p, disabled, onSave }: any) {
  const f = useForm({ pct: p.pct ?? '', amount: p.amount ?? '', paid_at: p.paid_at || '', note: p.note || '' });
  const dirty = String(f.v.pct) !== String(p.pct ?? '') || String(f.v.amount) !== String(p.amount ?? '') || f.v.paid_at !== (p.paid_at || '') || f.v.note !== (p.note || '');
  return <tr><td><b>{label}</b></td>
    <td className="num"><input type="number" min="0" max="100" style={{ width: 64, textAlign: 'right' }} {...f.bind('pct')} disabled={disabled} /></td>
    <td className="num"><input type="number" min="0" step="any" style={{ width: 110, textAlign: 'right' }} {...f.bind('amount')} disabled={disabled} /></td>
    <td><input type="date" style={{ width: 140 }} {...f.bind('paid_at')} disabled={disabled} /></td>
    <td><input style={{ width: '100%' }} {...f.bind('note')} disabled={disabled} /></td>
    {!disabled && <td>{dirty && <button className="primary sm" onClick={() => onSave(kind, f.v)}>Запис</button>}</td>}</tr>;
}

export function ProjectCard({ id }: { id: number }) {
  const p = useLoad<any>(`/projects/${id}`);
  const can = useCan();
  const cur = useCurrency();
  const path = usePath();
  const users = useLoad<any[]>('/users');
  const [tab, setTab] = useState(new URLSearchParams(path.split('?')[1] || '').get('tab') || 'overview');
  const timeline = useLoad<any[]>(tab === 'timeline' || tab === 'overview' ? `/projects/${id}/timeline` : null, [p.data?.row_version]);
  const audit = useLoad<any[]>(tab === 'audit' ? `/projects/${id}/audit` : null);
  const sched = useLoad<any>(tab === 'schedule' ? `/projects/${id}/schedule` : null);
  const prog = useLoad<any>(tab === 'progress' ? `/projects/${id}/progress` : null);
  const logi = useLoad<any>(tab === 'logistics' ? `/projects/${id}/logistics` : null);
  const tasks = useLoad<any>(tab === 'tasks' ? `/projects/${id}/tasks` : null);
  const docs = useLoad<any[]>(tab === 'docs' ? `/projects/${id}/documents` : null);
  const msgs = useLoad<any[]>(tab === 'messages' ? `/projects/${id}/messages` : null);
  const { run, busy } = useAction();
  const d = p.data;
  if (!d) return <Loader state={p}><div /></Loader>;
  const write = can('projects', 'write'), money = !!d.finance;
  const patch = (body: any, ok?: string) => run(async () => { await api.patch(`/projects/${id}`, { ...body, row_version: d.row_version }); await p.reload(); }, ok);
  const stage = (code: string, status: string) => run(async () => { await api.post(`/projects/${id}/stages`, { code, status }); await p.reload(); });
  const pending = (timeline.data || []).filter(e => e.status === 'pending' || e.status === 'processing').length, failed = (timeline.data || []).filter(e => e.status === 'failed').length;
  const tabs: [string, string][] = [['overview', 'Преглед'], ['customer', 'Клиент и обект'], ...(can('contracts') ? [['contract', 'Договор и приложения'] as [string, string]] : []), ['lines', 'КС и рецепти'],
    ...(can('finance') ? [['finance', 'Финанси'] as [string, string]] : []),
    ...(can('technical') ? [['schedule', 'График'] as [string, string]] : []),
    ...(can('progress') ? [['progress', 'Изпълнение'] as [string, string]] : []),
    ...(can('logistics') ? [['logistics', 'Логистика'] as [string, string]] : []),
    ...(can('tasks') ? [['tasks', 'Задачи'] as [string, string]] : []),
    ...(can('documents') ? [['docs', 'Документи'] as [string, string]] : []),
    ...(can('messages') ? [['messages', 'Съобщения'] as [string, string]] : []),
    ['timeline', 'Хронология'], ['audit', 'Одит'], ['planned', 'Предстоящи']];
  return <>
    <div className="page-head">
      <div><div className="muted small"><Link to="/projects">Обекти</Link> / {d.customer.name}</div><h1>{d.code} · {d.name} <Status value={d.status} /></h1><div className="muted">{d.site_address || 'няма въведен адрес'}</div></div>
      <span className="spacer" />{d.offer && can('offers') && <button onClick={() => navigate(`/offers/${d.offer.id}`)}>Оферта {d.offer.code} v{d.offer.confirmed_version}</button>}
      {write && d.status !== 'closed' && (d.status === 'on_hold'
        ? <button className="sm" disabled={busy} onClick={() => patch({ status: 'resume' }, 'Обектът е възобновен')}>Възобнови</button>
        : <button className="sm ghost" disabled={busy} onClick={() => patch({ status: 'on_hold' }, 'Обектът е поставен на пауза')}>Пауза</button>)}
      {write && (d.archived
        ? <button className="sm" disabled={busy} onClick={() => run(async () => { await api.post(`/projects/${id}/archive`, { archived: false }); await p.reload(); }, 'Обектът е възстановен от архив')}>Възстанови от архив</button>
        : <button className="sm ghost" disabled={busy} onClick={() => { if (window.confirm('Архивиране затваря обекта (статус „Закрит“). Да продължа?')) run(async () => { await api.post(`/projects/${id}/archive`, { archived: true }); await p.reload(); }, 'Обектът е архивиран'); }}>Архивирай</button>)}
      {d.status === 'completed' && write && !d.reopen_request &&
        <button className="sm" disabled={busy} onClick={() => { const reason = window.prompt('Причина за връщане на обекта (задължителна):'); if (reason?.trim()) run(async () => { await api.post(`/projects/${id}/reopen-request`, { reason }); await p.reload(); }, 'Заявката е изпратена за решение от Управител'); }}>Заяви връщане</button>}
    </div>
    {d.reopen_request && <div className="alert warn">Заявено връщане на обекта от {d.reopen_request.requested_by_name || '—'}: „{d.reopen_request.decision_note}“ — чака решение на Управител.
      {can('approvals', 'approve') && <span className="row" style={{ flexWrap: 'nowrap', marginLeft: 10 }}>
        <button className="sm primary" disabled={busy} onClick={() => run(async () => { await api.post(`/projects/${id}/reopen-decide`, { action: 'approve' }); await p.reload(); }, 'Обектът е върнат в изпълнение')}>Върни в изпълнение</button>
        <button className="sm ghost" disabled={busy} onClick={() => { const note = window.prompt('Причина за отказ:'); if (note != null) run(async () => { await api.post(`/projects/${id}/reopen-decide`, { action: 'reject', note }); await p.reload(); }, 'Заявката е отхвърлена'); }}>Откажи</button></span>}
    </div>}
    <div className="grid g4 kpis-m" style={{ marginBottom: 14 }}>
      <Kpi label="Изпълнение" value={d.progress_pct + '%'} sub={<Progress pct={d.progress_pct} />} />
      {money ? <Kpi label={`Договорна стойност, ${cur}`} value={fmtMoney(d.finance.contract_value)} sub={`себестойност ${fmtMoney(d.finance.cost_price)}`} /> : <Kpi label="Договор" value={d.contract ? d.contract.code : '—'} sub={d.contract && <Status value={d.contract.status} />} />}
      <Kpi label="Планирано изпълнение" value={d.planned_start ? `${fmtDate(d.planned_start)} – ${fmtDate(d.planned_end)}` : 'няма срокове'} sub={d.contract?.delivery_deadline ? `доставка до ${fmtDate(d.contract.delivery_deadline)}` : 'сроковете се активират при подписан договор'} />
      <Kpi label="Отговорници" value={<span style={{ fontSize: 14 }}>{d.technical_name || 'няма Техник'} / {d.brigadier_name || 'няма Бригадир'}</span>} tone={!d.technical_id || !d.brigadier_id ? 'warn' : undefined} sub="Техник / Бригадир" />
    </div>
    {failed > 0 && <div className="alert bad">Има {failed} неуспешно обработени събития по този обект. Виж „Настройки → Синхронизация“.</div>}
    {pending > 0 && <div className="alert">Синхронизацията обработва {pending} събития… <a onClick={() => { p.reload(); timeline.reload(); }}>Обнови</a></div>}
    <Tabs tabs={tabs} value={tab} onChange={setTab} />

    {tab === 'overview' && <div className="grid g2">
      <Card title="Жизнен цикъл на обекта"><div className="stages">{d.stages.map((s: any) => <div key={s.code} className={'stage ' + s.status}><i /><div><b>{s.name}</b> <DeptBadge code={s.department} />
        {s.done_at && <span className="muted small"> · {fmtDate(s.done_at)}{s.done_by_name ? ', ' + s.done_by_name : ''}</span>}</div>
        {write && <span className="row" style={{ flexWrap: 'nowrap' }}>{s.status !== 'done' && <button className="sm" disabled={busy} onClick={() => stage(s.code, 'done')}>Готово</button>}
          {s.status === 'pending' && <button className="sm ghost" disabled={busy} onClick={() => stage(s.code, 'skipped')}>Пропусни</button>}
          {(s.status === 'done' || s.status === 'skipped') && <button className="sm ghost" disabled={busy} onClick={() => stage(s.code, 'pending')}>Върни</button>}</span>}</div>)}</div>
        {write && <button className="sm" style={{ marginTop: 10 }} onClick={() => { const name = window.prompt('Име на допълнителния етап:'); if (name) run(async () => { await api.post(`/projects/${id}/stages`, { add: name }); await p.reload(); }); }}>+ Допълнителен етап</button>}</Card>
      <div>
        <WeatherCard project={d} onLocationSaved={() => p.reload()} />
        <Card title="Отговорници"><div className="form c2">
          <Field label="Техник"><select disabled={!write || busy} value={d.technical_id || ''} onChange={e => patch({ technical_id: e.target.value ? Number(e.target.value) : null }, 'Записано')}><option value="">— не е определен —</option>
            {(users.data || []).filter(u => u.active && ['technical', 'admin', 'manager'].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
          <Field label="Бригадир"><select disabled={!write || busy} value={d.brigadier_id || ''} onChange={e => patch({ brigadier_id: e.target.value ? Number(e.target.value) : null }, 'Записано')}><option value="">— не е определен —</option>
            {(users.data || []).filter(u => u.active && u.role === 'brigadier').map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field></div></Card>
        <Card title="Последни събития" pad={false} actions={<a onClick={() => setTab('timeline')}>Цялата хронология</a>}><Table rows={(timeline.data || []).slice(0, 6)} empty={<Empty title="Няма събития" />} cols={[
          { key: 'ts', title: 'Кога', render: r => fmtDateTime(r.ts), width: 120 }, { key: 'type', title: 'Събитие', render: r => EVENT_LABEL[r.type] || r.type }, { key: 'status', title: '', render: r => <Status value={r.status} /> }]} /></Card>
      </div></div>}

    {tab === 'customer' && <div className="grid g2">
      <Card title={`Клиент ${d.customer.code}`}><dl className="dl"><dt>Име</dt><dd>{d.customer.name}</dd><dt>ЕИК / ДДС №</dt><dd>{d.customer.vat_no || '—'}</dd><dt>Лице за контакт</dt><dd>{d.customer.contact_person || '—'}</dd>
        <dt>Телефон</dt><dd>{d.customer.phone || '—'}</dd><dt>Имейл</dt><dd>{d.customer.email || '—'}</dd><dt>Адрес</dt><dd>{d.customer.address || '—'}</dd></dl>
        <p className="muted small">Данните се поддържат в „Клиенти“ и се виждат еднакво във всички модули.</p></Card>
      <SiteForm d={d} write={write} busy={busy} onSave={b => patch(b, 'Данните за обекта са записани')} />
    </div>}

    {tab === 'contract' && <ContractTab pid={id} onChange={() => { p.reload(); timeline.reload(); }} />}

    {tab === 'finance' && <FinanceTab pid={id} />}

    {tab === 'lines' && <Card title="Количествено-стойностна сметка (КС) — договорни количества" pad={false}>
      <Table rows={d.lines} empty={<Empty title="Няма редове" />} cols={[{ key: 'sort', title: '№', width: 40 },
        { key: 'img', title: '', width: 56, render: (r: any) => r.image_document_id ? <a href={`/api/documents/${r.image_document_id}/file`} target="_blank" rel="noreferrer" title="Техническа спецификация / снимка"><img src={`/api/documents/${r.image_document_id}/file`} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' }} /></a> : null },
        { key: 'description', title: 'Описание на СМР' }, { key: 'unit', title: 'Мярка' },
        { key: 'qty', title: 'Договорено', num: true, render: (r: any) => fmtNum(r.qty, 3) }, { key: 'done_qty', title: 'Изпълнено', num: true, render: (r: any) => <>{fmtNum(r.done_qty, 3)}{r.qty > 0 && r.done_qty > r.qty ? <div><span className="badge bad">над договора +{fmtNum(r.done_qty - r.qty, 3)}</span></div> : null}</> },
        { key: 'pct', title: '%', num: true, render: (r: any) => r.qty ? fmtNum(Math.min(100, r.done_qty / r.qty * 100), 0) + '%' : '—' },
        ...(money ? [{ key: 'unit_price', title: 'Ед. цена', num: true, render: (r: any) => fmtMoney(r.unit_price) }, { key: 'tot', title: `Стойност, ${cur}`, num: true, render: (r: any) => fmtMoney(r.qty * r.unit_price) }] : [])]}
        foot={money ? <tr><td colSpan={8}>Общо без ДДС (версия {d.baseline_version ?? 'проект'})</td><td className="num">{fmtMoney(d.finance.contract_value)}</td></tr> : undefined} /></Card>}

    {tab === 'timeline' && <Card title="Хронология на обекта"><Loader state={timeline}>{(timeline.data || []).length === 0 ? <Empty title="Няма събития" /> : <ul className="timeline">{(timeline.data || []).map(e => <li key={e.id}>
      <div className="muted small">{fmtDateTime(e.ts)}<br />{e.user_name || 'система'}</div>
      <div><b>{EVENT_LABEL[e.type] || e.type}</b> <DeptBadge code={e.origin_module} /> <Status value={e.status} /> {e.approval_status && <span className="badge warn">одобрение: {e.approval_status}</span>}
        <div className="muted small">засегнати: {JSON.parse(e.affected_modules || '[]').join(', ') || '—'}</div>
        {e.new_value && <div className="mono small pre faint">{e.prev_value ? e.prev_value + ' → ' : ''}{e.new_value}</div>}{e.last_error && <div className="badge bad">{e.last_error}</div>}</div></li>)}</ul>}</Loader></Card>}

    {tab === 'audit' && <Card title="Одитна следа" pad={false}><Loader state={audit}><Table rows={audit.data || []} empty={<Empty title="Няма записи" />} cols={[
      { key: 'ts', title: 'Кога', render: r => fmtDateTime(r.ts), width: 130 }, { key: 'user_name', title: 'Кой', render: r => r.user_name || 'система' }, { key: 'module', title: 'Модул' },
      { key: 'entity_type', title: 'Обект на промяната', render: r => `${r.entity_type}${r.entity_id ? ' #' + r.entity_id : ''}` }, { key: 'action', title: 'Действие' },
      { key: 'before', title: 'Преди', render: r => <span className="mono small">{r.before}</span> }, { key: 'after', title: 'След', render: r => <span className="mono small">{r.after}</span> }]} /></Loader></Card>}

    {tab === 'schedule' && <ScheduleTab sched={sched} />}
    {tab === 'progress' && <ProgressTab prog={prog} />}
    {tab === 'logistics' && <LogisticsTab logi={logi} pid={id} />}
    {tab === 'tasks' && <TasksTab tasks={tasks} pid={id} />}
    {tab === 'docs' && <DocsTab docs={docs} pid={id} write={can('documents', 'write')} />}
    {tab === 'messages' && <MessagesTab msgs={msgs} pid={id} write={can('messages', 'write')} onSent={() => msgs.reload()} />}

    {tab === 'planned' && <Card title="Раздели, които още не са изградени"><p className="muted">Тези раздели на Картона са в плана, но още не работят. Ще се появят тук, когато операциите, записът и правата им са тествани.</p>
      <div className="row">{PLANNED.map(x => <span key={x} className="badge">{x}</span>)}</div></Card>}
  </>;
}

function SiteForm({ d, write, busy, onSave }: { d: any; write: boolean; busy: boolean; onSave: (b: any) => void }) {
  const q = d.site_questionnaire || {};
  const f = useForm({ site_address: d.site_address || '', access_notes: d.access_notes || '', unloading_notes: d.unloading_notes || '', storage_notes: d.storage_notes || '', parking_notes: d.parking_notes || '',
    courier_office: d.courier_office || '', courier_pallets: d.courier_pallets ? 1 : 0,
    q_gps: q.gps_link || '', q_phones: q.phones || '', q_machinery: q.machinery || '', q_electricity: q.electricity || '', q_el_distance: q.electricity_distance || '', q_el_verified: q.electricity_verified ? 1 : 0,
    q_water: q.water || '', q_water_distance: q.water_distance || '', q_waste: q.waste_container || '', q_pallet_addr: q.pallet_office_address || '', q_pallet_loc: q.pallet_office_location || '' });
  const save = () => onSave({ site_address: f.v.site_address, access_notes: f.v.access_notes, unloading_notes: f.v.unloading_notes, storage_notes: f.v.storage_notes,
    parking_notes: f.v.parking_notes, courier_office: f.v.courier_office, courier_pallets: Number(f.v.courier_pallets),
    site_questionnaire: { ...q, gps_link: f.v.q_gps || null, phones: f.v.q_phones || null, machinery: f.v.q_machinery || null,
      electricity: f.v.q_electricity || null, electricity_distance: f.v.q_el_distance || null, electricity_verified: Number(f.v.q_el_verified) === 1 || null,
      water: f.v.q_water || null, water_distance: f.v.q_water_distance || null, waste_container: f.v.q_waste || null,
      pallet_office_address: f.v.q_pallet_addr || null, pallet_office_location: f.v.q_pallet_loc || null } });
  return <Card title="Обект и логистични ограничения" actions={write && <button className="primary" disabled={busy} onClick={save}>Запис</button>}><div className="form c2">
    <Field label="Адрес на обекта" full><input {...f.bind('site_address')} disabled={!write} /></Field>
    <Field label="GPS локация (линк)"><input {...f.bind('q_gps')} disabled={!write} placeholder="https://maps…" /></Field>
    <Field label="Телефони на обекта"><input {...f.bind('q_phones')} disabled={!write} placeholder="няколко, със запетая" /></Field>
    <Field label="Достъп до обекта" full><textarea {...f.bind('access_notes')} disabled={!write} /></Field>
    <Field label="Разтоварване"><textarea {...f.bind('unloading_notes')} disabled={!write} /></Field>
    <Field label="Съхранение на материали"><textarea {...f.bind('storage_notes')} disabled={!write} /></Field>
    <Field label="Необходима механизация"><input {...f.bind('q_machinery')} disabled={!write} placeholder="напр. кран 12т, камион" /></Field>
    <Field label="Паркиране"><input {...f.bind('parking_notes')} disabled={!write} /></Field>
    <Field label="Електричество"><select {...f.bind('q_electricity')} disabled={!write}><option value="">— няма данни —</option><option value="mono">Монофазно</option><option value="tri">Трифазно</option><option value="none">Няма ток</option></select></Field>
    <Field label="Разстояние до тока"><input {...f.bind('q_el_distance')} disabled={!write} placeholder="напр. 30 м" /></Field>
    <Field label="Токът е проверен"><select {...f.bind('q_el_verified')} disabled={!write}><option value={0}>Не</option><option value={1}>Да</option></select></Field>
    <Field label="Вода"><select {...f.bind('q_water')} disabled={!write}><option value="">— няма данни —</option><option value="yes">Има</option><option value="no">Няма</option></select></Field>
    <Field label="Разстояние до водата"><input {...f.bind('q_water_distance')} disabled={!write} /></Field>
    <Field label="Контейнер за отпадъци"><input {...f.bind('q_waste')} disabled={!write} placeholder="има / нужен / адрес" /></Field>
    <Field label="Куриерски офис (палети)"><input {...f.bind('courier_office')} disabled={!write} /></Field>
    <Field label="Адрес на палет-офис"><input {...f.bind('q_pallet_addr')} disabled={!write} /></Field>
    <Field label="Локация на палет-офис"><input {...f.bind('q_pallet_loc')} disabled={!write} /></Field>
    <Field label="Офисът приема палети"><select {...f.bind('courier_pallets')} disabled={!write}><option value={0}>Не / неизвестно</option><option value={1}>Да</option></select></Field>
  </div></Card>;
}

// ---------------------------------------------------------------- Финанси (четене; въвеждането е в „Счетоводство“)
const PF_KIND: Record<string, string> = { advance: 'Аванс', interim: 'Междинна', final: 'Окончателна', other: 'Друга' };
const TX_DIR: Record<string, string> = { in: 'Приход', out: 'Разход' };

function FinanceTab({ pid }: { pid: number }) {
  const fin = useLoad<any>(`/projects/${pid}/finance`);
  const cur = useCurrency();
  const d = fin.data;
  if (!d) return <Loader state={fin}><div /></Loader>;
  const m = (n: any) => fmtMoney(n, cur);
  return <>
    <div className="grid g4 kpis-m" style={{ marginBottom: 14 }}>
      <Kpi label={`Договорна стойност, ${cur}`} value={m(d.contract_value)} sub={`оферта: ${m(d.offer_value)}`} />
      <Kpi label={`Издадени проформи, ${cur}`} value={m(d.invoiced)} sub={`вземания: ${m(d.receivables)}`} tone={d.receivables > 0 ? 'warn' : undefined} />
      <Kpi label={`Получени / платени, ${cur}`} value={m(d.payments_received)} sub={`изплатени: ${m(d.payments_made)}`} />
      <Kpi label={`Резултат до момента, ${cur}`} value={m(d.result_to_date)} sub={`прогноза: ${m(d.forecast_result)}`} tone={d.result_to_date < 0 ? 'bad' : undefined} />
      <Kpi label={`Оставащ бюджет, ${cur}`} value={m(d.remaining_budget)} sub={`планирани разходи: ${m(d.planned_expenses)}`} />
      <Kpi label={`Планиран резултат, ${cur}`} value={m(d.planned_result)} sub={`себестойност: ${m(d.cost_price)}`} />
    </div>
    <Card title="Сверка с изпълнението" pad={false}>
      <Table rows={[
        { k: 'Извършена работа (КС × изпълнено)', v: d.earned_value },
        { k: 'Не издадена за фактуриране', v: d.work_not_invoiced, warn: d.work_not_invoiced > 0 },
        { k: 'Изпълнена себестойност', v: d.earned_cost },
        { k: 'Фактически разходи (платени + задължения)', v: d.actual_expenses },
        { k: 'Отклонение на разходите', v: d.cost_variance, warn: d.cost_variance > 0 },
        { k: 'Планирани разходи по КС', v: d.planned_out },
        { k: 'Не фактурирано от договора', v: d.not_invoiced },
      ]} cols={[
        { key: 'k', title: 'Показател' },
        { key: 'v', title: `Стойност, ${cur}`, num: true, render: (r: any) => <span className={r.warn ? 'badge warn' : ''}>{m(r.v)}</span> },
      ]} />
    </Card>
    <div className="grid g2">
      <Card title="Проформи" pad={false}><Table rows={d.proformas} empty={<Empty title="Няма проформи" />} cols={[
        { key: 'code', title: '№' }, { key: 'kind', title: 'Вид', render: (r: any) => PF_KIND[r.kind] || r.kind },
        { key: 'amount', title: 'Сума', num: true, render: (r: any) => m(r.amount) },
        { key: 'issued_on', title: 'Издадена', render: (r: any) => fmtDate(r.issued_on) }, { key: 'status', title: '', render: (r: any) => <Status value={r.status} /> }]} /></Card>
      <Card title="Транзакции" pad={false}><Table rows={d.transactions} empty={<Empty title="Няма транзакции" />} cols={[
        { key: 'tx_date', title: 'Дата', render: (r: any) => fmtDate(r.tx_date) }, { key: 'category', title: 'Категория' },
        { key: 'dir', title: 'Вид', render: (r: any) => TX_DIR[r.direction] || r.direction },
        { key: 'amount', title: 'Сума', num: true, render: (r: any) => m(r.amount) }, { key: 'status', title: '', render: (r: any) => <Status value={r.status} /> }]} /></Card>
      <Card title="Заявки за плащане" pad={false}><Table rows={d.payment_requests} empty={<Empty title="Няма заявки" />} cols={[
        { key: 'code', title: '№' }, { key: 'payee', title: 'Получател' }, { key: 'category', title: 'Категория' },
        { key: 'amount', title: 'Сума', num: true, render: (r: any) => m(r.amount) }, { key: 'status', title: '', render: (r: any) => <Status value={r.status} /> }]} /></Card>
      <Card title="Настаняване" pad={false}><Table rows={d.accommodations} empty={<Empty title="Няма записи" />} cols={[
        { key: 'place', title: 'Място' }, { key: 'date_from', title: 'От–до', render: (r: any) => `${fmtDate(r.date_from)} – ${fmtDate(r.date_to)}` },
        { key: 'beds', title: 'Легла', num: true }, { key: 'cost_per_night', title: 'Цена/нощ', num: true, render: (r: any) => m(r.cost_per_night) }]} /></Card>
    </div>
    <div className="row" style={{ marginTop: 14 }}><Link to={`/accounting?pid=${pid}`}>Отвори в Счетоводство →</Link></div>
  </>;
}
// ---------------------------------------------------------------- раздели, захранени от съществуващите модули
const IST: Record<string, [string, string]> = { open: ['Отворен', 'warn'], in_progress: ['В работа', 'info'], resolved: ['Решен', 'ok'], cancelled: ['Отменен', ''] };
const SEV: Record<string, [string, string]> = { low: ['нисък', ''], medium: ['среден', 'warn'], high: ['висок', 'bad'], critical: ['критичен', 'bad'] };
const TSK_ST: Record<string, string> = { open: 'Отворена', done: 'Завършена' };
const PRI: Record<string, string> = { low: 'нисък', normal: 'нормален', high: 'висок', urgent: 'спешен' };
const ISSUE_KIND: Record<string, string> = { problem: 'Проблем', delay: 'Закъснение', material_shortage: 'Липса на материал', damage: 'Повреда', additional_work: 'Допълнителна работа', other: 'Друго' };

function ScheduleTab({ sched }: { sched: any }) {
  const items: any[] = sched.data?.items || [];
  return <Loader state={sched}>
    <Card title={`Линеен график${sched.data?.deadline ? ` · краен срок ${fmtDate(sched.data.deadline)}` : ''}`} pad={false} actions={<Link to="/technical">Редактирай в Технически →</Link>}>
      <Table rows={items} empty={<Empty title="Няма график">Линейният график се поддържа в Техническия модул.</Empty>} cols={[
        { key: 'name', title: 'Дейност' },
        { key: 'period', title: 'Период', render: (r: any) => r.start_date ? `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` : '—' },
        { key: 'pct', title: 'Изпълнение', width: 110, render: (r: any) => r.pct != null ? <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.pct} /><span className="small num" style={{ width: 38 }}>{r.pct}%</span></div> : '—' },
        { key: 'st', title: 'Статус', render: (r: any) => r.behind ? <span className="badge bad">изостава</span> : (r.late_days || 0) > 0 ? <span className="badge bad">къснее {r.late_days} дн.</span> : r.pct === 100 ? <span className="badge ok">готово</span> : <span className="badge">в срок</span> },
      ]} /></Card></Loader>;
}

function ProgressTab({ prog }: { prog: any }) {
  const lines: any[] = prog.data?.lines || [];
  const entries: any[] = prog.data?.entries || [];
  return <Loader state={prog}>
    <Card title="Изпълнение по редове" pad={false}><Table rows={lines} empty={<Empty title="Няма редове" />} cols={[
      { key: 'description', title: 'Ред' }, { key: 'unit', title: 'Мярка', width: 60 },
      { key: 'qty', title: 'Договорено', num: true, render: (r: any) => fmtNum(r.qty) },
      { key: 'done_qty', title: 'Извършено', num: true, render: (r: any) => <>{fmtNum(r.done_qty)}{r.qty > 0 && r.done_qty > r.qty ? <div><span className="badge bad">над договора +{fmtNum(r.done_qty - r.qty, 3)}</span></div> : null}</> },
      { key: 'pct', title: '%', width: 130, render: (r: any) => r.pct != null ? <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.pct} /><span className="small num" style={{ width: 40 }}>{r.pct}%</span></div> : '—' },
    ]} /></Card>
    <Card title="Дневни отчети" pad={false} actions={<Link to="/technical">Въведи отчет →</Link>}><Table rows={entries} empty={<Empty title="Няма отчети" />} cols={[
      { key: 'work_date', title: 'Дата', render: (r: any) => fmtDate(r.work_date) }, { key: 'line_description', title: 'Ред' },
      { key: 'qty', title: 'Кол-во', num: true, render: (r: any) => <span className={r.voided ? 'muted' : ''} style={r.voided ? { textDecoration: 'line-through' } : {}}>{fmtNum(r.qty)} {r.unit}</span> },
      { key: 'note', title: 'Бележка' }, { key: 'reported_by_name', title: 'От' },
    ]} /></Card></Loader>;
}

function LogisticsTab({ logi, pid }: { logi: any; pid: number }) {
  const d = logi.data;
  const lf: any = d?.logistics_fields || {};
  const notes = [['Достъп', lf.access_notes], ['Разтоварване', lf.unloading_notes], ['Съхранение', lf.storage_notes], ['Паркиране', lf.parking_notes], ['Куриерски офис', lf.courier_office]].filter(([, v]) => v);
  return <Loader state={logi}>
    {notes.length ? <Card title="Логистика на обекта" pad={false}><Table rows={notes.map(([k, v]) => ({ k, v }))} cols={[{ key: 'k', title: '', width: 170 }, { key: 'v', title: 'Бележка' }]} /></Card> : null}
    <Card title="Доставки" pad={false} actions={<Link to={`/logistics?pid=${pid}`}>Управлявай в Логистика →</Link>}><Table rows={d?.deliveries || []} empty={<Empty title="Няма доставки" />} cols={[
      { key: 'code', title: '№' }, { key: 'planned_date', title: 'Планирана', render: (r: any) => fmtDate(r.planned_date) },
      { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
      { key: 'carrier', title: 'Превозвач' }, { key: 'items_summary', title: 'Съдържание' },
    ]} /></Card>
    <Card title="Механизация на обекта" pad={false}><Table rows={d?.allocations || []} empty={<Empty title="Няма разпределена техника" />} cols={[
      { key: 'asset', title: 'Техника', render: (r: any) => `${r.asset_code} — ${r.asset_name}${r.asset_plate ? ' (' + r.asset_plate + ')' : ''}` },
      { key: 'period', title: 'Период', render: (r: any) => `${fmtDate(r.date_from)} → ${fmtDate(r.date_to)}` },
      { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
    ]} /></Card></Loader>;
}

function TasksTab({ tasks, pid }: { tasks: any; pid: number }) {
  const d = tasks.data;
  return <Loader state={tasks}>
    <Card title="Задачи" pad={false} actions={<Link to="/technical">В Технически →</Link>}><Table rows={d?.tasks || []} empty={<Empty title="Няма задачи" />} cols={[
      { key: 'code', title: '№', width: 90 }, { key: 'title', title: 'Задача' },
      { key: 'assignee_name', title: 'Отговорник', render: (r: any) => r.assignee_name || r.assignee_dept || '—' },
      { key: 'due_date', title: 'Срок', render: (r: any) => fmtDate(r.due_date) },
      { key: 'priority', title: 'Приоритет', render: (r: any) => PRI[r.priority] || r.priority },
      { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
    ]} /></Card>
    <Card title="Проблеми" pad={false} actions={<Link to={`/brigade/${pid}`}>В Бригадир →</Link>}><Table rows={d?.issues || []} empty={<Empty title="Няма проблеми" />} cols={[
      { key: 'code', title: '№', width: 90 },
      { key: 'title', title: 'Проблем', render: (r: any) => <>{r.title}<div className="small muted">{ISSUE_KIND[r.kind] || r.kind}</div></> },
      { key: 'severity', title: 'Приоритет', render: (r: any) => { const s = SEV[r.severity] || [r.severity, '']; return <span className={'badge ' + s[1]}>{s[0]}</span>; } },
      { key: 'assigned_dept_name', title: 'Към', render: (r: any) => r.assigned_dept_name || '—' },
      { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
    ]} /></Card></Loader>;
}

function DocsTab({ docs, pid, write: docsWrite }: { docs: any; pid: number; write?: boolean }) {
  const rows: any[] = docs.data || [];
  const latest = (d: any) => d.versions?.[d.versions.length - 1];
  return <Loader state={docs}>
    <Card title="Файлове на обекта" pad={false} actions={<Link to={`/brigade/${pid}`}>Качи в Бригадир →</Link>}><Table rows={rows} empty={<Empty title="Няма файлове" />} cols={[
      { key: 'title', title: 'Файл', render: (r: any) => { const v = latest(r); return <>{r.title}<div className="small muted">{v?.filename} · {v ? Math.round(v.size / 1024) + ' KB' : ''} · {fmtDateTime(v?.created_at)}{r.entity_type ? ` · към ${r.entity_type} #${r.entity_id}` : ''}</div></> } },
      { key: 'category', title: 'Вид', render: (r: any) => ({ photo: 'Снимка', document: 'Документ', act: 'Акт', contract: 'Договор', appendix: 'Приложение', other: 'Друго' } as any)[r.category] || r.category },
      { key: 'versions', title: 'Версии', render: (r: any) => <VersionLinks doc={r} /> },
      { key: 'uploaded_by_name', title: 'Качил' },
      { key: 'x', title: '', width: 140, render: (r: any) => { const v = latest(r); return <span style={{ display: 'inline-flex', gap: 4 }}>{v ? <a className="btn sm" href={`/api/documents/${v.id}/file`} target="_blank" rel="noreferrer">Отвори</a> : null}{docsWrite && <NewVersionButton doc={r} onDone={() => docs.reload()} />}</span>; } },
    ]} /></Card>
    <div className="grid g3">{rows.flatMap(r => (r.versions || []).filter((v: any) => (v.mime || '').startsWith('image/')).map((v: any) =>
      <a key={v.id} href={`/api/documents/${v.id}/file`} target="_blank" rel="noreferrer"><img src={`/api/documents/${v.id}/file`} alt={r.title} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} /></a>))}
    </div></Loader>;
}

function MessagesTab({ msgs, pid, write, onSent }: { msgs: any; pid: number; write: boolean; onSent: () => void }) {
  const { run } = useAction();
  const f = useForm({ body: '' });
  const rows: any[] = msgs.data || [];
  const send = () => run(async () => {
    await api.post('/messages', { project_id: pid, body: f.v.body });
    f.setV({ ...f.v, body: '' }); onSent();
  }, 'Съобщението е изпратено');
  return <Loader state={msgs}>
    <Card title="Разговор по обекта" actions={<Link to={`/brigade/${pid}`}>Пълен изглед →</Link>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: 420, overflowY: 'auto' }}>
        {rows.map(m => <div key={m.id} style={{ background: 'var(--panel2)', borderRadius: 8, padding: '8px 12px' }}>
          <div className="small muted">{m.author_name || 'системата'} · {fmtDateTime(m.created_at)}{m.entity_type ? ` · към ${m.entity_type} #${m.entity_id}` : ''}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
        </div>)}
        {!rows.length && <Empty title="Няма съобщения" />}
      </div>
      {write && <div className="row"><input {...f.bind('body')} placeholder="Съобщение…" style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
        <button className="primary" disabled={!f.v.body.trim()} onClick={send}>Изпрати</button></div>}
    </Card></Loader>;
}
