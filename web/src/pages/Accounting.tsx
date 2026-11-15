// Счетоводство: портфолио от финансови показатели, проформи, приходи/разходи, заявки за плащане с одобрение, настаняване.
import React, { useState } from 'react';
import { api, fmtDate, fmtMoney, today } from '../api';
import { Card, Empty, Field, Loader, Modal, Status, Table, Tabs, useAction, useCan, useCurrency, useForm, useLoad, usePath } from '../ui';

const KIND: Record<string, string> = { advance: 'Аванс', interim: 'Междинна', final: 'Окончателна', other: 'Друга' };
const DIR: Record<string, [string, string]> = { in: ['Приход', 'ok'], out: ['Разход', ''] };
const money = (n: any, cur: string) => fmtMoney(n, cur);

export function Accounting() {
  const path = usePath();
  const [pid, setPid] = useState(new URLSearchParams(path.split('?')[1] || '').get('pid') || '');
  const [tab, setTab] = useState('proformas');
  const port = useLoad<any>('/accounting');
  const q = pid ? `?project_id=${pid}` : '';
  const proformas = useLoad<any[]>(`/proformas${q}`);
  const transactions = useLoad<any[]>(`/transactions${q}`);
  const requests = useLoad<any[]>(`/payment-requests${q}`);
  const accommodations = useLoad<any[]>(`/accommodations${q}`);
  const reloadAll = () => { port.reload(); proformas.reload(); transactions.reload(); requests.reload(); accommodations.reload(); };
  const can = useCan();
  const cur = useCurrency();
  const { run, busy } = useAction();
  const write = can('finance', 'write');
  const approve = can('approvals', 'approve');
  const projects: any[] = port.data?.projects || [];
  const totals = port.data?.totals;

  const [modal, setModal] = useState<null | { kind: string; row?: any }>(null);
  const close = () => setModal(null);

  const proformaAction = (r: any, action: 'paid' | 'cancel') => {
    if (action === 'paid' && !window.confirm(`Отбелязване на ${r.code} като платена създава входяща транзакция. Продължаване?`)) return;
    run(async () => { await api.post(`/proformas/${r.id}/${action}`); reloadAll(); },
      action === 'paid' ? 'Проформата е платена' : 'Проформата е отменена');
  };
  const requestAction = (r: any, action: 'approve' | 'reject') => {
    const note = window.prompt(action === 'approve' ? 'Бележка при одобрение (по желание):' : 'Причина за отхвърляне:') || '';
    if (action === 'reject' && !note) return;
    run(async () => { await api.post(`/payment-requests/${r.id}/${action}`, { note }); reloadAll(); },
      action === 'approve' ? 'Заявката е одобрена' : 'Заявката е отхвърлена');
  };

  return <>
    <div className="page-head"><h1>Счетоводство</h1><span className="spacer" />
      <select value={pid} onChange={e => setPid(e.target.value)} aria-label="Обект" style={{ minWidth: 220 }}>
        <option value="">Всички обекти</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
      </select></div>

    <Loader state={port}>
      {totals && <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="kpi bad"><div className="label">Вземания (неплатени проформи)</div><div className="value">{money(totals.receivables, cur)}</div></div>
        <div className="kpi warn"><div className="label">Задължения към доставчици</div><div className="value">{money(totals.payables, cur)}</div></div>
        <div className="kpi"><div className="label">Получени плащания</div><div className="value">{money(totals.payments_received, cur)}</div></div>
        <div className="kpi"><div className="label">Резултат до момента</div><div className="value">{money(totals.result_to_date, cur)}</div><div className="sub">прогноза: {money(totals.forecast_result, cur)}</div></div>
      </div>}
      <Card title="Финансови показатели по обекти" pad={false}>
        <Table rows={projects} empty={<Empty title="Няма обекти">Обектите се появяват при потвърдена оферта.</Empty>} cols={[
          { key: 'code', title: '№ / Обект', render: (r: any) => `${r.code} — ${r.name}` },
          { key: 'customer_name', title: 'Клиент' },
          { key: 'contract_value', title: `Договор, ${cur}`, num: true, render: (r: any) => money(r.contract_value, cur) },
          { key: 'invoiced', title: 'Издадени', num: true, render: (r: any) => money(r.invoiced, cur) },
          { key: 'payments_received', title: 'Получени', num: true, render: (r: any) => money(r.payments_received, cur) },
          { key: 'payments_made', title: 'Платени', num: true, render: (r: any) => money(r.payments_made, cur) },
          { key: 'receivables', title: 'Вземания', num: true, render: (r: any) => r.receivables ? <span className="badge warn">{money(r.receivables, cur)}</span> : money(0, cur) },
          { key: 'payables', title: 'Задължения', num: true, render: (r: any) => r.payables ? <span className="badge bad">{money(r.payables, cur)}</span> : money(0, cur) },
          { key: 'result_to_date', title: 'Резултат', num: true, render: (r: any) => <span className={r.result_to_date < 0 ? 'badge bad' : ''}>{money(r.result_to_date, cur)}</span> },
        ]} foot={totals && <tr>
          <td colSpan={2}>Общо</td>
          <td className="num">{money(totals.contract_value, cur)}</td><td className="num">{money(totals.invoiced, cur)}</td>
          <td className="num">{money(totals.payments_received, cur)}</td><td className="num">{money(totals.payments_made, cur)}</td>
          <td className="num">{money(totals.receivables, cur)}</td><td className="num">{money(totals.payables, cur)}</td>
          <td className="num">{money(totals.result_to_date, cur)}</td></tr>} />
      </Card>
    </Loader>

    <Tabs value={tab} onChange={setTab} tabs={[['proformas', 'Проформи'], ['transactions', 'Приходи и разходи'], ['requests', 'Заявки за плащане'], ['accommodations', 'Настаняване']]} />

    {tab === 'proformas' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'proforma' })}>+ Нова проформа</button></div>}
      <Card pad={false}><Loader state={proformas}><Table rows={proformas.data || []} empty={<Empty title="Няма проформи">Проформите се издават за обект с договор.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}<div className="small muted">{r.customer_name}</div></> },
        { key: 'kind', title: 'Вид', render: (r: any) => KIND[r.kind] || r.kind },
        { key: 'amount', title: `Сума без ДДС, ${cur}`, num: true, render: (r: any) => money(r.amount, cur) },
        { key: 'vat_pct', title: 'ДДС', num: true, render: (r: any) => r.vat_pct + '%' },
        { key: 'issued_on', title: 'Издадена', render: (r: any) => fmtDate(r.issued_on) },
        { key: 'due_on', title: 'Срок', render: (r: any) => fmtDate(r.due_on) },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'x', title: '', width: 170, render: (r: any) => write && r.status === 'issued' ? <span className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="sm primary" disabled={busy} onClick={() => proformaAction(r, 'paid')}>Платена</button>
          <button className="sm ghost" disabled={busy} onClick={() => proformaAction(r, 'cancel')}>Отказ</button></span> : null },
      ]} /></Loader></Card>
    </>}

    {tab === 'transactions' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'transaction' })}>+ Нова транзакция</button></div>}
      <Card pad={false}><Loader state={transactions}><Table rows={transactions.data || []} empty={<Empty title="Няма транзакции">Запишете приход или разход по обект.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'tx_date', title: 'Дата', render: (r: any) => fmtDate(r.tx_date) },
        { key: 'pj', title: 'Обект', render: (r: any) => r.project_code ? <>{r.project_code} — {r.project_name}</> : <span className="muted">Без обект</span> },
        { key: 'dir', title: 'Вид', width: 90, render: (r: any) => <span className={'badge ' + DIR[r.direction][1]}>{DIR[r.direction][0]}</span> },
        { key: 'category', title: 'Категория' },
        { key: 'amount', title: `Сума, ${cur}`, num: true, render: (r: any) => <span className={r.status === 'voided' ? 'muted' : ''} style={r.status === 'voided' ? { textDecoration: 'line-through' } : {}}>{money(r.amount, cur)}</span> },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'counterparty', title: 'Контрагент' },
        { key: 'proforma_code', title: 'Проформа', render: (r: any) => r.proforma_code || '—' },
        { key: 'x', title: '', width: 40, render: (r: any) => write ? <button className="ghost sm" onClick={() => setModal({ kind: 'transaction', row: r })}>✎</button> : null },
      ]} /></Loader></Card>
    </>}

    {tab === 'requests' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'request' })}>+ Нова заявка</button></div>}
      <Card pad={false}><Loader state={requests}><Table rows={requests.data || []} empty={<Empty title="Няма заявки">Заявките за плащане отиват при Управител за одобрение.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'pj', title: 'Обект', render: (r: any) => r.project_code ? <>{r.project_code} — {r.project_name}</> : <span className="muted">Без обект</span> },
        { key: 'category', title: 'Категория' },
        { key: 'payee', title: 'Получател' },
        { key: 'amount', title: `Сума, ${cur}`, num: true, render: (r: any) => money(r.amount, cur) },
        { key: 'reason', title: 'Основание' },
        { key: 'status', title: 'Статус', render: (r: any) => <>{r.exceptional ? <span className="badge warn">извънредна</span> : null} <Status value={r.status} />{r.status !== 'pending' && r.decided_by_name ? <div className="small muted">{r.decided_by_name}{r.approval_note ? ': ' + r.approval_note : ''}</div> : null}</> },
        { key: 'x', title: '', width: 150, render: (r: any) => approve && r.status === 'pending' ? <span className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="sm primary" disabled={busy} onClick={() => requestAction(r, 'approve')}>Одобри</button>
          <button className="sm ghost" disabled={busy} onClick={() => requestAction(r, 'reject')}>Откажи</button></span> : null },
      ]} /></Loader></Card>
    </>}

    {tab === 'accommodations' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'accommodation' })}>+ Нов запис</button></div>}
      <Card pad={false}><Loader state={accommodations}><Table rows={accommodations.data || []} empty={<Empty title="Няма записи">Настаняването на работниците се води по обект.</Empty>} cols={[
        { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}</> },
        { key: 'place', title: 'Място' }, { key: 'address', title: 'Адрес' },
        { key: 'date_from', title: 'От', render: (r: any) => fmtDate(r.date_from) }, { key: 'date_to', title: 'До', render: (r: any) => fmtDate(r.date_to) },
        { key: 'beds', title: 'Легла', num: true }, { key: 'cost_per_night', title: `Цена/нощ, ${cur}`, num: true, render: (r: any) => money(r.cost_per_night, cur) },
        { key: 'payment_method', title: 'Плащане' }, { key: 'parking', title: 'Паркиране' }, { key: 'workers', title: 'Работници' },
        { key: 'x', title: '', width: 40, render: (r: any) => write ? <button className="ghost sm" onClick={() => setModal({ kind: 'accommodation', row: r })}>✎</button> : null },
      ]} /></Loader></Card>
    </>}

    {modal?.kind === 'proforma' && <ProformaForm projects={projects} pid={pid} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'transaction' && <TransactionForm projects={projects} pid={pid} row={modal.row} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'request' && <RequestForm projects={projects} pid={pid} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'accommodation' && <AccommodationForm projects={projects} pid={pid} row={modal.row} onClose={close} onDone={reloadAll} />}
  </>;
}

