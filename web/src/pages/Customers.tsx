import React, { useState } from 'react';
import { api } from '../api';
import { Card, Empty, Field, Loader, Modal, Table, useAction, useCan, useFilter, useForm, useLoad } from '../ui';

const BLANK = { name: '', kind: 'company', vat_no: '', contact_person: '', phone: '', email: '', address: '', notes: '' };

export function CustomerForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (c: any) => void }) {
  const f = useForm({ ...BLANK, ...(initial || {}) });
  const { run, busy } = useAction();
  const save = () => run(async () => {
    const saved = initial?.id ? await api.patch(`/customers/${initial.id}`, f.v) : await api.post('/customers', f.v);
    onSaved(saved); onClose();
  }, 'Клиентът е записан');
  return <Modal title={initial?.id ? `Клиент ${initial.code}` : 'Нов клиент'} onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !String(f.v.name).trim()} onClick={save}>Запис</button></>}>
    <div className="form c2">
      <Field label="Фирма / лице" full><input {...f.bind('name')} autoFocus /></Field>
      <Field label="Вид"><select {...f.bind('kind')}><option value="company">Фирма</option><option value="person">Физическо лице</option></select></Field>
      <Field label="ЕИК / ДДС №"><input {...f.bind('vat_no')} /></Field>
      <Field label="Лице за контакт"><input {...f.bind('contact_person')} /></Field>
      <Field label="Телефон"><input {...f.bind('phone')} inputMode="tel" /></Field>
      <Field label="Имейл"><input type="email" {...f.bind('email')} /></Field>
      <Field label="Адрес"><input {...f.bind('address')} /></Field>
      <Field label="Бележки" full><textarea {...f.bind('notes')} /></Field>
    </div>
  </Modal>;
}

export function Customers() {
  const list = useLoad<any[]>('/customers');
  const can = useCan();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any | null>(null);
  const rows = useFilter(list.data, q, r => [r.code, r.name, r.contact_person, r.phone, r.email, r.address].join(' '));
  return <>
    <div className="page-head"><h1>Клиенти</h1><span className="spacer" />
      <input style={{ maxWidth: 260 }} placeholder="Филтър" value={q} onChange={e => setQ(e.target.value)} />
      {can('customers', 'write') && <button className="primary" onClick={() => setEdit({})}>Нов клиент</button>}</div>
    <Card pad={false}><Loader state={list}>
      <Table rows={rows} onRow={can('customers', 'write') ? setEdit : undefined} empty={<Empty title="Няма клиенти">Добавете първия клиент, за да създадете запитване или оферта.</Empty>} cols={[
        { key: 'code', title: 'Код', width: 90 }, { key: 'name', title: 'Име' }, { key: 'contact_person', title: 'Контакт' },
        { key: 'phone', title: 'Телефон' }, { key: 'email', title: 'Имейл' }, { key: 'address', title: 'Адрес' }]} />
    </Loader></Card>
    {edit && <CustomerForm initial={edit.id ? edit : undefined} onClose={() => setEdit(null)} onSaved={() => list.reload()} />}
  </>;
}