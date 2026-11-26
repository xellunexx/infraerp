import React, { useState } from 'react';
import { api, fmtDate, fmtDateTime, fmtNum } from '../api';
import { Card, Empty, Field, Loader, Modal, Status, Table, Tabs, useAction, useLoad, useLinkTab } from '../ui';

const KIND_LABEL: Record<string, string> = { receipt: 'Приемане', issue: 'Изписване към обект', return: 'Връщане', adjust: 'Корекция', transfer_out: 'Пренос към друг обект', transfer_in: 'Пренос от друг обект' };
const FORM_KINDS = ['receipt', 'issue', 'return', 'adjust', 'transfer_out'];
const MR_STATUS: Record<string, string> = { submitted: 'submitted', approved: 'approved', fulfilled: 'fulfilled', cancelled: 'cancelled' };

function MovementModal({ products, projects, onClose, onDone }: { products: any[]; projects: any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ product_id: '', kind: 'receipt', qty: '', project_id: '', to_project_id: '', unit_cost: '', document_ref: '', note: '' });
  const { run, busy } = useAction();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const isTransfer = f.kind === 'transfer_out';
  const needsProject = isTransfer || f.kind === 'issue' || f.kind === 'return';
  const valid = f.product_id && f.qty && (!needsProject || f.project_id) && (!isTransfer || f.to_project_id);
  return <Modal title="Ново складово движение" onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !valid}
      onClick={() => run(async () => { await api.post('/warehouse/movements', { ...f, project_id: f.project_id || null, to_project_id: f.to_project_id || null, unit_cost: f.unit_cost || null }); onDone(); onClose(); }, 'Движението е записано')}>Запиши</button></>}>
    <div className="form c2">
      <Field label="Продукт"><select value={f.product_id} onChange={e => set('product_id', e.target.value)}><option value="">—</option>
        {products.map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name} ({p.unit})</option>)}</select></Field>
      <Field label="Вид"><select value={f.kind} onChange={e => set('kind', e.target.value)}>{FORM_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
      <Field label="Количество"><input type="number" step="any" value={f.qty} onChange={e => set('qty', e.target.value)} /></Field>
      <Field label={isTransfer ? 'От обект' : needsProject ? 'Обект' : 'Обект (по избор)'}><select value={f.project_id} onChange={e => set('project_id', e.target.value)}><option value="">{needsProject ? '— задължително —' : '— склад —'}</option>
        {projects.map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
      {isTransfer && <Field label="Към обект"><select value={f.to_project_id} onChange={e => set('to_project_id', e.target.value)}><option value="">— задължително —</option>
        {projects.filter((p: any) => String(p.id) !== String(f.project_id)).map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>}
      <Field label="Ед. цена (по избор)"><input type="number" step="any" value={f.unit_cost} onChange={e => set('unit_cost', e.target.value)} placeholder="по подразбиране от продукта" /></Field>
      <Field label="Документ"><input value={f.document_ref} onChange={e => set('document_ref', e.target.value)} placeholder="фактура, товарителница №" /></Field>
      <Field label="Бележка" full><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
    </div>
  </Modal>;
}

function RequestModal({ projects, onClose, onDone }: { projects: any[]; onClose: () => void; onDone: () => void }) {
  const [pid, setPid] = useState('');
  const [note, setNote] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const demand = useLoad<any[]>(pid ? `/warehouse/demand?project_id=${pid}` : null);
  const { run, busy } = useAction();
  const rows = (demand.data || []).filter((d: any) => Number(qty[d.product_id] ?? d.suggest_qty) > 0 && sel[d.product_id] !== false);
  return <Modal wide title="Нова заявка за материали" onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy || !pid || !rows.length}
      onClick={() => run(async () => {
        await api.post('/material-requests', { project_id: Number(pid), needed_by: neededBy || null, note: note || null,
          items: rows.map((d: any) => ({ product_id: d.product_id, qty: Number(qty[d.product_id] ?? d.suggest_qty) })) });
        onDone(); onClose();
      }, 'Заявката е подадена')}>Подай заявка</button></>}>
    <div className="form c3" style={{ marginBottom: 10 }}>
      <Field label="Обект"><select value={pid} onChange={e => { setPid(e.target.value); setQty({}); setSel({}); }}><option value="">— изберете —</option>
        {projects.map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
      <Field label="Нужни до"><input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></Field>
      <Field label="Бележка"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    </div>
    {pid && <Loader state={demand}><table className="t"><thead><tr><th></th><th>Продукт</th><th>Нужно общо</th><th>Изписано</th><th>Резервиран</th><th>Налични</th><th>Предложено</th><th>Заявено</th></tr></thead><tbody>
      {(demand.data || []).map((d: any) => <tr key={d.product_id} style={{ opacity: sel[d.product_id] === false ? 0.45 : 1 }}>
        <td><input type="checkbox" checked={sel[d.product_id] !== false} onChange={e => setSel(s => ({ ...s, [d.product_id]: e.target.checked }))} /></td>
        <td>{d.code} — {d.name}</td><td className="num">{fmtNum(d.required)}</td><td className="num">{fmtNum(d.issued)}</td>
        <td className="num">{fmtNum(d.reserved_project)}</td><td className="num">{fmtNum(d.free)}</td>
        <td className="num">{d.covered ? <span className="badge ok">покрито</span> : <b>{fmtNum(d.suggest_qty)}</b>}</td>
        <td><input type="number" step="any" style={{ width: 90 }} value={qty[d.product_id] ?? (d.suggest_qty || '')} onChange={e => setQty(q => ({ ...q, [d.product_id]: e.target.value }))} /></td></tr>)}
      {!(demand.data || []).length && <tr><td colSpan={8} className="muted">Няма данни за този обект.</td></tr>}
    </tbody></table>
    <div className="muted small" style={{ marginTop: 6 }}>„Предложено“ = нужно по КС/рецепти − изписано − активни резервации. Наличните са свободни (на склад − всички резервации).</div></Loader>}
  </Modal>;
}

function RequestDetail({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const list = useLoad<any[]>('/material-requests');
  const { run, busy } = useAction();
  const m = (list.data || []).find(x => x.id === id);
  if (!m) return null;
  const act = (a: string, msg: string) => run(async () => { await api.post(`/material-requests/${id}/${a}`, {}); await list.reload(); onDone(); }, msg);
  return <Modal wide title={`Заявка ${m.code} · ${m.project_code}`} onClose={onClose} footer={<button onClick={onClose}>Затвори</button>}>
    <dl className="dl"><dt>Статус</dt><dd><Status value={MR_STATUS[m.status]} /></dd><dt>Нужни до</dt><dd>{fmtDate(m.needed_by)}</dd>
      <dt>Подадена от</dt><dd>{m.origin === 'technical' ? 'Технически отдел' : m.origin === 'contracts' ? 'Договори' : 'Склад'}</dd>
      <dt>Бележка</dt><dd>{m.note || '—'}</dd><dt>Заявил</dt><dd>{m.requester_name || '—'}</dd><dt>Създадена</dt><dd>{fmtDateTime(m.created_at)}</dd></dl>
    <table className="t" style={{ marginTop: 8 }}><thead><tr><th>Продукт</th><th>СМР ред</th><th>Количество</th><th>Резервирано</th><th>За покупка</th></tr></thead><tbody>
      {(m.items || []).map((i: any) => <tr key={i.id}><td>{i.product_code} — {i.product_name} ({i.unit})</td><td className="small">{i.project_line_code || '—'}</td><td className="num">{fmtNum(i.qty)}</td>
        <td className="num">{fmtNum(i.reserved_qty)}</td><td className="num">{fmtNum(i.to_purchase_qty)}</td></tr>)}</tbody></table>
    <div className="actions" style={{ marginTop: 12 }}>
      {m.status === 'submitted' && <button className="primary" disabled={busy} onClick={() => act('approve', 'Заявката е одобрена и материалите са резервирани')}>Одобри и резервирай</button>}
      {m.status === 'approved' && <button className="primary" disabled={busy} onClick={() => act('fulfil', 'Материалите са изписани от склада')}>Изпълни (изписване)</button>}
      {['submitted', 'approved'].includes(m.status) && <button disabled={busy} onClick={() => act('cancel', 'Заявката е отменена')}>Отмени</button>}
    </div>
  </Modal>;
}

export function Warehouse() {
  const [tab, setTab, focus] = useLinkTab('stock');
  const [moveOpen, setMoveOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const stock = useLoad<any[]>('/warehouse/stock');
  const requests = useLoad<any[]>('/material-requests');
  const reservations = useLoad<any[]>('/warehouse/reservations?status=active');
  const movements = useLoad<any[]>('/warehouse/movements');
  const fleet = useLoad<any[]>(tab === 'fleet' ? '/warehouse/fleet' : null);
  const projects = useLoad<any[]>('/projects');
  const reloadAll = () => { stock.reload(); requests.reload(); reservations.reload(); movements.reload(); };
  const low = (stock.data || []).filter(s => s.low).length;
  return <>
    <div className="page-head"><h1>Склад</h1><span className="spacer" />
      {tab === 'stock' && <button className="primary" onClick={() => setMoveOpen(true)}>Ново движение</button>}
      {tab === 'requests' && <button className="primary" onClick={() => setReqOpen(true)}>Нова заявка</button>}
      <button className="sm" onClick={reloadAll}>Обнови</button></div>
    <Tabs tabs={[['stock', `Склад (${(stock.data || []).length})`], ['requests', `Заявки (${(requests.data || []).length})`],
      ['reservations', `Резервации (${(reservations.data || []).length})`], ['movements', 'Движения'], ['fleet', 'Машини и инструменти']]} value={tab} onChange={setTab} />
    {tab === 'stock' && <Card pad={false}><Loader state={stock}>
      {low > 0 && <div className="alert" style={{ margin: 10 }}>Под минимален запас: {low} продукта.</div>}
      <Table rows={stock.data || []} empty={<Empty title="Няма продукти" />} cols={[
        { key: 'code', title: 'Код' }, { key: 'name', title: 'Продукт' }, { key: 'unit', title: 'Мярка', width: 80 },
        { key: 'on_hand', title: 'На склад', num: true, render: r => fmtNum(r.on_hand) }, { key: 'reserved', title: 'Резервирано', num: true, render: r => fmtNum(r.reserved) },
        { key: 'free', title: 'Свободно', num: true, render: r => <b>{fmtNum(r.free)}</b> }, { key: 'min_stock', title: 'Мин. запас', num: true, render: r => fmtNum(r.min_stock) },
        { key: 'low', title: '', render: r => r.low ? <span className="badge bad">нисък</span> : null }]} />
    </Loader></Card>}
    {tab === 'requests' && <Card pad={false}><Loader state={requests}>
      <Table focus={tab === 'requests' ? focus : null} rows={requests.data || []} onRow={r => setDetail(r.id)} empty={<Empty title="Няма заявки" />} cols={[
        { key: 'code', title: '№' }, { key: 'project_code', title: 'Обект' }, { key: 'origin', title: 'От', render: r => r.origin === 'technical' ? 'Технически' : r.origin === 'contracts' ? 'Договори' : 'Склад' },
        { key: 'status', title: 'Статус', render: r => <Status value={MR_STATUS[r.status]} /> },
        { key: 'needed_by', title: 'Нужни до', render: r => fmtDate(r.needed_by) }, { key: 'requester_name', title: 'Заявил' },
        { key: 'items', title: 'Позиции', render: r => (r.items || []).length }, { key: 'note', title: 'Бележка', render: r => <span className="muted">{String(r.note || '').slice(0, 60)}</span> }]} />
    </Loader></Card>}
    {tab === 'reservations' && <Card pad={false}><Loader state={reservations}>
      <Table rows={reservations.data || []} empty={<Empty title="Няма активни резервации" />} cols={[
        { key: 'product_code', title: 'Продукт' }, { key: 'project_code', title: 'Обект' }, { key: 'qty', title: 'Количество', num: true, render: r => fmtNum(r.qty) },
        { key: 'requester_name', title: 'По заявка на' }, { key: 'created_at', title: 'От', render: r => fmtDate(r.created_at) }]} />
    </Loader></Card>}
    {tab === 'movements' && <Card pad={false}><Loader state={movements}>
      <Table rows={movements.data || []} empty={<Empty title="Няма движения" />} cols={[
        { key: 'id', title: '#', width: 50 }, { key: 'created_at', title: 'Кога', render: r => fmtDateTime(r.created_at) },
        { key: 'product_code', title: 'Продукт' }, { key: 'kind', title: 'Вид', render: r => KIND_LABEL[r.kind] || r.kind },
        { key: 'qty', title: 'Количество', num: true, render: r => fmtNum(r.qty) }, { key: 'project_code', title: 'Обект' },
        { key: 'project_line_code', title: 'СМР', render: r => r.project_line_code || '—' },
        { key: 'to_project_code', title: 'Пренос', render: r => !r.to_project_code ? '—' :
            r.kind === 'transfer_out' ? `→ ${r.to_project_code}` : `← ${r.to_project_code}` },
        { key: 'document_ref', title: 'Документ' }, { key: 'responsible_name', title: 'Отговорник' }, { key: 'note', title: 'Бележка', render: r => <span className="muted">{r.note || ''}</span> }]} />
    </Loader></Card>}
    {tab === 'fleet' && <Card pad={false}><Loader state={fleet}>
      <Table rows={fleet.data || []} empty={<Empty title="Няма регистрирани машини и инструменти" />} cols={[
        { key: 'code', title: 'Код' }, { key: 'name', title: 'Наименование' }, { key: 'kind', title: 'Вид' },
        { key: 'plate', title: 'Рег. №', render: r => r.plate || '—' }, { key: 'location', title: 'Локация', render: r => r.location || '—' },
        { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> },
        { key: 'allocated_project', title: 'На обект', render: r => r.allocated_project || <span className="muted">— свободен —</span> }]} />
    </Loader></Card>}
    {moveOpen && <MovementModal products={stock.data || []} projects={projects.data || []} onClose={() => setMoveOpen(false)} onDone={reloadAll} />}
    {reqOpen && <RequestModal projects={projects.data || []} onClose={() => setReqOpen(false)} onDone={reloadAll} />}
    {detail && <RequestDetail id={detail} onClose={() => setDetail(null)} onDone={reloadAll} />}
  </>;
}