// ---------------------------------------------------------------- форми
function ProjSelect({ projects, value, onChange, allowEmpty, emptyLabel = '— без обект —' }: { projects: any[]; value: string; onChange: (v: string) => void; allowEmpty?: boolean; emptyLabel?: string }) {
  return <Field label="Обект"><select value={value} onChange={e => onChange(e.target.value)} required={!allowEmpty}>
    {allowEmpty && <option value="">{emptyLabel}</option>}
    {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
  </select></Field>;
}

function ProformaForm({ projects, pid, onClose, onDone }: { projects: any[]; pid: string; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const f = useForm({ project_id: pid, kind: 'advance', amount: '', vat_pct: '', issued_on: today(), due_on: '', note: '' });
  const save = () => run(async () => {
    await api.post('/proformas', { project_id: Number(f.v.project_id), kind: f.v.kind, amount: Number(f.v.amount),
      vat_pct: f.v.vat_pct === '' ? undefined : Number(f.v.vat_pct), issued_on: f.v.issued_on || undefined, due_on: f.v.due_on || undefined, note: f.v.note || undefined });
    onDone(); onClose();
  }, 'Проформата е издадена');
  return <Modal title="Нова проформа" onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.project_id || !(Number(f.v.amount) > 0)} onClick={save}>Издай</button></>}>
    <div className="form c2">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} />
      <Field label="Вид"><select {...f.bind('kind')}><option value="advance">Аванс</option><option value="interim">Междинна</option><option value="final">Окончателна</option><option value="other">Друга</option></select></Field>
      <Field label="Сума без ДДС"><input type="number" min="0" step="any" {...f.bind('amount')} required /></Field>
      <Field label="ДДС % (по желание)"><input type="number" min="0" step="any" {...f.bind('vat_pct')} placeholder="20" /></Field>
      <Field label="Дата на издаване"><input type="date" {...f.bind('issued_on')} /></Field>
      <Field label="Срок на плащане"><input type="date" {...f.bind('due_on')} /></Field>
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
    </div>
  </Modal>;
}

