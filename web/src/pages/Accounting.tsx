// Счетоводство: портфолио от финансови показатели, проформи, приходи/разходи, заявки за плащане с одобрение, настаняване.
import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtMoney, today } from '../api';
import { ConfirmTab, PaymentForm, orderChoices, useQueue } from './PaymentForm';
import { Card, LineSelect, Empty, Field, Loader, Modal, Status, Table, Tabs, useAction, useCan, useCurrency, useForm, useLoad, usePath, useFocus } from '../ui';

const KIND: Record<string, string> = { advance: 'Аванс', interim: 'Междинна', final: 'Окончателна', other: 'Друга' };
const DIR: Record<string, [string, string]> = { in: ['Приход', 'ok'], out: ['Разход', ''] };
const TX_KIND: Record<string, string> = { client: 'Клиент (фактура)', supplier_doc: 'Доставчик (документ)', bank_in: 'Банка приход', bank_out: 'Банка разход', proforma: 'Проформа', labour: 'Труд', fiscal: 'Фискален бон', card: 'Подотчетен: аванс / връщане', no_doc: 'Без документ', store: 'Складова разписка', other: 'Друго' };
const TX_METHOD: Record<string, string> = { bank: 'Банка', cash: 'Каса', card: 'Карта', eurowag: 'ЕВРОВАГ (гориво)' };
const SO_STATUS: Record<string, [string, string]> = { ordered: ['Поръчана', ''], in_production: ['В производство', 'warn'], in_transit: ['На път', 'info'], delivered: ['Доставена', 'ok'], cancelled: ['Отменена', ''] };
const money = (n: any, cur: string) => fmtMoney(n, cur);

