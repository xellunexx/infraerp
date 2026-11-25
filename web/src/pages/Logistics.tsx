// Логистика: портфолио по обекти, доставки с артикели и статуси, техника и разпределението й.
import React, { useState } from 'react';
import { api, fmtDate, today } from '../api';
import { PaymentForm, orderChoices } from './PaymentForm';
import { Card, Empty, Field, Loader, Modal, Status, Table, Tabs, useAction, useCan, useForm, useLoad, usePath } from '../ui';

const KIND: Record<string, string> = { to_site: 'До обект', return: 'Връщане', other: 'Друго' };
const NEXT: Record<string, [string, string]> = { planned: ['in_transit', 'На път'], in_transit: ['delivered', 'Доставена'] };
const ASSET_KIND: Record<string, string> = { vehicle: 'Превозно средство', crane: 'Кран', manlift: 'Повдигач', generator: 'Генератор', other: 'Друго' };

export function Logistics() {
  const path = usePath();
  const [pid, setPid] = useState(new URLSearchParams(path.split('?')[1] || '').get('pid') || '');
  const [tab, setTab] = useState('deliveries');
  const port = useLoad<any>('/logistics');
  const q = pid ? `?project_id=${pid}` : '';
  const deliveries = useLoad<any[]>(`/deliveries${q}`);
  const assets = useLoad<any[]>('/assets');
  const allocations = useLoad<any[]>(`/asset-allocations${q}`);
  const products = useLoad<any[]>('/products');
  const orders = useLoad<any[]>(`/supplier-orders${q}`);
  const cons = useLoad<any>(tab === 'consumption' && pid ? `/projects/${pid}/consumption` : null);
  const reloadAll = () => { port.reload(); deliveries.reload(); assets.reload(); allocations.reload(); orders.reload(); cons.reload(); };
  const can = useCan();
  const write = can('logistics', 'write');
  const projects: any[] = port.data?.projects || [];
  const totals = port.data?.totals;

  const [modal, setModal] = useState<null | { kind: string; row?: any }>(null);
  const close = () => setModal(null);
  const { run, busy } = useAction();

  const deliveryAction = (r: any, status: string, label: string) => {
    if (!window.confirm(`${label} ${r.code}?`)) return;
    run(async () => { await api.patch(`/deliveries/${r.id}`, { status, row_version: r.row_version }); reloadAll(); }, `${r.code}: ${label.toLowerCase()}`);
  };

  return <>
    <div className="page-head"><h1>Логистика</h1><span className="spacer" />
      <select value={pid} onChange={e => setPid(e.target.value)} aria-label="Обект" style={{ minWidth: 220 }}>
        <option value="">Всички обекти</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
      </select></div>

    <Loader state={port}>
      {totals && <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="label">Доставки общо</div><div className="value">{totals.deliveries}</div></div>
        <div className="kpi warn"><div className="label">В транзит</div><div className="value">{totals.in_transit}</div></div>
        <div className="kpi"><div className="label">Разпределена техника</div><div className="value">{totals.active_allocations}</div></div>
        <div className="kpi"><div className="label">Свободна техника</div><div className="value">{port.data?.fleet?.available || 0}</div><div className="sub">от общо {Object.values(port.data?.fleet || {}).reduce((s: number, n: any) => s + n, 0)}</div></div>
      </div>}
      <Card title="Обекти — логистичен преглед" pad={false}>
        <Table rows={projects} empty={<Empty title="Няма обекти">Обектите се появяват при потвърдена оферта.</Empty>} cols={[
          { key: 'code', title: '№ / Обект', render: (r: any) => `${r.code} — ${r.name}` },
          { key: 'customer_name', title: 'Клиент' },
          { key: 'planned', title: 'Планирани', num: true, render: (r: any) => r.deliveries.planned },
          { key: 'in_transit', title: 'В транзит', num: true, render: (r: any) => r.deliveries.in_transit ? <span className="badge info">{r.deliveries.in_transit}</span> : 0 },
          { key: 'delivered', title: 'Доставени', num: true, render: (r: any) => r.deliveries.delivered },
          { key: 'cancelled', title: 'Отменени', num: true, render: (r: any) => r.deliveries.cancelled },
          { key: 'active_allocations', title: 'Техника', num: true, render: (r: any) => r.active_allocations || '—' },
        ]} />
      </Card>
    </Loader>

    <Tabs value={tab} onChange={setTab} tabs={[['deliveries', 'Доставки'], ['orders', 'Поръчки'], ['consumption', 'Количествена сметка'], ['assets', 'Техника']]} />

    {tab === 'deliveries' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'delivery' })}>+ Нова доставка</button></div>}
      <Card pad={false}><Loader state={deliveries}><Table rows={deliveries.data || []} empty={<Empty title="Няма доставки">Планирайте доставка на материали до обект.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}<div className="small muted">{r.customer_name}</div></> },
        { key: 'kind', title: 'Вид', render: (r: any) => KIND[r.kind] || r.kind },
        { key: 'planned_date', title: 'Планирана', render: (r: any) => fmtDate(r.planned_date) },
        { key: 'carrier', title: 'Превозвач' }, { key: 'pallets', title: 'Палети', num: true },
        { key: 'vehicle', title: 'Техника', render: (r: any) => r.vehicle_name ? `${r.vehicle_name}${r.vehicle_plate ? ' (' + r.vehicle_plate + ')' : ''}` : '—' },
        { key: 'items_summary', title: 'Съдържание', render: (r: any) => <span className="small">{r.items_summary || '—'}</span> },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'x', title: '', width: 210, render: (r: any) => write && !['delivered', 'cancelled'].includes(r.status) ? <span className="row" style={{ flexWrap: 'nowrap' }}>
          {NEXT[r.status] && <button className="sm primary" disabled={busy} onClick={() => deliveryAction(r, NEXT[r.status][0], NEXT[r.status][1])}>{NEXT[r.status][1]}</button>}
          <button className="sm ghost" disabled={busy} onClick={() => deliveryAction(r, 'cancelled', 'Отмяна')}>Отказ</button>
          <button className="ghost sm" onClick={() => setModal({ kind: 'delivery', row: r })}>✎</button></span> : null },
      ]} /></Loader></Card>
    </>}

    {tab === 'orders' && <>
      {write && <div className="row" style={{ marginBottom: 10 }}><button className="primary sm" onClick={() => setModal({ kind: 'order' })}>+ Нова поръчка</button></div>}
      <Card pad={false}><Loader state={orders}><Table rows={orders.data || []} empty={<Empty title="Няма поръчки">Поръчките към доставчици следят плащания, производство и доставка.</Empty>} cols={[
        { key: 'code', title: '№', width: 90 },
        { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}<div className="small muted">{r.line_description || ''}</div></> },
        { key: 'supplier', title: 'Доставчик' },
        { key: 'total_eur', title: 'Стойност €', num: true },
        { key: 'advance', title: 'Аванс', render: (r: any) => r.advance_paid_at ? <>{fmtDate(r.advance_paid_at)}<div className="small muted">{r.advance_eur ?? '—'} €</div></> : <span className="muted">неплатен</span> },
        { key: 'final', title: 'Доплащане', render: (r: any) => r.final_paid_at ? <>{fmtDate(r.final_paid_at)}<div className="small muted">{r.final_eur ?? '—'} €</div></> : <span className="muted">очаква</span> },
        { key: 'ready', title: 'Готовност', render: (r: any) => r.ready_date ? <>{fmtDate(r.ready_date)}{r.days_left != null && r.days_left >= 0 ? <div className="small muted">след {r.days_left} дн.</div> : null}</> : '—' },
        { key: 'expected', title: 'Очаквана доставка', render: (r: any) => r.expected_delivery ? <>{fmtDate(r.expected_delivery)}{r.delivery_forecast ? <div className="small muted">прогноза</div> : null}</> : '—' },
        { key: 'computed_status', title: 'Статус', render: (r: any) => <Status value={r.computed_status} /> },
        { key: 'x', title: '', width: 170, render: (r: any) => write && !['delivered', 'cancelled'].includes(r.status) ? <span className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="sm primary" disabled={busy} onClick={() => run(async () => { await api.patch(`/supplier-orders/${r.id}`, { status: 'delivered', row_version: r.row_version }); reloadAll(); }, 'Поръчката е доставена')}>Доставена</button>
          <button className="sm" onClick={() => setModal({ kind: 'pay_order', row: r })}>{can('finance', 'write') ? 'Плащане' : 'Докладвай плащане'}</button>
          <button className="ghost sm" onClick={() => setModal({ kind: 'order', row: r })}>✎</button></span> : null },
      ]} /></Loader></Card>
    </>}

    {tab === 'consumption' && <>
      {!pid && <Empty title="Изберете обект" >Количествената сметка е по обект — филтрирайте от горния селектор.</Empty>}
      {pid && <Card title="Количествена сметка по обект" pad={false}><Loader state={cons}><Table rows={cons.data?.rows || []} empty={<Empty title="Няма данни" />} cols={[
        { key: 'code', title: 'Код', width: 90 }, { key: 'name', title: 'Продукт' }, { key: 'unit', title: 'Мярка', width: 60 },
        { key: 'required', title: 'Необходимо по КС', num: true },
        { key: 'expected', title: 'По рецепта (извършено)', num: true },
        { key: 'issued', title: 'Заредено на обект', num: true },
        { key: 'consumed', title: 'Вградено', num: true },
        { key: 'on_site', title: 'На обект (ост.)', num: true },
        { key: 'variance', title: 'Отклонение', num: true, render: (r: any) => r.over ? <span className="badge bad">{r.variance}</span> : r.variance },
      ]} /></Loader></Card>}
    </>}

    {tab === 'assets' && <>
      {write && <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <button className="primary sm" onClick={() => setModal({ kind: 'asset' })}>+ Техника</button>
        <button className="sm" onClick={() => setModal({ kind: 'allocation' })}>+ Разпредели</button></div>}
      <Card title="Автопарк и техника" pad={false}><Loader state={assets}><Table rows={assets.data || []} empty={<Empty title="Няма техника">Регистрирайте превозни средства и механизация.</Empty>} cols={[
        { key: 'code', title: '№', width: 80 }, { key: 'name', title: 'Име' },
        { key: 'kind', title: 'Вид', render: (r: any) => ASSET_KIND[r.kind] || r.kind },
        { key: 'plate', title: 'Рег. №' }, { key: 'location', title: 'Местоположение' },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'allocated_project', title: 'Разпределена за', render: (r: any) => r.allocated_project || <span className="muted">свободна</span> },
        { key: 'x', title: '', width: 40, render: (r: any) => write ? <button className="ghost sm" onClick={() => setModal({ kind: 'asset', row: r })}>✎</button> : null },
      ]} /></Loader></Card>
      <Card title="Разпределение по обекти" pad={false}><Loader state={allocations}><Table rows={allocations.data || []} empty={<Empty title="Няма разпределения">Техниката се разпределя към обекти за период.</Empty>} cols={[
        { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}</> },
        { key: 'asset', title: 'Техника', render: (r: any) => `${r.asset_name}${r.asset_plate ? ' (' + r.asset_plate + ')' : ''}` },
        { key: 'date_from', title: 'От', render: (r: any) => fmtDate(r.date_from) },
        { key: 'date_to', title: 'До', render: (r: any) => fmtDate(r.date_to) },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'note', title: 'Бележка' },
        { key: 'x', title: '', width: 150, render: (r: any) => write && !['completed', 'cancelled'].includes(r.status) ? <span className="row" style={{ flexWrap: 'nowrap' }}>
          {r.status === 'planned' && <button className="sm primary" disabled={busy} onClick={() => run(async () => { await api.patch(`/asset-allocations/${r.id}`, { status: 'active', row_version: r.row_version }); reloadAll(); }, 'Техниката е активна')}>Активирай</button>}
          <button className="sm ghost" disabled={busy} onClick={() => run(async () => { await api.patch(`/asset-allocations/${r.id}`, { status: 'completed', row_version: r.row_version }); reloadAll(); }, 'Разпределението е приключено')}>Приключи</button>
          <button className="sm ghost" disabled={busy} onClick={() => run(async () => { await api.patch(`/asset-allocations/${r.id}`, { status: 'cancelled', row_version: r.row_version }); reloadAll(); }, 'Разпределението е отменено')}>Отказ</button></span> : null },
      ]} /></Loader></Card>
    </>}

    {modal?.kind === 'pay_order' && <PaymentForm title={`Плащане по ${modal.row.code} — ${modal.row.supplier}`} url={`/supplier-orders/${modal.row.id}/payments`} report={!can('finance', 'write')} choices={orderChoices(modal.row)} vat={{ last: modal.row.last_vat_pct ?? null }} onClose={() => setModal(null)} onDone={reloadAll} />}
    {modal?.kind === 'order' && <OrderForm projects={projects} row={modal.row} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'delivery' && <DeliveryForm projects={projects} assets={assets.data || []} pid={pid} row={modal.row} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'asset' && <AssetForm row={modal.row} onClose={close} onDone={reloadAll} />}
    {modal?.kind === 'allocation' && <AllocationForm projects={projects} assets={assets.data || []} pid={pid} onClose={close} onDone={reloadAll} />}
  </>;
}