function TransactionForm({ projects, pid, row, onClose, onDone }: { projects: any[]; pid: string; row?: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const edit = !!row;
  const f = useForm({ project_id: row ? String(row.project_id ?? '') : pid, direction: row?.direction || 'out', category: row?.category || '', amount: row ? String(row.amount) : '',
    tx_date: row?.tx_date || today(), due_on: row?.due_on || '', status: row?.status && row.status !== 'voided' ? row.status : 'paid', counterparty: row?.counterparty || '', document_ref: row?.document_ref || '', note: row?.note || '' });
  const save = () => run(async () => {
    const body: any = { category: f.v.category, amount: Number(f.v.amount), tx_date: f.v.tx_date, due_on: f.v.due_on || undefined, status: f.v.status,
      counterparty: f.v.counterparty || undefined, document_ref: f.v.document_ref || undefined, note: f.v.note || undefined };
    if (edit) await api.patch(`/transactions/${row.id}`, { ...body, row_version: row.row_version });
    else await api.post('/transactions', { ...body, project_id: f.v.project_id ? Number(f.v.project_id) : null, direction: f.v.direction });
    onDone(); onClose();
  }, edit ? 'Транзакцията е обновена' : 'Транзакцията е записана');
  return <Modal title={edit ? `Транзакция ${row.code}` : 'Нова транзакция'} onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.category || !(Number(f.v.amount) > 0) || !f.v.tx_date} onClick={save}>Запази</button></>}>
    <div className="form c2">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} allowEmpty={!edit} />
      {!edit && <Field label="Вид"><select {...f.bind('direction')}><option value="out">Разход</option><option value="in">Приход</option></select></Field>}
      <Field label="Категория"><input {...f.bind('category')} required placeholder="напр. материали, труд, наем" /></Field>
      <Field label="Сума"><input type="number" min="0" step="any" {...f.bind('amount')} required /></Field>
      <Field label="Дата"><input type="date" {...f.bind('tx_date')} required /></Field>
      <Field label="Срок на плащане"><input type="date" {...f.bind('due_on')} /></Field>
      <Field label="Статус"><select {...f.bind('status')}><option value="paid">Платено</option><option value="committed">Задължение</option><option value="planned">Планирано</option>{edit && <option value="voided">Анулирано</option>}</select></Field>
      <Field label="Контрагент"><input {...f.bind('counterparty')} /></Field>
      <Field label="Документ №"><input {...f.bind('document_ref')} /></Field>
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
    </div>
  </Modal>;
}

