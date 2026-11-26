// Линеен календарен график като във файла на фирмата: № | Дейност | Ед.м. | Кол-во | ЧД | Дни | Начало | Край | Хора | дни с броя хора.
// Един изглед за Технически, картона на обекта и бригадира.
import React from 'react';
import { fmtDate, fmtNum } from './api';
import { Progress } from './ui';

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const MONTHS = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];

export function Gantt({ items, deadline, onEdit, maxDays = 240 }: { items: any[]; deadline?: string | null; onEdit?: (s: any) => void; maxDays?: number }) {
  const today = iso(Date.now());
  const dates = items.flatMap(s => [s.start_date, s.end_date, s.baseline_start, s.baseline_end]).filter(Boolean) as string[];
  if (deadline) dates.push(deadline);
  const lo = dates.length ? dates.reduce((a, b) => a < b ? a : b) : today;
  const hi = dates.length ? dates.reduce((a, b) => a > b ? a : b) : today;
  const n = Math.min(maxDays, Math.round((Date.parse(hi) - Date.parse(lo)) / DAY) + 1);
  const days = Array.from({ length: n }, (_, i) => iso(Date.parse(lo) + i * DAY));
  const months: { label: string; span: number }[] = [];
  for (const d of days) { const m = `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`; if (months.at(-1)?.label === m) months.at(-1)!.span++; else months.push({ label: m, span: 1 }); }
  const fmtW = (w: any) => w == null ? '' : Number(w) >= 10 ? Math.round(w) : fmtNum(w, 1);
  return <div className="gantt-x"><table className="gx">
    <thead>
      <tr><th rowSpan={2} className="c-no">№</th><th rowSpan={2} className="c-name">Етапи / Дейности</th><th rowSpan={2}>Ед. м.</th><th rowSpan={2}>Кол-во</th>
        <th rowSpan={2} title="Човекодни = количество × надници за единица от офертата">ЧД</th><th rowSpan={2}>Дни</th><th rowSpan={2}>Начало</th><th rowSpan={2}>Край</th>
        <th rowSpan={2} title="Хора на ден = ЧД / дни">Хора</th>
        {months.map((m, i) => <th key={i} colSpan={m.span} className="c-month">{m.label}</th>)}{onEdit && <th rowSpan={2} />}</tr>
      <tr>{days.map(d => { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); return <th key={d} className={'c-day' + (wd === 0 || wd === 6 ? ' we' : '') + (d === today ? ' today' : '')}>{Number(d.slice(8))}</th>; })}</tr>
    </thead>
    <tbody>{items.map((s, i) => {
      const late = s.late_days > 0, behind = !late && s.behind;
      return <tr key={s.id} className={s.outside_contract ? 'outside' : ''}>
        <td className="c-no muted">{i + 1}</td>
        <td className="c-name"><div>{s.name}</div>
          <div className="small">
            {s.outside_contract ? <span className={'badge ' + (s.amendment_status === 'approved' ? 'ok' : s.amendment_status === 'rejected' ? 'bad' : 'warn')}>извън договора{s.amendment_code ? ` · ${s.amendment_code}` : ''}{s.amendment_status === 'pending' ? ' · чака одобрение' : ''}</span> : null}
            {late ? <span className="badge bad">закъснение {s.late_days} дн.</span> : behind ? <span className="badge warn">изостава</span> : null}
            {s.slip_days > 0 ? <span className="muted"> изместване +{s.slip_days} дн.</span> : null}
          </div>
          {s.pct != null ? <div className="row" style={{ flexWrap: 'nowrap', marginTop: 2 }}><Progress pct={s.pct} tone={late ? 'bad' : behind ? 'warn' : undefined} /><span className="small num">{s.pct}%</span></div> : null}
          {s.note ? <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{s.note}</div> : null}</td>
        <td>{s.unit || ''}</td><td className="num">{s.qty != null ? fmtNum(s.qty, 2) : ''}</td><td className="num">{s.man_days != null ? fmtNum(s.man_days, 1) : ''}</td>
        <td className="num">{s.duration_days ?? ''}</td><td className="nowrap small">{fmtDate(s.start_date)}</td><td className="nowrap small">{fmtDate(s.end_date)}</td>
        <td className="num">{fmtW(s.workers)}</td>
        {days.map(d => {
          const on = s.start_date && s.end_date && d >= s.start_date && d <= s.end_date;
          const base = s.baseline_start && s.baseline_end && d >= s.baseline_start && d <= s.baseline_end;
          return <td key={d} className={'c-cell' + (on ? (late ? ' on late' : behind ? ' on behind' : ' on') : '') + (base && !on ? ' base' : '') + (d === today ? ' today' : '') + (deadline && d === deadline ? ' deadline' : '')}
            title={on ? `${fmtDate(d)} · ${fmtW(s.workers) || '—'} души${s.qty_per_day != null ? ` · ${fmtNum(s.qty_per_day, 2)} ${s.unit || ''}/ден` : ''}` : undefined}>{on ? fmtW(s.workers) : ''}</td>;
        })}
        {onEdit && <td><button className="ghost sm" onClick={() => onEdit(s)}>✎</button></td>}
      </tr>;
    })}</tbody>
  </table>
  <div className="small muted" style={{ padding: '6px 8px' }}>В клетките: хора на ден · светло = първоначален план · <span className="gx-key late" /> закъснение · <span className="gx-key outside" /> извън договора · червена линия = краен срок · синя = днес</div>
  </div>;
}
