import React, { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { Card, DeptBadge, Empty, Field, Loader, Modal, Status, Table, Tabs, navigate, useAction, useAuth, useCan, useForm, useLoad } from '../ui';

const ROLE_LABEL: Record<string, string> = { admin: 'Администратор', manager: 'Управител', commercial: 'Оферти', contracts: 'Договори', technical: 'Техник', accounting: 'Счетоводство',
  warehouse: 'Склад', logistics: 'Логистика', brigadier: 'Бригадир' };
const RES_LABEL: Record<string, string> = { customers: 'Клиенти', catalog: 'Номенклатури', offers: 'Оферти', contracts: 'Договори', projects: 'Обекти', technical: 'Техник', progress: 'Дневен отчет',
  warehouse: 'Склад', logistics: 'Логистика', finance: 'Финанси', approvals: 'Одобрения', tasks: 'Задачи', messages: 'Комуникация', documents: 'Документи', reports: 'Справки', users: 'Потребители',
  settings: 'Настройки', events: 'Синхронизация' };

export function Notifications({ onChange }: { onChange: () => void }) {
  const list = useLoad<any[]>('/notifications');
  const { run } = useAction();
  const unread = (list.data || []).filter(n => !n.is_read).map(n => n.id);
  const mark = (ids: number[]) => run(async () => { await api.post('/notifications/read', { ids }); await list.reload(); onChange(); });
  return <>
    <div className="page-head"><h1>Известия</h1><span className="spacer" />{unread.length > 0 && <button onClick={() => mark(unread)}>Маркирай всички като прочетени ({unread.length})</button>}</div>
    <div className="alert">Известието само съобщава за промяна. Самата операция (договор, резервация, одобрение) се извършва и записва отделно от синхронизацията.</div>
    <Card pad={false}><Loader state={list}>
      <Table rows={list.data || []} onRow={r => { if (!r.is_read) mark([r.id]); if (r.link) navigate(r.link); }} empty={<Empty title="Няма известия" />} cols={[
        { key: 'created_at', title: 'Кога', width: 130, render: r => fmtDateTime(r.created_at) }, { key: 'project_code', title: 'Обект', width: 120 },
        { key: 'title', title: 'Известие', render: r => <div><div style={{ fontWeight: r.is_read ? 400 : 650 }}>{r.title}</div><div className="muted small">{r.body}</div></div> },
        { key: 'department', title: 'За', render: r => r.department ? <DeptBadge code={r.department} /> : 'лично' },
        { key: 'severity', title: '', render: r => r.severity !== 'info' ? <span className={'badge ' + (r.severity === 'critical' ? 'bad' : 'warn')}>{r.severity === 'critical' ? 'критично' : 'внимание'}</span> : null }]} />
    </Loader></Card>
  </>;
}

function UserForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ username: '', full_name: '', role: 'commercial', phone: '', email: '', password: '', active: 1, ...(initial || {}) });
  const { run, busy } = useAction();
  const save = () => run(async () => {
    const body: any = { ...f.v, active: !!Number(f.v.active) };
    if (!body.password) delete body.password;
    initial?.id ? await api.patch(`/users/${initial.id}`, body) : await api.post('/users', body);
    onSaved(); onClose();
  }, 'Потребителят е записан');
  return <Modal title={initial?.id ? `Потребител ${initial.username}` : 'Нов потребител'} onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy} onClick={save}>Запис</button></>}>
    <div className="form c2">
      <Field label="Потребителско име"><input {...f.bind('username')} disabled={!!initial?.id} autoFocus /></Field>
      <Field label="Име и фамилия"><input {...f.bind('full_name')} /></Field>
      <Field label="Роля (определя отдела и правата)"><select {...f.bind('role')}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Статус"><select {...f.bind('active')}><option value={1}>Активен</option><option value={0}>Деактивиран</option></select></Field>
      <Field label="Телефон"><input {...f.bind('phone')} /></Field>
      <Field label="Имейл"><input type="email" {...f.bind('email')} /></Field>
      <Field label={initial?.id ? 'Нова парола (празно = без промяна)' : 'Парола (поне 8 символа)'} full><input type="password" {...f.bind('password')} autoComplete="new-password" /></Field>
    </div>
  </Modal>;
}