function RequestForm({ projects, pid, onClose, onDone }: { projects: any[]; pid: string; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const f = useForm({ project_id: pid, category: '', amount: '', payee: '', reason: '', exceptional: '' });
  const save = () => run(async () => {
    await api.post('/payment-requests', { project_id: f.v.project_id ? Number(f.v.project_id) : null, category: f.v.category, amount: Number(f.v.amount),
      payee: f.v.payee, reason: f.v.reason || undefined, exceptional: f.v.exceptional === '1' ? true : undefined });
    onDone(); onClose();
  }, 'Заявката е подадена при Управител');
  return <Modal title="Нова заявка за плащане" onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.category || !(Number(f.v.amount) > 0) || !f.v.payee} onClick={save}>Подай</button></>}>
    <div className="form c2">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} allowEmpty />
      <Field label="Категория"><input {...f.bind('category')} required placeholder="напр. материали, труд" /></Field>
      <Field label="Сума"><input type="number" min="0" step="any" {...f.bind('amount')} required /></Field>
      <Field label="Получател"><input {...f.bind('payee')} required /></Field>
      <Field label="Извънреден разход"><select {...f.bind('exceptional')}><option value="">Автоматично по лимита</option><option value="1">Да, изрично</option></select></Field>
      <Field label="Основание" full><textarea {...f.bind('reason')} /></Field>
    </div>
  </Modal>;
}