export function Accounting() {
  const path = usePath();
  const [pid, setPid] = useState(new URLSearchParams(path.split('?')[1] || '').get('pid') || '');
  const [tab, setTab] = useState(new URLSearchParams(path.split('?')[1] || '').get('tab') || 'proformas');
  // a link (e.g. from a notification) names the tab and the record; follow it also when the page is already open
  const linkQ = new URLSearchParams(path.split('?')[1] || ''), focus = linkQ.get('focus');
  useEffect(() => { const t = linkQ.get('tab'); if (t) setTab(t); }, [path]);
  const queue = useQueue(true);
  const unalloc = useLoad<any[]>(`/payments/unallocated${pid ? `?project_id=${pid}` : ''}`);
  const waiting = (queue.data?.reported?.length || 0) + (queue.data?.unmatched?.length || 0);
  const port = useLoad<any>('/accounting');
  const q = pid ? `?project_id=${pid}` : '';
  const proformas = useLoad<any[]>(`/proformas${q}`);
  const transactions = useLoad<any[]>(`/transactions${q}`);
  const requests = useLoad<any[]>(`/payment-requests${q}`);
  const accommodations = useLoad<any[]>(`/accommodations${q}`);
  const persons = useLoad<any[]>(tab === 'persons' || tab === 'ledger' ? '/accountable-persons' : null);
  const centers = useLoad<any[]>(tab === 'centers' || tab === 'ledger' || tab === 'transactions' ? '/cost-centers' : null);
  const orders = useLoad<any[]>(tab === 'orders' ? `/supplier-orders${q}` : null);
  const [lf, setLf] = useState<Record<string, string>>({});
  const ledger = useLoad<any>(tab === 'ledger' ? '/ledger' + (() => { const p = new URLSearchParams(); if (pid) p.set('project_id', pid); for (const k of ['direction', 'tx_kind', 'company', 'person_id', 'cost_center_id', 'from', 'to', 'roots']) if (lf[k]) p.set(k, lf[k]); const s = p.toString(); return s ? '?' + s : ''; })() : null, [lf]);
  const reloadAll = () => { queue.reload(); unalloc.reload(); port.reload(); proformas.reload(); transactions.reload(); requests.reload(); accommodations.reload(); persons.reload(); centers.reload(); orders.reload(); ledger.reload(); };
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
    if (action === 'paid') { setModal({ kind: 'pay_proforma', row: r }); return; }
    run(async () => { await api.post(`/proformas/${r.id}/${action}`); reloadAll(); }, 'Проформата е отменена');
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
        <div className="kpi bad"><div className="label">Остава да получим с ДДС</div><div className="value">{money(totals.receivables, cur)}</div></div>
        <div className="kpi warn"><div className="label">Задължения към доставчици с ДДС</div><div className="value">{money(totals.payables, cur)}</div></div>
        <div className="kpi"><div className="label">Получени плащания с ДДС</div><div className="value">{money(totals.payments_received, cur)}</div></div>
        <div className="kpi"><div className="label">Резултат до момента без ДДС</div><div className="value">{money(totals.result_to_date, cur)}</div><div className="sub">прогноза: {money(totals.forecast_result, cur)}</div></div>
      </div>}
      <Card title="Финансови показатели по обекти" pad={false}>
        <Table rows={projects} empty={<Empty title="Няма обекти">Обектите се появяват при потвърдена оферта.</Empty>} cols={[
          { key: 'code', title: '№ / Обект', render: (r: any) => `${r.code} — ${r.name}` },
          { key: 'customer_name', title: 'Клиент' },
          { key: 'contract_value', title: `Договор без ДДС, ${cur}`, num: true, render: (r: any) => money(r.contract_value, cur) },
          { key: 'invoiced', title: 'Издадени с ДДС', num: true, render: (r: any) => money(r.invoiced, cur) },
          { key: 'payments_received', title: 'Получени с ДДС', num: true, render: (r: any) => money(r.payments_received, cur) },
          { key: 'payments_made', title: 'Платени с ДДС', num: true, render: (r: any) => money(r.payments_made, cur) },
          { key: 'receivables', title: 'Вземания с ДДС', num: true, render: (r: any) => r.receivables ? <span className="badge warn">{money(r.receivables, cur)}</span> : money(0, cur) },
          { key: 'payables', title: 'Задължения с ДДС', num: true, render: (r: any) => r.payables ? <span className="badge bad">{money(r.payables, cur)}</span> : money(0, cur) },
          { key: 'result_to_date', title: 'Резултат без ДДС', num: true, render: (r: any) => <span className={r.result_to_date < 0 ? 'badge bad' : ''}>{money(r.result_to_date, cur)}</span> },
        ]} foot={totals && <tr>
          <td colSpan={2}>Общо</td>
          <td className="num">{money(totals.contract_value, cur)}</td><td className="num">{money(totals.invoiced, cur)}</td>
          <td className="num">{money(totals.payments_received, cur)}</td><td className="num">{money(totals.payments_made, cur)}</td>
          <td className="num">{money(totals.receivables, cur)}</td><td className="num">{money(totals.payables, cur)}</td>
          <td className="num">{money(totals.result_to_date, cur)}</td></tr>} />
      </Card>
    </Loader>

    <Tabs value={tab} onChange={setTab} tabs={[['confirm', `За потвърждение${waiting ? ` (${waiting})` : ''}`], ['unallocated', `Неразпределени${unalloc.data?.length ? ` (${unalloc.data.length})` : ''}`], ['ledger', 'Книга'], ['proformas', 'Проформи'], ['transactions', 'Приходи и разходи'], ['persons', 'Подотчетни лица'], ['orders', 'Поръчки'], ['centers', 'Центрове'], ['requests', 'Заявки за плащане'], ['accommodations', 'Настаняване']]} />

    {tab === 'confirm' && <ConfirmTab queue={queue} onDone={reloadAll} />}

    {tab === 'unallocated' && <Card title="Плащания без документ и стари записи без вид" pad={false}>
      <div className="muted small" style={{ padding: '8px 12px' }}>Преводът плаща документ и сам по себе си не е разход. Свържете го с фактурата („✎“ → Документ) или задайте вид на стария запис.</div>
      <Loader state={unalloc}><Table rows={unalloc.data || []} empty={<Empty title="Няма неразпределени плащания" />} cols={[
        { key: 'tx_date', title: 'Дата', render: (r: any) => fmtDate(r.tx_date) },
        { key: 'pj', title: 'Обект', render: (r: any) => r.project_code ? `${r.project_code} — ${r.project_name}` : '—' },
        { key: 'counterparty', title: 'Контрагент' }, { key: 'category', title: 'Основание' },
        { key: 'amount', title: `Сума, ${cur}`, num: true, render: (r: any) => money(r.amount, cur) },
        { key: 'role', title: '', render: (r: any) => <span className="badge warn">{r.role === 'legacy' ? 'стар запис без вид' : 'без документ'}</span> },
        { key: 'x', title: '', width: 40, render: (r: any) => write ? <button className="ghost sm" onClick={() => setModal({ kind: 'transaction', row: r })}>✎</button> : null },
      ]} /></Loader></Card>}

    {tab === 'ledger' && <LedgerTab ledger={ledger} persons={persons} centers={centers} lf={lf} setLf={setLf} cur={cur} />}

    {tab === 'persons' && <PersonsTab persons={persons} write={write} cur={cur} onNew={() => setModal({ kind: 'person' })} />}

    {tab === 'orders' && <OrdersTab orders={orders} write={write} cur={cur} projects={projects} busy={busy} onNew={() => setModal({ kind: 'order' })} onEdit={(o: any) => setModal({ kind: 'order', row: o })} onPay={(o: any) => setModal({ kind: 'pay_order', row: o })} />}

    {tab === 'centers' && <CentersTab centers={centers} write={write} onNew={() => setModal({ kind: 'center' })} />}

    {tab === 'proformas' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'proforma' })}>+ Нова проформа</button></div>}
      <Card pad={false}><Loader state={proformas}><Table focus={tab === 'proformas' ? focus : null} rows={proformas.data || []} empty={<Empty title="Няма проформи">Проформите се издават за обект с договор.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}<div className="small muted">{r.customer_name}</div></> },
        { key: 'kind', title: 'Вид', render: (r: any) => KIND[r.kind] || r.kind },
        { key: 'amount', title: `Сума без ДДС, ${cur}`, num: true, render: (r: any) => money(r.amount, cur) },
        { key: 'vat_pct', title: 'ДДС', num: true, render: (r: any) => r.vat_pct + '%' },
        { key: 'gross', title: 'С ДДС', num: true, render: (r: any) => <>{money(r.gross, cur)}{r.paid > 0 && r.status !== 'paid' ? <div className="small muted">получено {money(r.paid, cur)}</div> : null}</> },
        { key: 'issued_on', title: 'Издадена', render: (r: any) => fmtDate(r.issued_on) },
        { key: 'due_on', title: 'Срок', render: (r: any) => fmtDate(r.due_on) },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'x', title: '', width: 170, render: (r: any) => write && r.status === 'issued' ? <span className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="sm primary" disabled={busy} onClick={() => proformaAction(r, 'paid')}>Запиши плащане</button>
          <button className="sm ghost" disabled={busy} onClick={() => proformaAction(r, 'cancel')}>Отказ</button></span> : null },
      ]} /></Loader></Card>
    </>}

    {tab === 'transactions' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'transaction' })}>+ Нова транзакция</button></div>}
      <Card pad={false}><Loader state={transactions}><Table focus={tab === 'transactions' ? focus : null} rows={transactions.data || []} empty={<Empty title="Няма транзакции">Запишете приход или разход по обект.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'tx_date', title: 'Дата', render: (r: any) => fmtDate(r.tx_date) },
        { key: 'pj', title: 'Обект', render: (r: any) => r.project_code ? <>{r.project_code} — {r.project_name}</> : <span className="muted">Без обект</span> },
        { key: 'dir', title: 'Вид', width: 90, render: (r: any) => <span className={'badge ' + DIR[r.direction][1]}>{DIR[r.direction][0]}</span> },
        { key: 'category', title: 'Категория' },
        { key: 'amount', title: `Сума, ${cur}`, num: true, render: (r: any) => <span className={r.status === 'voided' ? 'muted' : ''} style={r.status === 'voided' ? { textDecoration: 'line-through' } : {}}>{money(r.amount, cur)}</span> },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'counterparty', title: 'Контрагент' },
        { key: 'proforma_code', title: 'Проформа', render: (r: any) => r.proforma_code || '—' },
        { key: 'x', title: '', width: 40, render: (r: any) => write && r.status !== 'reported' ? <button className="ghost sm" onClick={() => setModal({ kind: 'transaction', row: r })}>✎</button> : null },
      ]} /></Loader></Card>
    </>}

    {tab === 'requests' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'request' })}>+ Нова заявка</button></div>}
      <Card pad={false}><Loader state={requests}><Table focus={tab === 'requests' ? focus : null} rows={requests.data || []} empty={<Empty title="Няма заявки">Заявките за плащане отиват при Управител за одобрение.</Empty>} cols={[
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
      <Card pad={false}><Loader state={accommodations}><Table focus={tab === 'accommodations' ? focus : null} rows={accommodations.data || []} empty={<Empty title="Няма записи">Настаняването на работниците се води по обект.</Empty>} cols={[
        { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}</> },
        { key: 'place', title: 'Място' }, { key: 'address', title: 'Адрес' },
        { key: 'date_from', title: 'От', render: (r: any) => fmtDate(r.date_from) }, { key: 'date_to', title: 'До', render: (r: any) => fmtDate(r.date_to) },
        { key: 'beds', title: 'Легла', num: true }, { key: 'cost_per_night', title: `Цена/нощ, ${cur}`, num: true, render: (r: any) => money(r.cost_per_night, cur) },
        { key: 'payment_method', title: 'Плащане' }, { key: 'parking', title: 'Паркиране' }, { key: 'workers', title: 'Работници' },
        { key: 'x', title: '', width: 40, render: (r: any) => write ? <button className="ghost sm" onClick={() => setModal({ kind: 'accommodation', row: r })}>✎</button> : null },
      ]} /></Loader></Card>
    </>}

    {modal?.kind === 'pay_proforma' && <PaymentForm title={`Плащане по ${modal.row.code}`} url={`/proformas/${modal.row.id}/paid`} dateKey="paid_at" report={false} amount={Math.round((modal.row.gross - modal.row.paid) * 100) / 100} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'pay_order' && <PaymentForm title={`Плащане по ${modal.row.code} — ${modal.row.supplier}`} url={`/supplier-orders/${modal.row.id}/payments`} report={false} choices={orderChoices(modal.row)} vat={{ last: modal.row.last_vat_pct ?? null }} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'proforma' && <ProformaForm projects={projects} pid={pid} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'transaction' && <TransactionForm projects={projects} pid={pid} row={modal.row} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'request' && <RequestForm projects={projects} pid={pid} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'accommodation' && <AccommodationForm projects={projects} pid={pid} row={modal.row} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'person' && <PersonForm onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'center' && <CenterForm onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'order' && <OrderForm projects={projects} pid={pid} row={modal.row} onClose={close} onDone={reloadAll} />}
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
    tx_date: row?.tx_date || today(), due_on: row?.due_on || '', status: row?.status && row.status !== 'voided' ? row.status : 'paid', counterparty: row?.counterparty || '', document_ref: row?.document_ref || '', note: row?.note || '',
    tx_kind: row?.tx_kind || '', method: row?.method || '', company: row?.company || '', person_id: row?.person_id ? String(row.person_id) : '',
    cost_center_id: row?.cost_center_id ? String(row.cost_center_id) : '', asset_id: row?.asset_id ? String(row.asset_id) : '',
    document_id: row?.document_id ? String(row.document_id) : '', has_vat: row?.has_vat ? 1 : 0, vat_amount: row?.vat_amount != null ? String(row.vat_amount) : '',
    labour_worker: row?.labour_worker || '', labour_days: row?.labour_days != null ? String(row.labour_days) : '', labour_rate: row?.labour_rate != null ? String(row.labour_rate) : '',
    pko_no: row?.pko_no || '', rko_no: row?.rko_no || '' });
  const persons = useLoad<any[]>('/accountable-persons');
  const centers = useLoad<any[]>('/cost-centers');
  const assets = useLoad<any[]>('/assets'); // logistics-scoped — field hides itself if the user cannot read it
  const openDocs = useLoad<any>(!edit || row?.document_id ? `/ledger?roots=1&direction=${f.v.direction}` : null, [f.v.direction]);
  const labour = f.v.tx_kind === 'labour';
  const labourAmt = labour && Number(f.v.labour_days) > 0 && Number(f.v.labour_rate) > 0 ? Math.round(Number(f.v.labour_days) * Number(f.v.labour_rate) * 100) / 100 : null;
  const save = () => run(async () => {
    const body: any = { category: f.v.category, tx_date: f.v.tx_date, due_on: f.v.due_on || undefined, status: f.v.status,
      counterparty: f.v.counterparty || undefined, document_ref: f.v.document_ref || undefined, note: f.v.note || undefined,
      tx_kind: f.v.tx_kind || undefined, method: f.v.method || undefined, company: f.v.company || undefined,
      person_id: f.v.person_id || null, cost_center_id: f.v.cost_center_id || null, asset_id: f.v.asset_id || null,
      document_id: f.v.document_id || null, has_vat: !!Number(f.v.has_vat), vat_amount: f.v.vat_amount === '' ? undefined : Number(f.v.vat_amount),
      labour_worker: f.v.labour_worker || undefined, labour_days: f.v.labour_days === '' ? undefined : Number(f.v.labour_days), labour_rate: f.v.labour_rate === '' ? undefined : Number(f.v.labour_rate),
      pko_no: f.v.pko_no || undefined, rko_no: f.v.rko_no || undefined };
    if (f.v.amount !== '') body.amount = Number(f.v.amount);
    if (edit) await api.patch(`/transactions/${row.id}`, { ...body, row_version: row.row_version });
    else await api.post('/transactions', { ...body, project_id: f.v.project_id ? Number(f.v.project_id) : null, direction: f.v.direction });
    onDone(); onClose();
  }, edit ? 'Транзакцията е обновена' : 'Транзакцията е записана');
  const ok = f.v.category && f.v.tx_date && (labour ? labourAmt != null : Number(f.v.amount) > 0);
  const docs: any[] = (openDocs.data?.rows || []).filter((t: any) => t.status !== 'voided' && t.open_amount > 0 && (!edit || t.id !== row.id));
  return <Modal wide title={edit ? `Транзакция ${row.code}` : 'Нова транзакция'} onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !ok} onClick={save}>Запази</button></>}>
    <div className="form c3">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} allowEmpty={!edit} />
      {!edit && <Field label="Посока"><select {...f.bind('direction')}><option value="out">Разход</option><option value="in">Приход</option></select></Field>}
      <Field label="Вид операция"><select {...f.bind('tx_kind')}><option value="">— няма —</option>{Object.entries(TX_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Категория"><input {...f.bind('category')} required placeholder="напр. материали, труд, наем" /></Field>
      <Field label={labour ? `Сума (дни × надница = ${labourAmt ?? '—'})` : 'Сума'}><input type="number" min="0" step="any" {...f.bind('amount')} required={!labour} placeholder={labour ? 'празно = дни × надница' : ''} /></Field>
      <Field label="Дата"><input type="date" {...f.bind('tx_date')} required /></Field>
      <Field label="Срок на плащане"><input type="date" {...f.bind('due_on')} /></Field>
      <Field label="Статус"><select {...f.bind('status')}><option value="paid">Платено</option><option value="committed">Задължение</option><option value="planned">Планирано</option>{edit && <option value="voided">Анулирано</option>}</select></Field>
      <Field label="Дружество"><input {...f.bind('company')} placeholder="напр. Синхро, Евроваг" /></Field>
      {labour && <>
        <Field label="Работник"><input {...f.bind('labour_worker')} /></Field>
        <Field label="Дни"><input type="number" min="0" step="any" {...f.bind('labour_days')} /></Field>
        <Field label="Надница"><input type="number" min="0" step="any" {...f.bind('labour_rate')} /></Field>
      </>}
      <Field label="Контрагент"><input {...f.bind('counterparty')} /></Field>
      <Field label="Документ №"><input {...f.bind('document_ref')} /></Field>
      <Field label="Начин на плащане"><select {...f.bind('method')}><option value="">— няма —</option>{Object.entries(TX_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      {docs.length > 0 && <Field label="Плащане към документ"><select value={f.v.document_id} onChange={e => f.set('document_id', e.target.value)}><option value="">— не е плащане —</option>
        {docs.map((t: any) => <option key={t.id} value={t.id}>{t.code} · {t.category} · остатък {money(t.open_amount, '')} · {t.counterparty || ''}</option>)}</select></Field>}
      <Field label="Подотчетно лице"><select value={f.v.person_id} onChange={e => f.set('person_id', e.target.value)}><option value="">— няма —</option>
        {(persons.data || []).filter((p: any) => p.active !== 0).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Център на разходите"><select value={f.v.cost_center_id} onChange={e => f.set('cost_center_id', e.target.value)}><option value="">— няма —</option>
        {(centers.data || []).filter((c: any) => c.active !== 0).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      {assets.data && <Field label="Автомобил / техника"><select value={f.v.asset_id} onChange={e => f.set('asset_id', e.target.value)}><option value="">— няма —</option>
        {assets.data.map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.plate ? ` (${a.plate})` : ''}</option>)}</select></Field>}
      {f.v.method === 'cash' && <>
        <Field label="ПКО №"><input {...f.bind('pko_no')} /></Field>
        <Field label="РКО №"><input {...f.bind('rko_no')} /></Field>
      </>}
      <Field label="С ДДС"><select value={String(f.v.has_vat)} onChange={e => f.set('has_vat', Number(e.target.value))}><option value="0">Не</option><option value="1">Да</option></select></Field>
      {Number(f.v.has_vat) === 1 && <Field label="ДДС сума"><input type="number" min="0" step="any" {...f.bind('vat_amount')} /></Field>}
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

// ---------------------------------------------------------------- Книга: единният регистър, филтриран в изгледи (§14.1)
function LedgerTab({ ledger, persons, centers, lf, setLf, cur }: any) {
  const focus = useFocus();
  const d = ledger.data;
  const set = (k: string, v: string) => setLf((x: Record<string, string>) => ({ ...x, [k]: v }));
  const sel = (k: string, opts: [string, string][], label: string) => (
    <select value={lf[k] || ''} onChange={e => set(k, e.target.value)} aria-label={label} style={{ maxWidth: 170 }}>
      <option value="">{label}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>);
  return <>
    <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
      {sel('direction', [['in', 'Приходи'], ['out', 'Разходи']], 'Посока')}
      {sel('tx_kind', Object.entries(TX_KIND), 'Вид операция')}
      {sel('person_id', (persons.data || []).map((p: any) => [String(p.id), p.name]), 'Подотчетно лице')}
      {sel('cost_center_id', (centers.data || []).map((c: any) => [String(c.id), c.name]), 'Център')}
      <input list="ledger-companies" placeholder="Дружество" value={lf.company || ''} onChange={e => set('company', e.target.value)} style={{ maxWidth: 140 }} />
      <datalist id="ledger-companies">{(d?.companies || []).map((c: string) => <option key={c} value={c} />)}</datalist>
      <input type="date" value={lf.from || ''} onChange={e => set('from', e.target.value)} aria-label="От" />
      <input type="date" value={lf.to || ''} onChange={e => set('to', e.target.value)} aria-label="До" />
      <label className="row small" style={{ gap: 4, flexWrap: 'nowrap' }}><input type="checkbox" checked={lf.roots === '1'} onChange={e => set('roots', e.target.checked ? '1' : '')} /> само документи</label>
      {Object.values(lf).some(Boolean) && <button className="ghost sm" onClick={() => setLf({})}>Изчисти</button>}
    </div>
    <Loader state={ledger}>{d && <>
      <div className="grid g4 kpis-m" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">Приходи (платени)</div><div className="value">{money(d.totals.in, cur)}</div></div>
        <div className="kpi bad"><div className="label">Разходи (платени)</div><div className="value">{money(d.totals.out, cur)}</div></div>
        <div className="kpi warn"><div className="label">Неплатени вземания</div><div className="value">{money(d.totals.open_in, cur)}</div></div>
        <div className="kpi warn"><div className="label">Неплатени задължения</div><div className="value">{money(d.totals.open_out, cur)}</div></div>
      </div>
      {Object.keys(d.by_company || {}).length > 1 && <div className="row" style={{ marginBottom: 12 }}>
        {Object.entries(d.by_company).map(([c, t]: any) => <span key={c} className="badge">{c}: <b>{money(t.in, cur)}</b> вх / <b>{money(t.out, cur)}</b> изх</span>)}
      </div>}
      <Card pad={false}><Table focus={focus} rows={d.rows} empty={<Empty title="Няма записи по филтъра" />} cols={[
        { key: 'tx_date', title: 'Дата', render: (r: any) => fmtDate(r.tx_date) },
        { key: 'tx_kind', title: 'Вид', render: (r: any) => <>{TX_KIND[r.tx_kind] || r.tx_kind || '—'}{r.document_code ? <div className="small muted">към {r.document_code}</div> : null}</> },
        { key: 'dir', title: '', width: 80, render: (r: any) => <span className={'badge ' + DIR[r.direction][1]}>{DIR[r.direction][0]}</span> },
        { key: 'category', title: 'Категория / основание', render: (r: any) => <>{r.category}{r.document_ref ? <div className="small muted">{r.document_ref}</div> : null}</> },
        { key: 'pj', title: 'Обект / център', render: (r: any) => r.project_code ? <>{r.project_code} — {r.project_name}</> : r.cost_center_name ? <span className="badge">{r.cost_center_name}</span> : <span className="muted">—</span> },
        { key: 'counterparty', title: 'Контрагент / лице', render: (r: any) => <>{r.counterparty || '—'}{r.person_name ? <div className="small muted">{r.person_name}</div> : null}</> },
        { key: 'company', title: 'Дружество', render: (r: any) => r.company || '—' },
        { key: 'amount', title: `Сума, ${cur}`, num: true, render: (r: any) => <span className={r.status === 'voided' ? 'muted' : ''} style={r.status === 'voided' ? { textDecoration: 'line-through' } : {}}>{money(r.amount, cur)}</span> },
        { key: 'open_amount', title: 'Остатък', num: true, render: (r: any) => r.document_id == null && r.status === 'committed' ? <span className={r.open_amount > 0 ? 'badge warn' : 'badge ok'}>{money(r.open_amount, cur)}</span> : (r.paid_sum ? money(r.paid_sum, cur) : '—') },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
      ]} /></Card></>}
    </Loader>
  </>;
}

// ---------------------------------------------------------------- Подотчетни лица: картата е изглед върху книгата (§14.2)
function PersonsTab({ persons, write, cur, onNew }: any) {
  const [card, setCard] = useState<any | null>(null);
  return <>
    {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={onNew}>+ Ново лице</button></div>}
    <Card pad={false}><Loader state={persons}><Table rows={persons.data || []}
      onRow={async (r: any) => setCard(await api.get(`/accountable-persons/${r.id}/card`))}
      empty={<Empty title="Няма подотчетни лица">Лицата на които се дават пари авансово се водят тук — с един регистър вместо отделен лист за всеки.</Empty>} cols={[
        { key: 'name', title: 'Лице', render: (r: any) => <>{r.name}{r.user_name ? <div className="small muted">{r.user_name}</div> : null}{r.active === 0 ? ' <span className="badge">неактивен</span>' : null}</> },
        { key: 'given', title: `Дадено, ${cur}`, num: true, render: (r: any) => money(r.given, cur) },
        { key: 'spent', title: `Изразходено, ${cur}`, num: true, render: (r: any) => money(r.spent, cur) },
        { key: 'returned', title: `Върнато, ${cur}`, num: true, render: (r: any) => money(r.returned, cur) },
        { key: 'balance', title: `Салдо, ${cur}`, num: true, render: (r: any) => <span className={r.balance > 0 ? 'badge warn' : r.balance < 0 ? 'badge bad' : 'badge ok'}>{money(r.balance, cur)}</span> },
      ]} /></Loader></Card>
    {card && <Modal wide title={`Карта на ${card.person.name}`} onClose={() => setCard(null)}>
      <div className="grid g4 kpis-m" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">Дадено + получено от лицето</div><div className="value">{money(card.given, cur)}</div></div>
        <div className="kpi"><div className="label">Изразходено (без гориво ЕВРОВАГ)</div><div className="value">{money(card.spent, cur)}</div></div>
        <div className="kpi"><div className="label">Върнато</div><div className="value">{money(card.returned, cur)}</div></div>
        <div className={'kpi ' + (card.balance > 0 ? 'warn' : card.balance < 0 ? 'bad' : '')}><div className="label">Салдо</div><div className="value">{money(card.balance, cur)}</div>
          <div className="sub">{card.balance > 0 ? 'лицето дължи' : card.balance < 0 ? 'фирмата дължи' : 'уравновесено'}</div></div>
      </div>
      <Table rows={card.movements || []} empty={<Empty title="Няма движения" />} cols={[
        { key: 'tx_date', title: 'Дата', render: (r: any) => fmtDate(r.tx_date) },
        { key: 'tx_kind', title: 'Вид', render: (r: any) => TX_KIND[r.tx_kind] || r.tx_kind || '—' },
        { key: 'dir', title: '', width: 80, render: (r: any) => <span className={'badge ' + DIR[r.direction][1]}>{DIR[r.direction][0]}</span> },
        { key: 'category', title: 'Основание' },
        { key: 'amount', title: `Сума, ${cur}`, num: true, render: (r: any) => money(r.amount, cur) },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
      ]} />
    </Modal>}
  </>;
}

// ---------------------------------------------------------------- Поръчки към доставчици: обратното броене върви от реални банкови дати (§14.4)
function OrdersTab({ orders, write, cur, onNew, onEdit, onPay }: any) {
  const focus = useFocus();
  return <>
    {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={onNew}>+ Нова поръчка</button></div>}
    <Card pad={false}><Loader state={orders}><Table focus={focus} rows={orders.data || []}
      empty={<Empty title="Няма поръчки">Поръчките към доставчици следят производството и доставката по реални дати на плащане.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'supplier', title: 'Доставчик', render: (r: any) => <>{r.supplier}<div className="small muted">{r.order_doc_no || ''}</div></> },
        { key: 'pj', title: 'Обект / позиция', render: (r: any) => <>{r.project_code} — {r.project_name}{r.line_description ? <div className="small muted">{r.line_description}</div> : null}</> },
        { key: 'total_eur', title: `Стойност, ${cur}`, num: true, render: (r: any) => money(r.total_eur, cur) },
        { key: 'advance_eur', title: `Аванс, ${cur}`, num: true, render: (r: any) => <>{money(r.advance_eur, cur)}{r.advance_paid_at ? <div className="small muted">платен {fmtDate(r.advance_paid_at)}</div> : <div className="small muted">неплатен</div>}</> },
        { key: 'ready', title: 'Готовност', render: (r: any) => r.ready_date ? <>{fmtDate(r.ready_date)}{r.days_left != null && <div className={'small ' + (r.days_left < 0 ? 'badge bad' : 'muted')}>{r.days_left >= 0 ? `още ${r.days_left} дн.` : `${-r.days_left} дн. закъснение`}</div>}</> : <span className="muted">—</span> },
        { key: 'final_eur', title: `Доплащане, ${cur}`, num: true, render: (r: any) => <>{money(r.final_eur, cur)}{r.final_paid_at ? <div className="small muted">платено {fmtDate(r.final_paid_at)}</div> : null}</> },
        { key: 'expected_delivery', title: 'Доставка в БГ', render: (r: any) => r.expected_delivery ? <>{fmtDate(r.expected_delivery)}{r.delivery_forecast ? <div className="small muted">прогноза</div> : null}</> : <span className="muted">—</span> },
        { key: 'computed_status', title: 'Статус', render: (r: any) => { const s = SO_STATUS[r.computed_status] || [r.computed_status, '']; return <>{r.awaiting_invoice ? <span className="badge warn" title="Платено, но няма фактура от доставчика: разходът идва от фактурата">чака фактура</span> : null}<span className={'badge ' + s[1]}>{s[0]}</span></>; } },
        { key: 'x', title: '', width: 150, render: (r: any) => write ? <span className="row" style={{ flexWrap: 'nowrap' }}><button className="sm" onClick={() => onPay(r)}>Плащане</button><button className="ghost sm" onClick={() => onEdit(r)}>✎</button></span> : null },
      ]} /></Loader></Card>
  </>;
}

// ---------------------------------------------------------------- Центрове на разходите (§14.b): офис / склад / механизация / лични…
function CentersTab({ centers, write, onNew }: any) {
  const KIND_CC: Record<string, string> = { overhead: 'Режийни', fleet: 'Механизация', marketing: 'Маркетинг', personal: 'Лични', finance: 'Финанси/кредити', import: 'Внос', other: 'Друго' };
  return <>
    {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={onNew}>+ Нов център</button></div>}
    <Card pad={false}><Loader state={centers}><Table rows={centers.data || []}
      empty={<Empty title="Няма центрове">Разходите извън обекти (офис, склад, механизация, лични) се водят в центрове — не във фалшиви обекти.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 }, { key: 'name', title: 'Център' },
        { key: 'kind', title: 'Вид', render: (r: any) => KIND_CC[r.kind] || r.kind },
        { key: 'active', title: 'Статус', render: (r: any) => r.active === 0 ? <span className="badge">неактивен</span> : <span className="badge ok">активен</span> },
      ]} /></Loader></Card>
  </>;
}

function PersonForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const f = useForm({ name: '', note: '' });
  const save = () => run(async () => { await api.post('/accountable-persons', { name: f.v.name, note: f.v.note || undefined }); onDone(); onClose(); }, 'Лицето е добавено');
  return <Modal title="Ново подотчетно лице" onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.name.trim()} onClick={save}>Запази</button></>}>
    <div className="form"><Field label="Име"><input {...f.bind('name')} required /></Field><Field label="Бележка"><input {...f.bind('note')} /></Field></div>
  </Modal>;
}

function CenterForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const f = useForm({ name: '', kind: 'overhead' });
  const save = () => run(async () => { await api.post('/cost-centers', { name: f.v.name, kind: f.v.kind }); onDone(); onClose(); }, 'Центърът е създаден');
  return <Modal title="Нов център на разходите" onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.name.trim()} onClick={save}>Запази</button></>}>
    <div className="form"><Field label="Име"><input {...f.bind('name')} required placeholder="напр. Офис, Склад, Механизация, Маркетинг" /></Field>
      <Field label="Вид"><select {...f.bind('kind')}><option value="overhead">Режийни</option><option value="fleet">Механизация</option><option value="marketing">Маркетинг</option><option value="personal">Лични</option><option value="finance">Финанси/кредити</option><option value="import">Внос</option><option value="other">Друго</option></select></Field></div>
  </Modal>;
}

