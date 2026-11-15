// "Труд" tab of the offer editor — the company's labour sheet. Same arithmetic as server/labour.js.
import React from 'react';
import { labourCalc, DEFAULT_LABOUR } from '../../../server/labour.js';
import { Card, Empty, Field } from '../ui';
import { fmtMoney, fmtNum } from '../api';

const clone = (x: any) => JSON.parse(JSON.stringify(x));

export function LabourTab({ labour, setLabour, onApply }: { labour: any; setLabour: (l: any) => void; onApply: (perUnit: number, dayRate: number, unit: string, name: string) => void }) {
  const c = labour && labour.activities ? labour : null;
  if (!c) return <Empty title="Няма калкулация за труд">Добавете калкулацията по-долу.</Empty>;
  const r = labourCalc(c);
  const set = (k: string, v: any) => setLabour({ ...c, [k]: v });
  const setA = (i: number, k: string, v: any) => setLabour({ ...c, activities: c.activities.map((a: any, j: number) => j === i ? { ...a, [k]: v } : a) });
  const setV = (i: number, k: string, v: any) => setLabour({ ...c, vehicles: c.vehicles.map((a: any, j: number) => j === i ? { ...a, [k]: v } : a) });
  const N = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const inp = (val: any, cb: (v: any) => void, w = 74, step = '0.1') => <input className="cell-input num" style={{ width: w }} type="number" step={step} value={val ?? ''} onChange={e => cb(e.target.value === '' ? '' : Number(e.target.value))} />;
  return <>
    <div className="grid g3" style={{ marginBottom: 12 }}>
      <Card title="Разходи за изпълнение" pad={false}><div className="table-wrap"><table className="t"><tbody>
        <tr><td>Надници: {fmtNum(r.man_days, 1)} човекодни × дневна ставка {fmtNum(r.man_days ? r.wages / r.man_days : 0, 0)} €</td><td className="num">{fmtMoney(r.wages)}</td></tr>
        <tr><td>Гориво</td><td className="num">{fmtMoney(r.fuel)}</td></tr>
        <tr><td>Нощувки: {fmtNum(r.nights, 0)} × {fmtMoney(N(c.night_price), '€')}</td><td className="num">{fmtMoney(r.nights_cost)}</td></tr>
        <tr><td>Механизация</td><td className="num" style={{ width: 110 }}>{inp(c.mechanisation, v => set('mechanisation', v), 96)}</td></tr>
        <tr><td>Други СМР</td><td className="num">{inp(c.other_smr, v => set('other_smr', v), 96)}</td></tr>
        <tr><td>Други разходи</td><td className="num">{inp(c.other, v => set('other', v), 96)}</td></tr>
        <tr><td><b>Общо разходи за труд</b></td><td className="num"><b>{fmtMoney(r.total)}</b></td></tr>
        <tr><td><b>Единична цена за човек на ден</b></td><td className="num"><b>{r.day_rate != null ? fmtMoney(r.day_rate) : '—'}</b></td></tr>
      </tbody></table></div></Card>
      <Card title="Параметри" pad={false}><div className="table-wrap"><table className="t"><tbody>
        <tr><td>Дневна ставка на човек (€)</td><td className="num">{inp(c.wage, v => set('wage', v), 90)}</td></tr>
        <tr><td>Цена на нощувка (€)</td><td className="num">{inp(c.night_price, v => set('night_price', v), 90)}</td></tr>
        <tr><td>Фактор гориво (от файла: 1.05)</td><td className="num">{inp(c.fuel_factor, v => set('fuel_factor', v), 90, '0.01')}</td></tr>
        <tr><td className="muted">Трудовите редове без „надница“ (мобилизация / демобилизация) влизат в работните дни, но не и в надниците — както във файла.</td><td></td></tr>
      </tbody></table></div></Card>
      <Card title="Превозни средства (гориво)" pad={false}><div className="table-wrap"><table className="t"><thead><tr><th>Автомобил</th><th className="num">л/100км</th><th className="num">км в двете посоки</th><th className="num">Отивания</th><th className="num">Сума</th><th /></tr></thead>
        <tbody>{c.vehicles.map((v: any, i: number) => <tr key={i}>
          <td><input className="cell-input" value={v.name} onChange={e => setV(i, 'name', e.target.value)} /></td>
          <td className="num">{inp(v.consumption, x => setV(i, 'consumption', x), 66)}</td>
          <td className="num">{inp(v.distance, x => setV(i, 'distance', x), 90)}</td>
          <td className="num">{inp(v.trips, x => setV(i, 'trips', x), 60, '1')}</td>
          <td className="num">{fmtMoney(r.vehicles[i]?.cost)}</td>
          <td><button className="ghost sm" aria-label="Изтрий" onClick={() => set('vehicles', c.vehicles.filter((_: any, j: number) => j !== i))}>✕</button></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={6}><button className="sm" onClick={() => set('vehicles', [...c.vehicles, { name: '', consumption: 12, distance: 0, trips: 1 }])}>+ Автомобил</button></td></tr></tfoot></table></div></Card>
    </div>
    <Card title="Дейности (като в листа „Труд“)" pad={false}>
      <div className="table-wrap"><table className="t"><thead><tr><th>Дейност</th><th>Мярка</th><th className="num">Количество</th><th className="num">Брой работници</th><th className="num">Брой работни дни</th><th className="num">Нощувки</th><th className="num">Надници (Σ)</th><th className="num">Надници / ед.</th><th>В надници</th><th>Приложи</th><th /></tr></thead>
        <tbody>{c.activities.map((a: any, i: number) => { const pu = r.activities[i]?.per_unit; return <tr key={i}>
          <td><input className="cell-input" style={{ minWidth: 130 }} value={a.name} onChange={e => setA(i, 'name', e.target.value)} /></td>
          <td><input className="cell-input" style={{ width: 64 }} value={a.unit} onChange={e => setA(i, 'unit', e.target.value)} /></td>
          <td className="num">{inp(a.qty, v => setA(i, 'qty', v), 90, '0.01')}</td>
          <td className="num">{inp(a.workers, v => setA(i, 'workers', v), 60, '0.5')}</td>
          <td className="num">{inp(a.days, v => setA(i, 'days', v), 60, '0.5')}</td>
          <td className="num">{inp(a.nights, v => setA(i, 'nights', v), 60, '1')}</td>
          <td className="num">{fmtNum(r.activities[i]?.man_days, 2)}</td>
          <td className="num"><b>{r.activities[i]?.per_unit != null ? fmtNum(r.activities[i].per_unit, 4) : '—'}</b></td>
          <td><input type="checkbox" checked={a.inWages !== false} onChange={e => setA(i, 'inWages', e.target.checked)} /></td>
          <td>{pu != null && r.day_rate != null && <button className="sm" onClick={() => onApply(pu, r.day_rate as number, a.unit, a.name)}>→ редове с „{a.unit}“</button>}</td>
          <td><button className="ghost sm" aria-label="Изтрий" onClick={() => set('activities', c.activities.filter((_: any, j: number) => j !== i))}>✕</button></td></tr>; })}</tbody>
        <tfoot><tr><td colSpan={11}><button className="sm" onClick={() => set('activities', [...c.activities, { name: '', unit: 'м²', qty: 0, workers: 0, days: 0, nights: 0, inWages: true }])}>+ Дейност</button>
          <button className="sm" style={{ marginLeft: 8 }} onClick={() => setLabour(clone(DEFAULT_LABOUR))}>Нулирай към шаблона</button></td></tr></tfoot></table></div>
      <div className="body muted small">„Приложи“ записва надници/ед. и стойност на надника във всички редове със същата мярка (освен ако редът не е с ръчна „Монтаж/ед.“). Промените се записват с бутона „Запис“.</div>
    </Card>
  </>;
}