function AccommodationForm({ projects, pid, row, onClose, onDone }: { projects: any[]; pid: string; row?: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const edit = !!row;
  const f = useForm({ project_id: row ? String(row.project_id) : pid, place: row?.place || '', address: row?.address || '', date_from: row?.date_from || '', date_to: row?.date_to || '',
    beds: row?.beds != null ? String(row.beds) : '', cost_per_night: row?.cost_per_night != null ? String(row.cost_per_night) : '', payment_method: row?.payment_method || '', parking: row?.parking || '', workers: row?.workers || '', note: row?.note || '' });
  const save = () => run(async () => {
    const body: any = { place: f.v.place, address: f.v.address || undefined, date_from: f.v.date_from || undefined, date_to: f.v.date_to || undefined,
      beds: f.v.beds === '' ? undefined : Number(f.v.beds), cost_per_night: f.v.cost_per_night === '' ? undefined : Number(f.v.cost_per_night),
      payment_method: f.v.payment_method || undefined, parking: f.v.parking || undefined, workers: f.v.workers || undefined, note: f.v.note || undefined };
    if (edit) await api.patch(`/accommodations/${row.id}`, { ...body, row_version: row.row_version });
    else await api.post('/accommodations', { ...body, project_id: Number(f.v.project_id) });
    onDone(); onClose();
  }, edit ? 'Записът е обновен' : 'Записът е създаден');
  return <Modal title={edit ? 'Настаняване — редакция' : 'Нов запис за настаняване'} onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.project_id || !f.v.place} onClick={save}>Запази</button></>}>
    <div className="form c2">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} />
      <Field label="Място"><input {...f.bind('place')} required /></Field>
      <Field label="Адрес"><input {...f.bind('address')} /></Field>
      <Field label="Настаняване от"><input type="date" {...f.bind('date_from')} /></Field>
      <Field label="Настаняване до"><input type="date" {...f.bind('date_to')} /></Field>
      <Field label="Легла"><input type="number" min="0" {...f.bind('beds')} /></Field>
      <Field label="Цена за нощ"><input type="number" min="0" step="any" {...f.bind('cost_per_night')} /></Field>
      <Field label="Метод на плащане"><input {...f.bind('payment_method')} placeholder="напр. фактура, по договор" /></Field>
      <Field label="Паркиране"><input {...f.bind('parking')} /></Field>
      <Field label="Работници"><input {...f.bind('workers')} /></Field>
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
    </div>
  </Modal>;
}
