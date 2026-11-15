// Картон на обекта: the single project workspace. Every tab reads the shared project records; nothing is copied.
import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../api';
import { WeatherCard } from './Weather';
import { Card, DeptBadge, Empty, Field, Kpi, Link, Loader, Modal, Progress, Status, Table, Tabs, navigate, useAction, useCan, useCurrency, useForm, useLoad, usePath } from '../ui';

const EVENT_LABEL: Record<string, string> = { 'offer.confirmed': 'Потвърдена оферта', 'contract.submitted': 'Договор изпратен за одобрение', 'contract.signed': 'Подписан договор',
  'project.assigned': 'Определен отговорник', 'stage.changed': 'Промяна на етап', 'request.created': 'Заявка за материали', 'progress.recorded': 'Отчетено изпълнение',
  'amendment.approved': 'Одобрен анекс', 'delivery.changed': 'Промяна по доставка', 'issue.reported': 'Докладван проблем' };
const PLANNED = ['Технически спецификации', 'Логистика и доставки', 'Склад', 'Механизация', 'Линеен график', 'Дневен отчет', 'Снимки и документи', 'Финанси', 'Настаняване', 'Анекси', 'Задачи и одобрения', 'Комуникация'];

function ContractTab({ pid, onChange }: { pid: number; onChange: () => void }) {
  const c = useLoad<any>(`/projects/${pid}/contract`);
  const can = useCan();
  const cur = useCurrency();
  const { run, busy } = useAction();
  const f = useForm<any>({});
  const [ver, setVer] = useState<any | null>(null);
  useEffect(() => { if (c.data) f.setV({ template: c.data.template, special_terms: c.data.special_terms || '', delivery_deadline: c.data.delivery_deadline || '', install_start: c.data.install_start || '',
    install_deadline: c.data.install_deadline || '', advance_pct: c.data.advance_pct, payment_terms_days: c.data.payment_terms_days }); }, [c.data?.row_version]);
  const d = c.data;
  if (!d) return <Loader state={c}><Empty title="Няма договор за този обект" /></Loader>;
  const write = can('contracts', 'write'), draft = d.status === 'draft' && write;
  const special = d.template !== 'standard' || !!d.special_terms;
  const act = (name: string, body: any = {}, ok?: string) => run(async () => { await api.post(`/projects/${pid}/contract/${name}`, body); await c.reload(); onChange(); }, ok);
  return <>
    <Card title={<span>Договор {d.code} <Status value={d.status} /> {d.active_version ? <span className="badge">версия {d.active_version}</span> : null}</span>} actions={<>
      {draft && <button disabled={busy} onClick={() => run(async () => { await api.patch(`/projects/${pid}/contract`, { ...f.v, row_version: d.row_version }); await c.reload(); }, 'Договорът е записан')}>Запис</button>}
      {draft && <button className="primary" disabled={busy} onClick={() => act('submit', {}, 'Изпратен за одобрение')}>Изпрати за одобрение</button>}
      {d.status === 'review' && write && <button disabled={busy} onClick={() => act('return', { note: window.prompt('Причина за връщане:') || '' }, 'Върнат за корекция')}>Върни за корекция</button>}
      {d.status === 'review' && (special ? can('approvals', 'approve') : write) && <button className="primary" disabled={busy} onClick={() => act('approve', {}, 'Договорът е одобрен. Създадена е версия 1.')}>Одобри</button>}
      {d.status === 'approved' && write && <button className="primary" disabled={busy} onClick={() => act('sign', { signed_on: window.prompt('Дата на подписване (ГГГГ-ММ-ДД):', new Date().toISOString().slice(0, 10)) || undefined }, 'Договорът е подписан. Сроковете са активни.')}>Отбележи като подписан</button>}</>}>
      {d.status === 'review' && special && <div className="alert warn">Договорът е със специални условия и се одобрява от Управител.</div>}
      {d.status !== 'draft' && <div className="alert">Одобрен договор не се редактира. Промени в количества, цени и срокове се правят с анекс, който създава нова версия.</div>}
      <div className="form c3">
        <Field label="Вид договор"><select {...f.bind('template')} disabled={!draft}><option value="standard">Стандартен</option><option value="special">Със специални условия</option></select></Field>
        <Field label="Аванс %"><input type="number" min="0" max="100" {...f.bind('advance_pct')} disabled={!draft} /></Field>
        <Field label="Срок за плащане (дни)"><input type="number" min="0" {...f.bind('payment_terms_days')} disabled={!draft} /></Field>
        <Field label="Срок за доставка"><input type="date" {...f.bind('delivery_deadline')} disabled={!draft} /></Field>
        <Field label="Начало на монтажа"><input type="date" {...f.bind('install_start')} disabled={!draft} /></Field>
        <Field label="Краен срок за монтаж"><input type="date" {...f.bind('install_deadline')} disabled={!draft} /></Field>
        <Field label="Специални условия (от Управител или Оферти)" full><textarea {...f.bind('special_terms')} disabled={!draft} /></Field>
      </div>
    </Card>
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

export function ProjectCard({ id }: { id: number }) {
  const p = useLoad<any>(`/projects/${id}`);
  const can = useCan();
  const cur = useCurrency();
  const path = usePath();
  const users = useLoad<any[]>('/users');
  const [tab, setTab] = useState(new URLSearchParams(path.split('?')[1] || '').get('tab') || 'overview');
  const timeline = useLoad<any[]>(tab === 'timeline' || tab === 'overview' ? `/projects/${id}/timeline` : null, [p.data?.row_version]);
  const audit = useLoad<any[]>(tab === 'audit' ? `/projects/${id}/audit` : null);
  const { run, busy } = useAction();
  const d = p.data;
  if (!d) return <Loader state={p}><div /></Loader>;
  const write = can('projects', 'write'), money = !!d.finance;
  const patch = (body: any, ok?: string) => run(async () => { await api.patch(`/projects/${id}`, { ...body, row_version: d.row_version }); await p.reload(); }, ok);
  const stage = (code: string, status: string) => run(async () => { await api.post(`/projects/${id}/stages`, { code, status }); await p.reload(); });
  const pending = (timeline.data || []).filter(e => e.status === 'pending' || e.status === 'processing').length, failed = (timeline.data || []).filter(e => e.status === 'failed').length;
  const tabs: [string, string][] = [['overview', 'Преглед'], ['customer', 'Клиент и обект'], ...(can('contracts') ? [['contract', 'Договор и приложения'] as [string, string]] : []), ['lines', 'КС и рецепти'], ['timeline', 'Хронология'], ['audit', 'Одит'], ['planned', 'Предстоящи раздели']];
  return <>
    <div className="page-head">
      <div><div className="muted small"><Link to="/projects">Обекти</Link> / {d.customer.name}</div><h1>{d.code} · {d.name} <Status value={d.status} /></h1><div className="muted">{d.site_address || 'няма въведен адрес'}</div></div>
      <span className="spacer" />{d.offer && can('offers') && <button onClick={() => navigate(`/offers/${d.offer.id}`)}>Оферта {d.offer.code} v{d.offer.confirmed_version}</button>}
    </div>
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

    {tab === 'lines' && <Card title="Количествено-стойностна сметка (КС) — договорни количества" pad={false}>
      <Table rows={d.lines} empty={<Empty title="Няма редове" />} cols={[{ key: 'sort', title: '№', width: 40 }, { key: 'description', title: 'Описание на СМР' }, { key: 'unit', title: 'Мярка' },
        { key: 'qty', title: 'Договорено', num: true, render: (r: any) => fmtNum(r.qty, 3) }, { key: 'done_qty', title: 'Изпълнено', num: true, render: (r: any) => fmtNum(r.done_qty, 3) },
        { key: 'pct', title: '%', num: true, render: (r: any) => r.qty ? fmtNum(Math.min(100, r.done_qty / r.qty * 100), 0) + '%' : '—' },
        ...(money ? [{ key: 'unit_price', title: 'Ед. цена', num: true, render: (r: any) => fmtMoney(r.unit_price) }, { key: 'tot', title: `Стойност, ${cur}`, num: true, render: (r: any) => fmtMoney(r.qty * r.unit_price) }] : [])]}
        foot={money ? <tr><td colSpan={7}>Общо без ДДС (версия {d.baseline_version ?? 'проект'})</td><td className="num">{fmtMoney(d.finance.contract_value)}</td></tr> : undefined} /></Card>}

    {tab === 'timeline' && <Card title="Хронология на обекта"><Loader state={timeline}>{(timeline.data || []).length === 0 ? <Empty title="Няма събития" /> : <ul className="timeline">{(timeline.data || []).map(e => <li key={e.id}>
      <div className="muted small">{fmtDateTime(e.ts)}<br />{e.user_name || 'система'}</div>
      <div><b>{EVENT_LABEL[e.type] || e.type}</b> <DeptBadge code={e.origin_module} /> <Status value={e.status} /> {e.approval_status && <span className="badge warn">одобрение: {e.approval_status}</span>}
        <div className="muted small">засегнати: {JSON.parse(e.affected_modules || '[]').join(', ') || '—'}</div>
        {e.new_value && <div className="mono small pre faint">{e.prev_value ? e.prev_value + ' → ' : ''}{e.new_value}</div>}{e.last_error && <div className="badge bad">{e.last_error}</div>}</div></li>)}</ul>}</Loader></Card>}

    {tab === 'audit' && <Card title="Одитна следа" pad={false}><Loader state={audit}><Table rows={audit.data || []} empty={<Empty title="Няма записи" />} cols={[
      { key: 'ts', title: 'Кога', render: r => fmtDateTime(r.ts), width: 130 }, { key: 'user_name', title: 'Кой', render: r => r.user_name || 'система' }, { key: 'module', title: 'Модул' },
      { key: 'entity_type', title: 'Обект на промяната', render: r => `${r.entity_type}${r.entity_id ? ' #' + r.entity_id : ''}` }, { key: 'action', title: 'Действие' },
      { key: 'before', title: 'Преди', render: r => <span className="mono small">{r.before}</span> }, { key: 'after', title: 'След', render: r => <span className="mono small">{r.after}</span> }]} /></Loader></Card>}

    {tab === 'planned' && <Card title="Раздели, които още не са изградени"><p className="muted">Тези раздели на Картона са в плана, но още не работят. Ще се появят тук, когато операциите, записът и правата им са тествани.</p>
      <div className="row">{PLANNED.map(x => <span key={x} className="badge">{x}</span>)}</div></Card>}
  </>;
}

function SiteForm({ d, write, busy, onSave }: { d: any; write: boolean; busy: boolean; onSave: (b: any) => void }) {
  const f = useForm({ site_address: d.site_address || '', access_notes: d.access_notes || '', unloading_notes: d.unloading_notes || '', storage_notes: d.storage_notes || '', parking_notes: d.parking_notes || '',
    courier_office: d.courier_office || '', courier_pallets: d.courier_pallets ? 1 : 0 });
  return <Card title="Обект и логистични ограничения" actions={write && <button className="primary" disabled={busy} onClick={() => onSave({ ...f.v, courier_pallets: Number(f.v.courier_pallets) })}>Запис</button>}><div className="form c2">
    <Field label="Адрес на обекта" full><input {...f.bind('site_address')} disabled={!write} /></Field>
    <Field label="Достъп до обекта" full><textarea {...f.bind('access_notes')} disabled={!write} /></Field>
    <Field label="Разтоварване"><textarea {...f.bind('unloading_notes')} disabled={!write} /></Field>
    <Field label="Съхранение на обекта"><textarea {...f.bind('storage_notes')} disabled={!write} /></Field>
    <Field label="Паркиране"><input {...f.bind('parking_notes')} disabled={!write} /></Field>
    <Field label="Най-близък куриерски офис"><input {...f.bind('courier_office')} disabled={!write} /></Field>
    <Field label="Офисът приема палети"><select {...f.bind('courier_pallets')} disabled={!write}><option value={0}>Не / неизвестно</option><option value={1}>Да</option></select></Field>
  </div></Card>;
}