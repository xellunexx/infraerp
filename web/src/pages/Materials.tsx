// Материали и консумативи по ред — един редактор за офертата и за обекта (КС).
import React from 'react';
import { api } from '../api';

export type Mat = { product_id: number | string; norm_per_unit: number | string; waste_pct?: number | string; note?: string | null };
const N = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const q3 = (n: number) => new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 3 }).format(n);

/** Editable list of materials for one line. qty/unit: the line's quantity, to show the total needed. */
export function MaterialsEditor({ items, onChange, products, qty, unit, editable, smrTypeId }: {
  items: Mat[]; onChange: (m: Mat[]) => void; products: any[]; qty: number; unit: string; editable: boolean; smrTypeId?: number | null;
}) {
  const set = (i: number, k: keyof Mat, v: any) => onChange(items.map((m, j) => j === i ? { ...m, [k]: v } : m));
  const prod = (id: any) => products.find(p => String(p.id) === String(id));
  const fromRecipe = async () => {
    const r: any[] = await api.get(`/smr-types/${smrTypeId}/recipe`);
    const have = new Set(items.map(m => String(m.product_id)));
    onChange([...items, ...r.filter(x => !have.has(String(x.product_id))).map(x => ({ product_id: x.product_id, norm_per_unit: x.norm_per_unit, waste_pct: x.waste_pct, note: '' }))]);
  };
  return <div className="mats">
    {items.length ? <table className="t mats-t"><thead><tr><th>Материал / консуматив</th><th className="num">Норма за 1 {unit}</th><th className="num">Фира %</th><th className="num">Общо нужно</th><th>Бележка</th>{editable && <th />}</tr></thead>
      <tbody>{items.map((m, i) => { const p = prod(m.product_id); const total = N(qty) * N(m.norm_per_unit) * (1 + N(m.waste_pct) / 100);
        return <tr key={i}>
          <td>{editable ? <select value={m.product_id ?? ''} onChange={e => set(i, 'product_id', e.target.value)}><option value="">— избери —</option>
            {products.filter(x => x.active !== 0 || String(x.id) === String(m.product_id)).map(x => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name} ({x.unit})</option>)}</select>
            : <>{p ? `${p.code ? p.code + ' · ' : ''}${p.name}` : (m as any).name || '—'}</>}</td>
          <td className="num">{editable ? <input type="number" min="0" step="any" style={{ width: 90 }} value={m.norm_per_unit ?? ''} onChange={e => set(i, 'norm_per_unit', e.target.value)} /> : q3(N(m.norm_per_unit))} {p?.unit || (m as any).unit || ''}</td>
          <td className="num">{editable ? <input type="number" min="0" step="any" style={{ width: 60 }} value={m.waste_pct ?? ''} onChange={e => set(i, 'waste_pct', e.target.value)} /> : q3(N(m.waste_pct))}</td>
          <td className="num"><b>{q3(total)}</b> {p?.unit || (m as any).unit || ''}</td>
          <td>{editable ? <input value={m.note || ''} onChange={e => set(i, 'note', e.target.value)} placeholder="напр. цвят, размер" /> : m.note || ''}</td>
          {editable && <td><button className="ghost sm danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button></td>}</tr>; })}</tbody></table>
      : <div className="muted small">Няма зададени материали.</div>}
    {editable && <div className="row" style={{ marginTop: 6 }}>
      <button className="sm" onClick={() => onChange([...items, { product_id: '', norm_per_unit: '', waste_pct: 0, note: '' }])}>+ материал</button>
      {smrTypeId ? <button className="sm ghost" onClick={fromRecipe}>Вземи от рецептата на СМР</button> : null}</div>}
  </div>;
}

/** Only complete rows are sent. */
export const cleanMats = (items: Mat[]) => items.filter(m => m.product_id !== '' && m.product_id != null && N(m.norm_per_unit) > 0)
  .map(m => ({ product_id: Number(m.product_id), norm_per_unit: N(m.norm_per_unit), waste_pct: N(m.waste_pct), note: m.note || null }));
