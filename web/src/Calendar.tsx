// т.4, 5, 10, 14: „Календар на договора" — един изглед за „Договор и приложения", „Разплащателен график" и „Финанси".
// Данните идват от /api/projects/:id/calendar (един източник). Месеци и дни отгоре; по един ред за Договор, Плащания,
// Доставки, Дейности. Етикетите не се застъпват: всеки ляга в първия подред на своя ред, в който има място (т.10);
// „днес" е в собствена лента над датите, не върху етикетите. Всяка точка отваря записа си.
import React from 'react';
import { fmtMoney } from './api';
import { Card, navigate, useLoad } from './ui';

type Item = { id: string; kind: 'point' | 'range' | 'undated'; date?: string; start?: string; end?: string; label: string; sub?: string | null; amount?: number | null; state: string; link?: string; extra?: boolean };
type Lane = { key: string; title: string; items: Item[] };

const DAY = 86400000;
const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const LEFT = 96, PAD_R = 12, TOP = 58, MARK_Y = 12, ROW_H = 36, LABEL_GAP = 10;
const t = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`; // the year is in the month header

let ctx: CanvasRenderingContext2D | null = null;
function textWidth(s: string, font: string) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return s.length * 7;
  ctx.font = font;
  return ctx.measureText(s).width;
}

/** Greedy lanes: each label takes the first sub-row where it fits — at its own place, or slid right by at most
 *  MAX_SHIFT (a leader line then bends back to its mark); otherwise a new sub-row. Labels never touch. */
const MAX_SHIFT = 150;
function pack(boxes: { left: number; right: number }[], limit: number) {
  const ends: number[] = [];
  return boxes.map(b => {
    const w = b.right - b.left;
    for (let r = 0; r < ends.length; r++) {
      const left = Math.max(b.left, ends[r] + LABEL_GAP);
      if (left - b.left <= MAX_SHIFT && left + w <= limit) { ends[r] = left + w; return { row: r, left }; }
    }
    ends.push(b.right);
    return { row: ends.length - 1, left: b.left };
  });
}

export function ContractCalendar({ pid, lanes: only, title = 'Календар на договора', bare = false, reload }: { pid: number; lanes?: string[]; title?: string; bare?: boolean; reload?: unknown }) {
  const cal = useLoad<{ today: string; lanes: Lane[] }>(`/projects/${pid}/calendar`, [pid, reload]);
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(900);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setW(Math.max(420, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const lanes = (cal.data?.lanes || []).filter(l => !only || only.includes(l.key));
  const today = cal.data?.today;
  const dated = lanes.flatMap(l => l.items.filter(i => i.kind !== 'undated'));
  const body = (() => {
    if (cal.loading && !cal.data) return <div className="muted small">Зареждане…</div>;
    if (cal.error) return <div className="alert bad">{cal.error}</div>;
    if (!dated.length) return <div className="muted small">Още няма дати за календара — те идват с подписването, плащанията, сроковете в дни, доставките и линейния график.</div>;

    const times = dated.flatMap(i => i.kind === 'range' ? [t(i.start!), t(i.end!)] : [t(i.date!)]).concat(today ? [t(today)] : []);
    const span0 = Math.min(...times), span1 = Math.max(...times);
    const padDays = Math.max(3, Math.round((span1 - span0) / DAY * 0.04));
    const t0 = span0 - padDays * DAY, t1 = span1 + padDays * DAY;
    const W = w - LEFT - PAD_R, perDay = W / ((t1 - t0) / DAY);
    const X = (ms: number) => LEFT + (ms - t0) / DAY * perDay;

    // axis: month boundaries and day ticks thinned so numbers never touch (≥ 26 px apart)
    const months: { x: number; label: string }[] = [];
    const firstMonth = new Date(t0); firstMonth.setUTCDate(1);
    for (let m = new Date(firstMonth); m.getTime() <= t1; m.setUTCMonth(m.getUTCMonth() + 1))
      months.push({ x: Math.max(LEFT, X(m.getTime())), label: `${MONTHS[m.getUTCMonth()]} ${m.getUTCFullYear()}` });
    // a month whose name does not fit before the next one keeps its line but not its name (no overlapping month names)
    const monthFont = '600 11.5px Inter, "Segoe UI", system-ui, sans-serif';
    months.forEach((m, k) => { const next = months[k + 1]; if (next && m.x + textWidth(m.label, monthFont) + 12 > next.x) m.label = ''; });
    const step = [1, 2, 3, 7, 14, 30].find(s => s * perDay >= 26) || 30;
    const ticks: { x: number; d: number }[] = [];
    for (let ms = Math.ceil(t0 / DAY) * DAY; ms <= t1; ms += DAY) {
      const d = new Date(ms).getUTCDate();
      if (step === 1 || (step === 7 ? new Date(ms).getUTCDay() === 1 : step === 30 ? d === 1 : (d - 1) % step === 0)) ticks.push({ x: X(ms), d });
    }

    const font = '600 12px Inter, "Segoe UI", system-ui, sans-serif', fontSub = '11px Inter, "Segoe UI", system-ui, sans-serif';
    const laid = lanes.map(l => {
      const items = l.items.filter(i => i.kind !== 'undated').map(i => {
        const a = X(t(i.kind === 'range' ? i.start! : i.date!)), b = i.kind === 'range' ? X(t(i.end!)) + perDay : a;
        const subLine = [i.kind === 'range' ? `${short(i.start!)}–${short(i.end!)}` : short(i.date!), i.sub, i.amount != null ? fmtMoney(i.amount) : null].filter(Boolean).join(' · ');
        const bw = Math.max(textWidth(i.label, font), textWidth(subLine, fontSub)) + 6;
        // a point's label is centred on it, a range's starts with it; both stay inside the track
        let left = i.kind === 'range' ? a : a - bw / 2;
        left = Math.min(Math.max(left, LEFT), LEFT + W - bw);
        return { i, a, b, subLine, left, right: left + bw };
      }).sort((p, q) => p.left - q.left);
      const placed = pack(items, LEFT + W);
      const nRows = Math.max(1, ...placed.map(p => p.row + 1));
      return { l, items: items.map((it, k) => ({ ...it, row: placed[k].row, right: placed[k].left + (it.right - it.left), left: placed[k].left })), h: 22 + nRows * ROW_H, undated: l.items.filter(i => i.kind === 'undated') };
    });
    const height = TOP + laid.reduce((s, x) => s + x.h, 0);
    const xt = today ? X(t(today)) : null;
    let y = TOP;

    return <div className="cal" style={{ height }}>
      {/* „днес" — its own band above the dates, so it never sits on a label */}
      {xt != null && <div className="cal-today-tag" style={{ left: Math.min(Math.max(xt, LEFT + 30), LEFT + W - 30) }}>днес · {short(today!)}</div>}
      {months.map((m, k) => <div key={k} className="cal-month" style={{ left: m.x, height: height - 18 }}><span>{m.label}</span></div>)}
      {ticks.map((k, n) => <div key={n} className="cal-tick" style={{ left: k.x }}>{k.d}</div>)}
      {xt != null && <div className="cal-today" style={{ left: xt, top: 18, height: height - 18 }} />}
      {laid.map(({ l, items, h, undated }) => {
        const top = y; y += h;
        return <div key={l.key} className="cal-lane" style={{ top, height: h }}>
          <div className="cal-lane-title">{l.title}{undated.length > 0 && <div className="faint small" title={undated.map(u => `${u.label}: ${u.sub || 'без дата'}`).join('\n')}>+{undated.length} без дата</div>}</div>
          {items.filter(x => x.i.kind === 'range').map(x => <div key={'b' + x.i.id} className={`cal-bar ${x.i.state}${x.i.extra ? ' extra' : ''}`} style={{ left: x.a, width: Math.max(4, x.b - x.a), top: MARK_Y - 3 }} />)}
          {items.filter(x => x.i.kind === 'point').map(x => <div key={'m' + x.i.id} className={`cal-mark ${l.key === 'payments' ? 'pay ' : ''}${x.i.state}`} style={{ left: x.a, top: MARK_Y }} />)}
          {items.map(x => {
            const ly = 22 + x.row * ROW_H;
            return <React.Fragment key={x.i.id}>
              <div className="cal-leader" style={{ left: x.a, top: MARK_Y + 7, height: ly + 7 - MARK_Y - 7 }} />
              {x.left > x.a + 2 && <div className="cal-leader-h" style={{ left: x.a, top: ly + 7, width: x.left - x.a }} />}
              <button type="button" className={`cal-label ${x.i.state}`} style={{ left: x.left, top: ly, width: x.right - x.left }} title={`${x.i.label} — ${x.subLine}`}
                onClick={() => x.i.link && navigate(x.i.link)}>
                <b>{x.i.label}</b><span>{x.subLine}</span>
              </button>
            </React.Fragment>;
          })}
        </div>;
      })}
    </div>;
  })();

  const undatedAll = lanes.flatMap(l => l.items.filter(i => i.kind === 'undated').map(i => ({ ...i, lane: l.title })));
  const legend = <div className="cal-legend small muted">
    <span><i className="cal-dot done" /> готово / платено</span><span><i className="cal-dot pending" /> предстои</span><span><i className="cal-dot active" /> тече</span><span><i className="cal-dot late" /> просрочено</span>
    {undatedAll.length > 0 && <span>Без дата: {undatedAll.map(u => `${u.label}${u.sub && u.sub !== 'без дата' ? ` (${u.sub})` : ''}`).join(', ')}</span>}
  </div>;
  const content = <div ref={ref} className="cal-wrap">{body}{dated.length > 0 && legend}</div>;
  return bare ? content : <Card title={title}>{content}</Card>;
}