// ---------------------------------------------------------------- форми
function OrderForm({ projects, row, onClose, onDone }: { projects: any[]; row?: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const edit = !!row;
  const f = useForm({ project_id: row ? String(row.project_id) : '', supplier: row?.supplier || '', order_doc_no: row?.order_doc_no || '',
    total_eur: row?.total_eur != null ? String(row.total_eur) : '', advance_eur: row?.advance_eur != null ? String(row.advance_eur) : '',
    prod_days: row?.prod_days != null ? String(row.prod_days) : '', transport_days: row?.transport_days != null ? String(row.transport_days) : '',
    status: row?.status || 'ordered', note: row?.note || '' });
  const save = () => run(async () => {
    const body: any = { supplier: f.v.supplier, order_doc_no: f.v.order_doc_no || undefined, note: f.v.note || undefined,
      total_eur: f.v.total_eur === '' ? undefined : Number(f.v.total_eur), advance_eur: f.v.advance_eur === '' ? undefined : Number(f.v.advance_eur),
      prod_days: f.v.prod_days === '' ? undefined : Number(f.v.prod_days), transport_days: f.v.transport_days === '' ? undefined : Number(f.v.transport_days) };
    if (edit) await api.patch(`/supplier-orders/${row.id}`, { ...body, status: f.v.status, row_version: row.row_version });
    else await api.post('/supplier-orders', { ...body, project_id: Number(f.v.project_id) });
    onDone(); onClose();
  }, edit ? 'Поръчката е обновена' : 'Поръчката е създадена');
  return <Modal title={edit ? `Поръчка ${row.code}` : 'Нова поръчка към доставчик'} onClose={onClose} wide footer={<><button className="ghost" onClick={onClose}>Отказ</button>
    <button className="primary" disabled={busy || !f.v.supplier || (!edit && !f.v.project_id)} onClick={save}>Запази</button></>}>
    <div className="form c2">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} />
      <Field label="Доставчик"><input {...f.bind('supplier')} required /></Field>
      <Field label="№ на поръчка"><input {...f.bind('order_doc_no')} /></Field>
      <Field label="Статус"><select {...f.bind('status')}><option value="ordered">Поръчана (автоматично)</option><option value="delivered">Доставена</option><option value="cancelled">Отменена</option></select></Field>
      <Field label="Обща стойност €"><input type="number" min="0" step="any" {...f.bind('total_eur')} /></Field>
      <Field label="Аванс €"><input type="number" min="0" step="any" {...f.bind('advance_eur')} /></Field>
      <Field label="Дни производство"><input type="number" min="0" step="1" {...f.bind('prod_days')} /></Field>
      <Field label="Дни транспорт"><input type="number" min="0" step="1" {...f.bind('transport_days')} /></Field>
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
    </div>
  </Modal>;
}