/** The one supplier-order form (Accounting and Logistics). */
export function OrderForm({ projects, pid, row, onClose, onDone }: { projects: any[]; pid: string; row?: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const edit = !!row;
  const f = useForm({ project_id: row ? String(row.project_id) : pid, project_line_id: row?.project_line_id ? String(row.project_line_id) : '', supplier: row?.supplier || '', order_doc_no: row?.order_doc_no || '',
    total_eur: row?.total_eur != null ? String(row.total_eur) : '', advance_eur: row?.advance_eur != null ? String(row.advance_eur) : '',
    prod_days: row?.prod_days != null ? String(row.prod_days) : '', transport_days: row?.transport_days != null ? String(row.transport_days) : '',
    status: 'auto', note: row?.note || '' });
  const proj = useLoad<any>(f.v.project_id ? `/projects/${f.v.project_id}` : null, [f.v.project_id]);
  const save = () => run(async () => {
    const body: any = { supplier: f.v.supplier, order_doc_no: f.v.order_doc_no || undefined,
      total_eur: f.v.total_eur === '' ? undefined : Number(f.v.total_eur), advance_eur: f.v.advance_eur === '' ? undefined : Number(f.v.advance_eur),
      prod_days: f.v.prod_days === '' ? undefined : Number(f.v.prod_days),
      transport_days: f.v.transport_days === '' ? undefined : Number(f.v.transport_days),
      project_line_id: f.v.project_line_id ? Number(f.v.project_line_id) : null, note: f.v.note || undefined };
    if (edit) { if (f.v.status !== 'auto') body.status = f.v.status; await api.patch(`/supplier-orders/${row.id}`, { ...body, row_version: row.row_version }); }
    else await api.post('/supplier-orders', { ...body, project_id: Number(f.v.project_id) });
    onDone(); onClose();
  }, edit ? 'Поръчката е обновена' : 'Поръчката е записана');
  return <Modal title={edit ? `Поръчка ${row.code}` : 'Нова поръчка към доставчик'} onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.supplier.trim() || !f.v.project_id} onClick={save}>Запази</button></>}>
    <div className="form c2">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => { f.set('project_id', v); f.set('project_line_id', ''); }} />
      <Field label="Позиция от КС"><LineSelect lines={proj.data?.lines || []} value={f.v.project_line_id} onChange={v => f.set('project_line_id', v)} empty="— не е вързана —" /></Field>
      <Field label="Доставчик"><input {...f.bind('supplier')} required /></Field>
      <Field label="Поръчка / проформа №"><input {...f.bind('order_doc_no')} /></Field>
      <Field label="Обща стойност"><input type="number" min="0" step="any" {...f.bind('total_eur')} /></Field>
      <Field label="Аванс"><input type="number" min="0" step="any" {...f.bind('advance_eur')} /></Field>
      <Field label="Производство (дни)"><input type="number" min="0" {...f.bind('prod_days')} /></Field>
      <Field label="Транспорт до БГ (дни)"><input type="number" min="0" {...f.bind('transport_days')} /></Field>
      {edit && <Field label="Статус"><select {...f.bind('status')}><option value="auto">Автоматичен (по дати)</option><option value="ordered">Нулирай към автоматичен</option><option value="delivered">Доставена</option><option value="cancelled">Отменена</option></select></Field>}
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
      <div className="muted small" style={{ gridColumn: '1 / -1' }}>Датите на плащане идват от записаните плащания. Готовност = дата на аванс + производство. Доставка = доплащане + транспорт (прогноза: готовност + транспорт).</div>
    </div>
  </Modal>;
}
