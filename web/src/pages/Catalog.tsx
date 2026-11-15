import React, { useEffect, useState } from 'react';
import { api, fmtMoney, fmtNum } from '../api';
import { Card, Empty, Field, Loader, Modal, Table, Tabs, useAction, useCan, useFilter, useForm, useLoad } from '../ui';

const KINDS: Record<string, string> = { material: 'Материал', product: 'Продукт', consumable: 'Консуматив' };

function ProductForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ code: '', name: '', kind: 'material', unit: '', unit_cost: 0, unit_price: 0, min_stock: 0, pallet_qty: '', description: '', ...(initial || {}) });
  const { run, busy } = useAction();
  const save = () => run(async () => { initial?.id ? await api.patch(`/products/${initial.id}`, f.v) : await api.post('/products', f.v); onSaved(); onClose(); }, 'Записано');
  return <Modal title={initial?.id ? `Продукт ${initial.code}` : 'Нов продукт / материал'} onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy} onClick={save}>Запис</button></>}>
    <div className="form c3">
      <Field label="Код"><input {...f.bind('code')} disabled={!!initial?.id} autoFocus /></Field>
      <Field label="Вид"><select {...f.bind('kind')}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Мярка"><input {...f.bind('unit')} placeholder="м2, кг, бр." /></Field>
      <Field label="Име" full><input {...f.bind('name')} /></Field>
      <Field label="Себестойност / ед."><input type="number" step="0.01" min="0" {...f.bind('unit_cost')} /></Field>
      <Field label="Продажна цена / ед."><input type="number" step="0.01" min="0" {...f.bind('unit_price')} /></Field>
      <Field label="Мин. наличност"><input type="number" step="0.01" min="0" {...f.bind('min_stock')} /></Field>
      <Field label="Количество на палет"><input type="number" step="0.01" min="0" {...f.bind('pallet_qty')} /></Field>
      <Field label="Техническо описание" full><textarea {...f.bind('description')} /></Field>
    </div>
  </Modal>;
}

function SmrForm({ initial, products, onClose, onSaved }: { initial?: any; products: any[]; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ code: '', name: '', unit: '', labour_norm_h: 0, description: '', ...(initial || {}) });
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { if (initial?.id) api.get(`/smr-types/${initial.id}/recipe`).then(setItems).catch(() => {}); }, [initial?.id]);
  const { run, busy } = useAction();
  const save = () => run(async () => {
    const s = initial?.id ? await api.patch(`/smr-types/${initial.id}`, f.v) : await api.post('/smr-types', f.v);
    await api.put(`/smr-types/${s.id}/recipe`, { items: items.filter(i => i.product_id) });
    onSaved(); onClose();
  }, 'Записано');
  const upd = (i: number, k: string, v: any) => setItems(x => x.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const cost = items.reduce((s, i) => s + (products.find(p => p.id === Number(i.product_id))?.unit_cost || 0) * Number(i.norm_per_unit || 0) * (1 + Number(i.waste_pct || 0) / 100), 0);
  return <Modal wide title={initial?.id ? `СМР ${initial.code}` : 'Нова СМР операция'} onClose={onClose}
    footer={<><button onClick={onClose}>Отказ</button><button className="primary" disabled={busy} onClick={save}>Запис</button></>}>
    <div className="form c3">
      <Field label="Код"><input {...f.bind('code')} disabled={!!initial?.id} autoFocus /></Field>
      <Field label="Мярка"><input {...f.bind('unit')} placeholder="м2, м, бр." /></Field>
      <Field label="Труд, ч. / ед."><input type="number" step="0.01" min="0" {...f.bind('labour_norm_h')} /></Field>
      <Field label="Наименование" full><input {...f.bind('name')} /></Field>
      <Field label="Логика на изпълнение / описание" full><textarea {...f.bind('description')} /></Field>
    </div>
    <h3 style={{ marginTop: 16 }}>Рецепта — разходна норма за 1 {f.v.unit || 'ед.'}</h3>
    <div className="table-wrap"><table className="t"><thead><tr><th>Материал</th><th className="num" style={{ width: 130 }}>Норма / ед.</th><th className="num" style={{ width: 110 }}>Фира %</th><th style={{ width: 40 }} /></tr></thead>
      <tbody>{items.map((it, i) => <tr key={i}>
        <td><select className="cell-input" value={it.product_id || ''} onChange={e => upd(i, 'product_id', Number(e.target.value))}><option value="">— изберете —</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name} ({p.unit})</option>)}</select></td>
        <td><input className="cell-input num" type="number" step="0.0001" min="0" value={it.norm_per_unit ?? ''} onChange={e => upd(i, 'norm_per_unit', e.target.value)} /></td>
        <td><input className="cell-input num" type="number" step="0.1" min="0" value={it.waste_pct ?? 0} onChange={e => upd(i, 'waste_pct', e.target.value)} /></td>
        <td><button className="ghost sm" onClick={() => setItems(x => x.filter((_, j) => j !== i))} aria-label="Премахни">✕</button></td></tr>)}</tbody>
      <tfoot><tr><td><button className="sm" onClick={() => setItems(x => [...x, { product_id: '', norm_per_unit: 1, waste_pct: 0 }])} disabled={!products.length}>+ Материал</button>
        {!products.length && <span className="muted small"> Първо добавете материали.</span>}</td><td colSpan={3} className="num">Материали за 1 ед.: {fmtMoney(cost)}</td></tr></tfoot></table></div>
  </Modal>;
}