function ProjSelect({ projects, value, onChange }: { projects: any[]; value: string; onChange: (v: string) => void }) {
  return <Field label="Обект"><select value={value} onChange={e => onChange(e.target.value)} required>
    <option value="">— изберете —</option>
    {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
  </select></Field>;
}

function DeliveryForm({ projects, assets, pid, row, onClose, onDone }: { projects: any[]; assets: any[]; pid: string; row?: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const edit = !!row;
  const [items, setItems] = useState<any[]>([{ product_id: '', qty: '' }]);
  const f = useForm({ project_id: row ? String(row.project_id) : pid, kind: row?.kind || 'to_site', planned_date: row?.planned_date || '', carrier: row?.carrier || '',
    courier_office: row?.courier_office || '', pallets: row?.pallets != null ? String(row.pallets) : '', palletized: row ? String(row.palletized) : '1',
    vehicle_asset_id: row?.vehicle_asset_id ? String(row.vehicle_asset_id) : '', unloading: row?.unloading || '', address: row?.address || '',
    access_notes: row?.access_notes || '', note: row?.note || '' });
  const products = useLoad<any[]>('/products');
  const setItem = (i: number, k: string, v: string) => setItems(rows => rows.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const save = () => run(async () => {
    const body: any = { kind: f.v.kind, planned_date: f.v.planned_date || undefined, carrier: f.v.carrier || undefined, courier_office: f.v.courier_office || undefined,
      pallets: f.v.pallets === '' ? undefined : Number(f.v.pallets), palletized: f.v.palletized === '1',
      vehicle_asset_id: f.v.vehicle_asset_id ? Number(f.v.vehicle_asset_id) : undefined, unloading: f.v.unloading || undefined,
      address: f.v.address || undefined, access_notes: f.v.access_notes || undefined, note: f.v.note || undefined };
    if (edit) await api.patch(`/deliveries/${row.id}`, { ...body, row_version: row.row_version });
    else await api.post('/deliveries', { ...body, project_id: Number(f.v.project_id), items: items.filter(i => i.product_id && Number(i.qty) > 0).map(i => ({ product_id: Number(i.product_id), qty: Number(i.qty) })) });
    onDone(); onClose();
  }, edit ? 'Доставката е обновена' : 'Доставката е планирана');
  return <Modal title={edit ? `Доставка ${row.code}` : 'Нова доставка'} onClose={onClose} wide footer={<><button className="ghost" onClick={onClose}>Отказ</button>
    <button className="primary" disabled={busy || !f.v.project_id || (!edit && !items.some(i => i.product_id && Number(i.qty) > 0))} onClick={save}>Запази</button></>}>
    <div className="form c2">
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} />
      <Field label="Вид"><select {...f.bind('kind')}><option value="to_site">До обект</option><option value="return">Връщане</option><option value="other">Друго</option></select></Field>
      <Field label="Планирана дата"><input type="date" {...f.bind('planned_date')} /></Field>
      <Field label="Превозвач"><input {...f.bind('carrier')} placeholder="Econt, Speedy…" /></Field>
      <Field label="Куриерски офис"><input {...f.bind('courier_office')} /></Field>
      <Field label="Палети"><input type="number" min="0" step="1" {...f.bind('pallets')} /></Field>
      <Field label="Палетирано"><select {...f.bind('palletized')}><option value="1">Да</option><option value="0">Не</option></select></Field>
      <Field label="Техника"><select {...f.bind('vehicle_asset_id')}><option value="">— без техника —</option>
        {assets.map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.plate ? ' (' + a.plate + ')' : ''}</option>)}</select></Field>
      <Field label="Разтоварване"><input {...f.bind('unloading')} placeholder="кран, ръчно…" /></Field>
      <Field label="Адрес"><input {...f.bind('address')} /></Field>
      <Field label="Достъп до обекта"><input {...f.bind('access_notes')} /></Field>
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
      {!edit && <div className="full" style={{ gridColumn: '1 / -1' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><b>Артикули</b>
          <button type="button" className="sm ghost" onClick={() => setItems(rows => [...rows, { product_id: '', qty: '' }])}>+ ред</button></div>
        {items.map((it, i) => <div className="row" key={i} style={{ marginBottom: 6 }}>
          <select value={it.product_id} onChange={e => setItem(i, 'product_id', e.target.value)} style={{ flex: 2 }}>
            <option value="">— продукт —</option>
            {(products.data || []).map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name} ({p.unit})</option>)}
          </select>
          <input type="number" min="0" step="any" placeholder="кол." value={it.qty} onChange={e => setItem(i, 'qty', e.target.value)} style={{ width: 110 }} />
          <button type="button" className="ghost sm" onClick={() => setItems(rows => rows.filter((_, j) => j !== i))}>×</button>
        </div>)}
      </div>}
    </div>
  </Modal>;
}

