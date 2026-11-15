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

const OVR_PRESETS: Record<string, [number, number, number]> = { none: [0, 0, 0], read: [1, 0, 0], rw: [1, 1, 0], full: [1, 1, 1] };
const presetOf = (o: any) => { const k = `${o.can_read ? 1 : 0}${o.can_write ? 1 : 0}${o.can_approve ? 1 : 0}`;
  return { '000': 'none', '100': 'read', '110': 'rw', '111': 'full' }[k] || 'custom'; };

function UserForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ username: '', full_name: '', role: 'commercial', phone: '', email: '', offer_letter: '', office: '', password: '', active: 1, ...(initial || {}) });
  const { run, busy } = useAction();
  const [uid, setUid] = useState<number | undefined>(initial?.id);
  const ov = useLoad<any[]>(uid ? `/users/${uid}/overrides` : null);
  const [preset, setPreset] = useState<Record<string, string>>({});
  const [ovRaw, setOvRaw] = useState<Record<string, any>>({});
  useEffect(() => { if (ov.data) { const p: Record<string, string> = {}, raw: Record<string, any> = {};
    for (const o of ov.data) { p[o.resource] = presetOf(o); raw[o.resource] = o; } setPreset(p); setOvRaw(raw); } }, [ov.data]);
  const save = () => run(async () => {
    const body: any = { ...f.v, active: !!Number(f.v.active) };
    if (!body.password) delete body.password;
    if (!uid) { const r = await api.post<any>('/users', body); setUid(r.id); return; } // остава отворено — следва задаване на ограничения
    await api.patch(`/users/${uid}`, body);
    if (ov.data) {
      const rows = Object.entries(preset).filter(([, p]) => p && p !== 'inherit').map(([res, p]) => {
        const [r, w, a] = p === 'custom' ? [+!!ovRaw[res].can_read, +!!ovRaw[res].can_write, +!!ovRaw[res].can_approve] : OVR_PRESETS[p];
        return { resource: res, can_read: r, can_write: w, can_approve: a };
      });
      await api.put(`/users/${uid}/overrides`, { rows });
    }
    onSaved(); onClose();
  }, 'Потребителят е записан');
  return <Modal wide title={uid ? `Потребител ${f.v.username}` : 'Нов потребител'} onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy} onClick={save}>{uid ? 'Запис' : 'Създай и продължи'}</button></>}>
    <div className="form c2">
      <Field label="Потребителско име"><input {...f.bind('username')} disabled={!!uid} autoFocus /></Field>
      <Field label="Име и фамилия"><input {...f.bind('full_name')} /></Field>
      <Field label="Роля (определя отдела и правата)"><select {...f.bind('role')}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Статус"><select {...f.bind('active')}><option value={1}>Активен</option><option value={0}>Деактивиран</option></select></Field>
      <Field label="Телефон"><input {...f.bind('phone')} /></Field>
      <Field label="Имейл"><input type="email" {...f.bind('email')} /></Field>
      <Field label="Буква за номер на оферта (напр. G)"><input maxLength={3} {...f.bind('offer_letter')} placeholder="само за съставители на оферти" /></Field>
      <Field label="Офис"><input {...f.bind('office')} placeholder="Бургас, София, Варна" /></Field>
      <Field label={uid ? 'Нова парола (празно = без промяна)' : 'Парола (поне 8 символа)'} full><input type="password" {...f.bind('password')} autoComplete="new-password" /></Field>
    </div>
    {uid && <div style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 4px' }}>Ограничения по модули</h3>
      <div className="muted small" style={{ marginBottom: 8 }}>По подразбиране потребителят вижда това, което позволява ролята. Тук можете да ограничите или разширите всеки модул поотделно — промените важат веднага.</div>
      <div style={{ maxHeight: 240, overflow: 'auto' }}><table className="t"><tbody>
        {Object.keys(RES_LABEL).map(res => <tr key={res}><td style={{ width: '55%' }}>{RES_LABEL[res]}</td><td>
          <select value={preset[res] ?? 'inherit'} disabled={!ov.data} onChange={e => setPreset(p => ({ ...p, [res]: e.target.value }))}>
            <option value="inherit">По подразбиране (ролята)</option>
            <option value="none">Без достъп</option>
            <option value="read">Само четене</option>
            <option value="rw">Четене + запис</option>
            <option value="full">Пълен достъп</option>
            {preset[res] === 'custom' && <option value="custom">Персонализирано</option>}
          </select></td></tr>)}
      </tbody></table></div>
    </div>}
    {!uid && <div className="muted small" style={{ marginTop: 10 }}>След създаването ще можете да зададете ограничения по модули за този потребител.</div>}
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
      { key: 'project_code', title: 'Обект' }, { key: 'origin_module', title: 'Източник', render: r => <span><DeptBadge code={r.origin_module} /> <span className="muted small">{r.origin_module}</span></span> }, { key: 'user_name', title: 'Потребител' },
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
  const f = useForm({ company_name: '', currency: 'EUR', vat_pct: '20', overhead_pct: '3.5', profit_pct: '30', corporate_tax_pct: '10', exceptional_expense_limit: '1000', overconsumption_tolerance_pct: '5', weather_rain_mm: '2', weather_wind_ms: '10', weather_min_temp: '5', weather_refresh_hours: '3', ...state.settings, offer_next_number: '' });
  const { run, busy } = useAction();
  const write = can('settings', 'write');
  return <>
    <div className="page-head"><h1>Настройки</h1><span className="spacer" />{tab === 'users' && can('users', 'write') && <button className="primary" onClick={() => setEdit({})}>Нов потребител</button>}</div>
    <Tabs tabs={[['users', 'Потребители'], ['perms', 'Права'], ['company', 'Фирма и параметри'], ...(can('events') ? [['events', 'Синхронизация'] as [string, string]] : [])]} value={tab} onChange={setTab} />
    {tab === 'users' && <Card pad={false}><Loader state={users}><Table rows={users.data || []} onRow={can('users', 'write') ? setEdit : undefined} cols={[
      { key: 'full_name', title: 'Име' }, { key: 'username', title: 'Потребител' }, { key: 'role', title: 'Роля', render: r => ROLE_LABEL[r.role] || r.role },
      { key: 'department', title: 'Отдел', render: r => <DeptBadge code={r.department} /> }, { key: 'phone', title: 'Телефон' }, { key: 'email', title: 'Имейл' }, { key: 'offer_letter', title: 'Буква оферти' }, { key: 'office', title: 'Офис' },
      { key: 'active', title: 'Статус', render: r => r.active ? <span className="badge ok">активен</span> : <span className="badge">деактивиран</span> }]} /></Loader></Card>}
    {tab === 'perms' && <Permissions />}
    {tab === 'events' && <Events />}
    {tab === 'company' && <Card title="Фирма и параметри" actions={write && <button className="primary" disabled={busy} onClick={() => run(async () => { const { offer_last_number, ...body } = f.v as any; await api.put('/settings', body); f.set('offer_next_number', ''); await reload(); }, 'Настройките са записани')}>Запис</button>}>
      <div className="form c3">
        <Field label="Фирма" full><input {...f.bind('company_name')} disabled={!write} /></Field>
        <Field label="Валута"><input {...f.bind('currency')} disabled={!write} /></Field>
        <Field label="ДДС %"><input type="number" step="0.1" {...f.bind('vat_pct')} disabled={!write} /></Field>
        <Field label="Режийни % (оферти)"><input type="number" step="0.1" {...f.bind('overhead_pct')} disabled={!write} /></Field>
        <Field label="Печалба % (оферти)"><input type="number" step="0.1" {...f.bind('profit_pct')} disabled={!write} /></Field>
        <Field label="Корпоративен данък % върху печалбата"><input type="number" step="0.1" {...f.bind('corporate_tax_pct')} disabled={!write} /></Field>
        <Field label="Праг за извънреден разход"><input type="number" step="1" {...f.bind('exceptional_expense_limit')} disabled={!write} /></Field>
        <Field label="Допуск за преразход на материали %"><input type="number" step="0.1" {...f.bind('overconsumption_tolerance_pct')} disabled={!write} /></Field>
        <Field label={`Следващ номер на оферта (последен издаден: ${state.settings.offer_last_number || 0})`}><input type="number" min="1" step="1" {...f.bind('offer_next_number')} disabled={!write} placeholder="празно = продължава поред" /></Field>
        <Field label="Време: предупреждение при валеж от (мм)"><input type="number" step="0.5" {...f.bind('weather_rain_mm')} disabled={!write} /></Field>
        <Field label="Време: предупреждение при вятър от (м/с)"><input type="number" step="0.5" {...f.bind('weather_wind_ms')} disabled={!write} /></Field>
        <Field label="Време: предупреждение при минимум под (°C)"><input type="number" step="0.5" {...f.bind('weather_min_temp')} disabled={!write} /></Field>
        <Field label="Време: обновяване на всеки (часа)"><input type="number" min="1" step="1" {...f.bind('weather_refresh_hours')} disabled={!write} /></Field>
      </div></Card>}
    {edit && <UserForm initial={edit.id ? edit : undefined} onClose={() => setEdit(null)} onSaved={users.reload} />}
  </>;
}