export function Catalog() {
  const can = useCan();
  const [tab, setTab] = useState('products');
  const [q, setQ] = useState('');
  const products = useLoad<any[]>('/products');
  const smr = useLoad<any[]>('/smr-types');
  const [edit, setEdit] = useState<any | null>(null);
  const write = can('catalog', 'write');
  const pRows = useFilter(products.data, q, r => [r.code, r.name, r.description].join(' '));
  const sRows = useFilter(smr.data, q, r => [r.code, r.name, r.description].join(' '));
  return <>
    <div className="page-head"><h1>Номенклатури</h1><span className="spacer" />
      <input style={{ maxWidth: 260 }} placeholder="Филтър" value={q} onChange={e => setQ(e.target.value)} />
      {write && <button className="primary" onClick={() => setEdit({ _new: tab })}>{tab === 'products' ? 'Нов продукт' : 'Нова СМР операция'}</button>}</div>
    <Tabs tabs={[['products', 'Продукти и материали'], ['smr', 'СМР операции и рецепти']]} value={tab} onChange={setTab} />
    <Card pad={false}>
      {tab === 'products' ? <Loader state={products}><Table rows={pRows} onRow={write ? r => setEdit({ ...r, _new: 'products' }) : undefined}
        empty={<Empty title="Няма продукти">Добавете материали и продукти с код, мярка и цени. Те се използват в оферти, рецепти и склад.</Empty>} cols={[
          { key: 'code', title: 'Код', width: 110 }, { key: 'name', title: 'Име' }, { key: 'kind', title: 'Вид', render: r => KINDS[r.kind] || r.kind }, { key: 'unit', title: 'Мярка' },
          { key: 'unit_cost', title: 'Себестойност', num: true, render: r => fmtMoney(r.unit_cost) }, { key: 'unit_price', title: 'Цена', num: true, render: r => fmtMoney(r.unit_price) },
          { key: 'min_stock', title: 'Мин. наличност', num: true, render: r => fmtNum(r.min_stock) }]} /></Loader>
        : <Loader state={smr}><Table rows={sRows} onRow={write ? r => setEdit({ ...r, _new: 'smr' }) : undefined}
          empty={<Empty title="Няма СМР операции">Опишете строително-монтажните операции и техните рецепти (разходни норми).</Empty>} cols={[
            { key: 'code', title: 'Код', width: 110 }, { key: 'name', title: 'Наименование' }, { key: 'unit', title: 'Мярка' },
            { key: 'labour_norm_h', title: 'Труд ч./ед.', num: true, render: r => fmtNum(r.labour_norm_h) }, { key: 'description', title: 'Описание' }]} /></Loader>}
    </Card>
    {edit?._new === 'products' && <ProductForm initial={edit.id ? edit : undefined} onClose={() => setEdit(null)} onSaved={products.reload} />}
    {edit?._new === 'smr' && <SmrForm initial={edit.id ? edit : undefined} products={products.data || []} onClose={() => setEdit(null)} onSaved={smr.reload} />}
  </>;
}