function AssetForm({ row, onClose, onDone }: { row?: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const edit = !!row;
  const f = useForm({ name: row?.name || '', kind: row?.kind || 'vehicle', plate: row?.plate || '', status: row?.status || 'available', location: row?.location || '', notes: row?.notes || '' });
  const save = () => run(async () => {
    const body = { name: f.v.name, kind: f.v.kind, plate: f.v.plate || undefined, status: f.v.status, location: f.v.location || undefined, notes: f.v.notes || undefined };
    if (edit) await api.patch(`/assets/${row.id}`, { ...body, row_version: row.row_version });
    else await api.post('/assets', body);
    onDone(); onClose();
  }, edit ? 'Техниката е обновена' : 'Техниката е регистрирана');
  return <Modal title={edit ? `Техника ${row.code}` : 'Нова техника'} onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button>
    <button className="primary" disabled={busy || !f.v.name || !f.v.kind} onClick={save}>Запази</button></>}>
    <div className="form c2">
      <Field label="Име"><input {...f.bind('name')} required placeholder="Фургон, кран, повдигач…" /></Field>
      <Field label="Вид"><select {...f.bind('kind')}>{Object.entries(ASSET_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Рег. №"><input {...f.bind('plate')} /></Field>
      <Field label="Статус"><select {...f.bind('status')}><option value="available">Налична</option><option value="in_use">В употреба</option><option value="maintenance">В ремонт</option><option value="retired">Извадена</option></select></Field>
      <Field label="Местоположение"><input {...f.bind('location')} /></Field>
      <Field label="Бележка" full><input {...f.bind('notes')} /></Field>
    </div>
  </Modal>;
}

function AllocationForm({ projects, assets, pid, onClose, onDone }: { projects: any[]; assets: any[]; pid: string; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const [assetId, setAssetId] = useState('');
  const f = useForm({ project_id: pid, date_from: '', date_to: '', status: 'planned', note: '' });
  const save = () => run(async () => {
    await api.post('/asset-allocations', { asset_id: Number(assetId), project_id: Number(f.v.project_id), date_from: f.v.date_from, date_to: f.v.date_to,
      status: f.v.status, note: f.v.note || undefined });
    onDone(); onClose();
  }, 'Техниката е разпределена');
  return <Modal title="Разпредели техника" onClose={onClose} footer={<><button className="ghost" onClick={onClose}>Отказ</button>
    <button className="primary" disabled={busy || !assetId || !f.v.project_id || !f.v.date_from || !f.v.date_to} onClick={save}>Разпредели</button></>}>
    <div className="form c2">
      <Field label="Техника"><select value={assetId} onChange={e => setAssetId(e.target.value)} required>
        <option value="">— изберете —</option>
        {assets.filter((a: any) => ['available', 'in_use'].includes(a.status)).map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.plate ? ' (' + a.plate + ')' : ''}{a.allocated_project ? ' — заета: ' + a.allocated_project : ''}</option>)}
      </select></Field>
      <ProjSelect projects={projects} value={f.v.project_id} onChange={v => f.set('project_id', v)} />
      <Field label="От дата"><input type="date" {...f.bind('date_from')} required /></Field>
      <Field label="До дата"><input type="date" {...f.bind('date_to')} required /></Field>
      <Field label="Статус"><select {...f.bind('status')}><option value="planned">Планирано</option><option value="active">Активно</option></select></Field>
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
    </div>
  </Modal>;
}
