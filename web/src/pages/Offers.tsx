import React, { useState } from 'react';
import { api, fmtDate, fmtMoney } from '../api';
import { Card, Empty, Field, Loader, Modal, Status, Table, Tabs, navigate, useAction, useCan, useCurrency, useFilter, useForm, useLoad } from '../ui';
import { CustomerForm } from './Customers';
export { OfferEditor } from './OfferEditor';

function NewOffer({ customers, inquiry, onClose, reloadCustomers }: { customers: any[]; inquiry?: any; onClose: () => void; reloadCustomers: () => void }) {
  const f = useForm({ customer_id: inquiry?.customer_id || '', title: inquiry?.title || '', site_address: inquiry?.site_address || '', attention_to: '', validity_months: 1, inquiry_id: inquiry?.id || null });
  const [newCustomer, setNewCustomer] = useState(false);
  const { run, busy } = useAction();
  const save = () => run(async () => { const o = await api.post('/offers', f.v); onClose(); navigate(`/offers/${o.id}`); });
  return <Modal title={inquiry ? `Оферта по запитване ${inquiry.code}` : 'Нова оферта'} onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.customer_id || !String(f.v.title).trim()} onClick={save}>Създай</button></>}>
    <div className="form c2">
      <Field label="Клиент" full><div className="row" style={{ flexWrap: 'nowrap' }}>
        <select {...f.bind('customer_id')}><option value="">— изберете —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
        <button onClick={() => setNewCustomer(true)}>Нов</button></div></Field>
      <Field label="Обект (заглавие)" full><input {...f.bind('title')} /></Field>
      <Field label="Адрес на обекта" full><input {...f.bind('site_address')} /></Field>
      <Field label="На вниманието на"><input {...f.bind('attention_to')} /></Field>
      <Field label="Валидност (месеци)"><input type="number" min="1" step="1" {...f.bind('validity_months')} /></Field>
    </div>
    {newCustomer && <CustomerForm onClose={() => setNewCustomer(false)} onSaved={c => { reloadCustomers(); f.set('customer_id', c.id); }} />}
  </Modal>;
}

function NewInquiry({ customers, onClose, onSaved, reloadCustomers }: { customers: any[]; onClose: () => void; onSaved: () => void; reloadCustomers: () => void }) {
  const f = useForm({ customer_id: '', title: '', site_address: '', description: '', received_on: new Date().toISOString().slice(0, 10) });
  const [newCustomer, setNewCustomer] = useState(false);
  const { run, busy } = useAction();
  return <Modal title="Ново запитване" onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !f.v.customer_id || !f.v.title.trim()}
      onClick={() => run(async () => { await api.post('/inquiries', f.v); onSaved(); onClose(); }, 'Запитването е записано')}>Запис</button></>}>
    <div className="form c2">
      <Field label="Клиент" full><div className="row" style={{ flexWrap: 'nowrap' }}>
        <select {...f.bind('customer_id')}><option value="">— изберете —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
        <button onClick={() => setNewCustomer(true)}>Нов</button></div></Field>
      <Field label="Какво търси клиентът" full><input {...f.bind('title')} /></Field>
      <Field label="Адрес на обекта"><input {...f.bind('site_address')} /></Field>
      <Field label="Получено на"><input type="date" {...f.bind('received_on')} /></Field>
      <Field label="Описание" full><textarea {...f.bind('description')} /></Field>
    </div>
    {newCustomer && <CustomerForm onClose={() => setNewCustomer(false)} onSaved={c => { reloadCustomers(); f.set('customer_id', c.id); }} />}
  </Modal>;
}

export function Offers() {
  const can = useCan();
  const cur = useCurrency();
  const [tab, setTab] = useState('offers');
  const [q, setQ] = useState('');
  const offers = useLoad<any[]>('/offers');
  const inquiries = useLoad<any[]>('/inquiries');
  const customers = useLoad<any[]>('/customers');
  const [modal, setModal] = useState<null | { kind: 'offer' | 'inquiry'; inquiry?: any }>(null);
  const write = can('offers', 'write');
  const oRows = useFilter(offers.data, q, r => [r.code, r.title, r.customer_name, r.site_address, r.project_code].join(' '));
  const iRows = useFilter(inquiries.data, q, r => [r.code, r.title, r.customer_name, r.site_address].join(' '));
  return <>
    <div className="page-head"><h1>Оферти</h1><span className="spacer" />
      <input style={{ maxWidth: 240 }} placeholder="Филтър" value={q} onChange={e => setQ(e.target.value)} />
      {write && <button onClick={() => setModal({ kind: 'inquiry' })}>Ново запитване</button>}
      {write && <button className="primary" onClick={() => setModal({ kind: 'offer' })}>Нова оферта</button>}</div>
    <Tabs tabs={[['offers', `Оферти (${offers.data?.length ?? 0})`], ['inquiries', `Запитвания (${inquiries.data?.length ?? 0})`]]} value={tab} onChange={setTab} />
    <Card pad={false}>
      {tab === 'offers' ? <Loader state={offers}><Table rows={oRows} onRow={r => navigate(`/offers/${r.id}`)}
        empty={<Empty title="Няма оферти">Създайте запитване или директно нова оферта.</Empty>} cols={[
          { key: 'code', title: '№', width: 100 }, { key: 'title', title: 'Обект' }, { key: 'customer_name', title: 'Клиент' },
          { key: 'current_version', title: 'Версия', render: r => 'v' + r.current_version }, { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> },
          { key: 'total', title: `Стойност без ДДС, ${cur}`, num: true, render: r => fmtMoney(r.total) }, { key: 'project_code', title: 'Обект №' },
          { key: 'created_at', title: 'Създадена', render: r => fmtDate(r.created_at) }]} /></Loader>
        : <Loader state={inquiries}><Table rows={iRows} empty={<Empty title="Няма запитвания">Тук се записва първият контакт с клиента.</Empty>} cols={[
          { key: 'code', title: '№', width: 100 }, { key: 'title', title: 'Запитване' }, { key: 'customer_name', title: 'Клиент' }, { key: 'site_address', title: 'Адрес' },
          { key: 'received_on', title: 'Получено', render: r => fmtDate(r.received_on) }, { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> },
          { key: 'act', title: '', render: r => write && r.status === 'open' ? <button className="sm" onClick={() => setModal({ kind: 'offer', inquiry: r })}>Създай оферта</button> : null }]} /></Loader>}
    </Card>
    {modal?.kind === 'offer' && <NewOffer customers={customers.data || []} inquiry={modal.inquiry} onClose={() => { setModal(null); inquiries.reload(); }} reloadCustomers={customers.reload} />}
    {modal?.kind === 'inquiry' && <NewInquiry customers={customers.data || []} onClose={() => setModal(null)} onSaved={inquiries.reload} reloadCustomers={customers.reload} />}
  </>;
}