function Permissions() {
  const p = useLoad<any>('/permissions');
  const can = useCan();
  const [rows, setRows] = useState<any[]>([]);
  const [role, setRole] = useState('commercial');
  const { run, busy } = useAction();
  useEffect(() => { if (p.data) setRows(p.data.rows); }, [p.data]);
  const toggle = (res: string, k: string) => setRows(x => x.map(r => r.role === role && r.resource === res ? { ...r, [k]: r[k] ? 0 : 1 } : r));
  const write = can('settings', 'write') && role !== 'admin';
  return <Card title="Права по роли" actions={<><select style={{ width: 200 }} value={role} onChange={e => setRole(e.target.value)}>{(p.data?.roles || []).map((r: string) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}</select>
    {write && <button className="primary" disabled={busy} onClick={() => run(async () => { await api.put('/permissions', { rows: rows.filter(r => r.role === role) }); await p.reload(); }, 'Правата са записани')}>Запис</button>}</>} pad={false}>
    <Loader state={p}><div className="table-wrap"><table className="t"><thead><tr><th>Модул</th><th>Четене</th><th>Запис</th><th>Одобрение</th></tr></thead>
      <tbody>{rows.filter(r => r.role === role).map(r => <tr key={r.resource}><td>{RES_LABEL[r.resource] || r.resource}</td>
        {['can_read', 'can_write', 'can_approve'].map(k => <td key={k}><input type="checkbox" checked={!!r[k]} disabled={!write} onChange={() => toggle(r.resource, k)} aria-label={`${RES_LABEL[r.resource]} ${k}`} /></td>)}</tr>)}</tbody></table></div>
      {role === 'admin' && <div className="body muted small">Правата на администратора не се променят.</div>}</Loader>
  </Card>;
}

function Events() {
  const list = useLoad<any[]>('/events');
  const can = useCan();
  const { run } = useAction();
  const [open, setOpen] = useState<any | null>(null);
  return <Card title="Синхронизация — журнал на събитията" actions={<button className="sm" onClick={() => list.reload()}>Обнови</button>} pad={false}><Loader state={list}>
    <Table rows={list.data || []} onRow={setOpen} empty={<Empty title="Няма събития">Събитие се записва при всяка значима промяна.</Empty>} cols={[
      { key: 'id', title: '#', width: 50 }, { key: 'ts', title: 'Кога', render: r => fmtDateTime(r.ts) }, { key: 'type', title: 'Събитие', render: r => <span className="mono">{r.type}</span> },
      { key: 'project_code', title: 'Обект' }, { key: 'origin_module', title: 'Източник', render: r => <DeptBadge code={r.origin_module} /> || r.origin_module }, { key: 'user_name', title: 'Потребител' },
      { key: 'status', title: 'Обработка', render: r => <Status value={r.status} /> }, { key: 'attempts', title: 'Опити', num: true },
      { key: 'act', title: '', render: r => r.status === 'failed' && can('events', 'write') ? <button className="sm" onClick={e => { e.stopPropagation(); run(async () => { await api.post(`/events/${r.id}/retry`); await list.reload(); }, 'Събитието е върнато за обработка'); }}>Повтори</button> : null }]} />
    {open && <Modal wide title={`Събитие #${open.id} · ${open.type}`} onClose={() => setOpen(null)}>
      <dl className="dl"><dt>Обект</dt><dd>{open.project_code || '—'}</dd><dt>Източник</dt><dd>{open.origin_module}</dd><dt>Потребител</dt><dd>{open.user_name || 'система'}</dd><dt>Време</dt><dd>{fmtDateTime(open.ts)}</dd>
        <dt>Засегнати модули</dt><dd>{JSON.parse(open.affected_modules || '[]').join(', ') || '—'}</dd><dt>Одобрение</dt><dd>{open.approval_status || 'не се изисква'}</dd>
        <dt>Статус</dt><dd><Status value={open.status} /> {open.last_error && <span className="badge bad">{open.last_error}</span>}</dd>
        <dt>Предишна стойност</dt><dd className="mono pre">{open.prev_value || '—'}</dd><dt>Нова стойност</dt><dd className="mono pre">{open.new_value || '—'}</dd></dl>
      <h3 style={{ marginTop: 14 }}>Извършени операции</h3>
      <table className="t"><thead><tr><th>Операция</th><th>Резултат</th><th>Детайли</th></tr></thead><tbody>{JSON.parse(open.effects || '[]').map((f: any, i: number) =>
        <tr key={i}><td className="mono">{f.handler}</td><td><span className={'badge ' + (f.status === 'ok' ? 'ok' : 'bad')}>{f.status === 'ok' ? 'изпълнена' : 'грешка'}</span></td><td className="mono pre">{f.result}</td></tr>)}</tbody></table>
    </Modal>}
  </Loader></Card>;
}

export function Settings() {
  const { state, reload } = useAuth();
  const can = useCan();
  const [tab, setTab] = useState('users');
  const users = useLoad<any[]>('/users');
  const [edit, setEdit] = useState<any | null>(null);
  const f = useForm({ company_name: '', currency: 'EUR', vat_pct: '20', overhead_pct: '3.5', profit_pct: '30', corporate_tax_pct: '10', exceptional_expense_limit: '1000', overconsumption_tolerance_pct: '5', ...state.settings });
  const { run, busy } = useAction();
  const write = can('settings', 'write');
  return <>
    <div className="page-head"><h1>Настройки</h1><span className="spacer" />{tab === 'users' && can('users', 'write') && <button className="primary" onClick={() => setEdit({})}>Нов потребител</button>}</div>
    <Tabs tabs={[['users', 'Потребители'], ['perms', 'Права'], ['company', 'Фирма и параметри'], ...(can('events') ? [['events', 'Синхронизация'] as [string, string]] : [])]} value={tab} onChange={setTab} />
    {tab === 'users' && <Card pad={false}><Loader state={users}><Table rows={users.data || []} onRow={can('users', 'write') ? setEdit : undefined} cols={[
      { key: 'full_name', title: 'Име' }, { key: 'username', title: 'Потребител' }, { key: 'role', title: 'Роля', render: r => ROLE_LABEL[r.role] || r.role },
      { key: 'department', title: 'Отдел', render: r => <DeptBadge code={r.department} /> }, { key: 'phone', title: 'Телефон' }, { key: 'email', title: 'Имейл' },
      { key: 'active', title: 'Статус', render: r => r.active ? <span className="badge ok">активен</span> : <span className="badge">деактивиран</span> }]} /></Loader></Card>}
    {tab === 'perms' && <Permissions />}
    {tab === 'events' && <Events />}
    {tab === 'company' && <Card title="Фирма и параметри" actions={write && <button className="primary" disabled={busy} onClick={() => run(async () => { await api.put('/settings', f.v); await reload(); }, 'Настройките са записани')}>Запис</button>}>
      <div className="form c3">
        <Field label="Фирма" full><input {...f.bind('company_name')} disabled={!write} /></Field>
        <Field label="Валута"><input {...f.bind('currency')} disabled={!write} /></Field>
        <Field label="ДДС %"><input type="number" step="0.1" {...f.bind('vat_pct')} disabled={!write} /></Field>
        <Field label="Режийни % (оферти)"><input type="number" step="0.1" {...f.bind('overhead_pct')} disabled={!write} /></Field>
        <Field label="Печалба % (оферти)"><input type="number" step="0.1" {...f.bind('profit_pct')} disabled={!write} /></Field>
        <Field label="Корпоративен данък % върху печалбата"><input type="number" step="0.1" {...f.bind('corporate_tax_pct')} disabled={!write} /></Field>
        <Field label="Праг за извънреден разход"><input type="number" step="1" {...f.bind('exceptional_expense_limit')} disabled={!write} /></Field>
        <Field label="Допуск за преразход на материали %"><input type="number" step="0.1" {...f.bind('overconsumption_tolerance_pct')} disabled={!write} /></Field>
      </div></Card>}
    {edit && <UserForm initial={edit.id ? edit : undefined} onClose={() => setEdit(null)} onSaved={users.reload} />}
  </>;
}