// Offer editor — built to work like the company's Excel offer template.
// The "Оферта" tab IS the document: letterhead header, one grid per section,
// per-section totals, grand totals, legal clauses. The operator picks things
// (СМР, products, templates, labour results); every "Сума" cell is a live
// formula and stays read-only. Keyboard: Tab / arrows move, Enter moves down
// and adds a row from the last row.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDate, fmtMoney, fmtNum } from '../api';
import { Card, Field, Link, Loader, Modal, Status, Tabs, navigate, useAction, useAuth, useCan, useCurrency, useLoad } from '../ui';
import { LabourTab } from './LabourTab';
import { labourCalc, DEFAULT_LABOUR } from '../../../server/labour.js';

type Line = Record<string, any>;
type Section = { key: string; title: string; description: string; footer: string; alternative: boolean };
const N = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const filled = (v: any) => v !== null && v !== undefined && v !== '';

/** Same arithmetic as server/pricing.js (the server recomputes and stores the result on save).
 *  Per unit: O = material + delivery + labour; P = O*реж%; T = O*печ%; V = T*дан%; W = O+P+T+V; цена = ръчна ?? W; стойност = qty*цена. */
export function calcLine(l: Line) {
  const labour = filled(l.install_cost) ? N(l.install_cost) : N(l.labour_days) * N(l.day_rate);
  const direct = N(l.material_cost) + N(l.delivery_cost) + labour;
  const overhead = direct * N(l.overhead_pct) / 100, profit = direct * N(l.profit_pct) / 100, tax = profit * N(l.tax_pct) / 100;
  const calculated = r2(direct + overhead + profit + tax);
  const manual = filled(l.manual_price);
  const price = manual ? r2(N(l.manual_price)) : calculated;
  const qty = N(l.qty);
  return {
    labour, direct, overhead, profit, tax, calculated, manual, price,
    total: r2(qty * price), hasBreakdown: direct > 0,
    delivery_sum: r2(N(l.delivery_cost) * qty), labour_sum: r2(labour * qty), overhead_sum: r2(overhead * qty),
    cost_sum: r2((direct + overhead) * qty), profit_sum: r2(profit * qty), tax_sum: r2(tax * qty),
  };
}

/** What's wrong with a line, in plain words — shown as a marker and in the send preflight. */
function lineIssues(l: Line, c: ReturnType<typeof calcLine>): string[] {
  const out: string[] = [];
  if (!String(l.description || '').trim()) out.push('без описание');
  if (!(N(l.qty) > 0)) out.push('количество 0');
  if (!c.hasBreakdown && !filled(l.manual_price) && c.price <= 0) out.push('без цена — нито калкулация, нито ръчна');
  if (c.manual && c.hasBreakdown && c.calculated > 0 && (N(l.manual_price) < c.calculated * 0.5 || N(l.manual_price) > c.calculated * 2))
    out.push(`ръчната цена е далеч от изчислената (${fmtMoney(c.calculated)})`);
  return out;
}

/** Валидна до = offer date + N months (mirrors server validUntil / Excel EDATE). */
function validUntil(date: string, months: any): string {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00Z'); if (isNaN(+d)) return '';
  const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + Math.max(0, Math.round(N(months))));
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}

type Pick = { kind: 'smr' | 'prod'; it: any };
/** Description cell: type to search СМР and products; a pick fills description, unit and known costs. */
function DescCell({ l, r, smr, products, editable, onText, onPick }: {
  l: Line; r: number; smr: any[]; products: any[]; editable: boolean; onText: (v: string) => void; onPick: (p: Partial<Line>) => void;
}) {
  const [open, setOpen] = useState(false); const [hl, setHl] = useState(0);
  const q = String(l.description || '').trim().toLowerCase();
  const sug: Pick[] = useMemo(() => {
    if (!editable || q.length < 2) return [];
    const hit = (x: any) => (x.name || '').toLowerCase().includes(q) || (x.code || '').toLowerCase().includes(q);
    return [
      ...smr.filter(x => x.active !== 0 && hit(x)).slice(0, 5).map((it): Pick => ({ kind: 'smr', it })),
      ...products.filter(x => x.active !== 0 && hit(x)).slice(0, 5).map((it): Pick => ({ kind: 'prod', it })),
    ];
  }, [q, smr, products, editable]);
  const choose = (p: Pick) => {
    if (p.kind === 'smr') onPick({ smr_type_id: p.it.id, product_id: null, code: p.it.code, description: p.it.name, unit: p.it.unit, ...(N(p.it.labour_norm_h) > 0 ? { labour_days: r4(N(p.it.labour_norm_h) / 8) } : {}) });
    else onPick({ product_id: p.it.id, smr_type_id: null, code: p.it.code, description: p.it.name, unit: p.it.unit, ...(N(p.it.unit_cost) > 0 ? { material_cost: p.it.unit_cost } : {}) });
    setOpen(false);
  };
  const tag = l.smr_type_id ? `СМР · ${l.code || ''}` : l.product_id ? `МАТ · ${l.code || ''}` : null;
  return <div className="dpick">
    {editable ? <>
      <textarea data-g={`${r}:1`} rows={2} value={l.description || ''} placeholder="Описание — пишете, за да търси в СМР и материали…"
        title="Enter: следващ ред · Shift+Enter: нов ред в текста" onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)} onChange={e => { onText(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (open && sug.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHl(h => Math.min(h + 1, sug.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHl(h => Math.max(h - 1, 0)); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); choose(sug[Math.min(hl, sug.length - 1)]); return; }
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); // bubbles to the table nav → next row (Shift+Enter = newline)
        }} />
      {open && sug.length > 0 && <div className="dpick-list">
        {sug.map((s, i) => <div key={s.kind + s.it.id} className={'dpick-item' + (i === hl ? ' on' : '')} onMouseDown={e => { e.preventDefault(); choose(s); }} onMouseEnter={() => setHl(i)}>
          <span className={'dpick-kind ' + s.kind}>{s.kind === 'smr' ? 'СМР' : 'МАТ'}</span>
          <span className="dpick-main"><b>{s.it.code}</b> {s.it.name}</span>
          <span className="dpick-sub">{s.it.unit}{s.kind === 'prod' && N(s.it.unit_cost) ? ` · ${fmtMoney(N(s.it.unit_cost))}` : ''}{s.kind === 'smr' && N(s.it.labour_norm_h) ? ` · ${fmtNum(s.it.labour_norm_h, 2)}ч/ед` : ''}</span>
        </div>)}
      </div>}
      {tag && <span className="dpick-tag">{tag}</span>}
    </> : <span className="pre">{l.description}</span>}
  </div>;
}

/** One bordered sheet grid (a section or the loose lines). Internal "калкулация" columns only for finance users. */
function SheetGrid({ rows, editable, money, smr, products, setL, pickL, delL, addLine, vatPct }: {
  rows: { l: Line; i: number }[]; editable: boolean; money: boolean; smr: any[]; products: any[];
  setL: (i: number, k: string, v: any) => void; pickL: (i: number, p: Partial<Line>) => void; delL: (i: number) => void; addLine: () => void; vatPct: number;
}) {
  const ref = useRef<HTMLTableElement>(null);
  const inp = (r: number, i: number, k: string, c: number, w = 72, step = '0.01') =>
    <input data-g={`${r}:${c}`} className="num" style={{ width: w }} type="number" step={step} min="0" disabled={!editable} value={rows[r].l[k] ?? ''} onChange={e => setL(i, k, e.target.value)} />;
  const nav = (e: React.KeyboardEvent) => {
    if (!editable) return;
    const el = e.target as HTMLElement;
    const g = (el as HTMLInputElement).dataset?.g; if (!g) return;
    const [r, c] = g.split(':').map(Number);
    let to: [number, number] | null = null;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); to = [r + 1, c]; }
    else if (e.key === 'ArrowDown' && el.tagName !== 'TEXTAREA') { e.preventDefault(); to = [r + 1, c]; }
    else if (e.key === 'ArrowUp' && el.tagName !== 'TEXTAREA') { e.preventDefault(); to = [r - 1, c]; }
    if (!to) return;
    const next = ref.current?.querySelector<HTMLElement>(`[data-g="${to[0]}:${to[1]}"]`);
    if (next) { next.focus(); (next as HTMLInputElement).select?.(); }
    else if (to[0] >= rows.length && to[0] > 0 && e.key === 'Enter') {
      addLine();
      setTimeout(() => { const n2 = ref.current?.querySelector<HTMLElement>(`[data-g="${to[0]}:${to[1]}"]`); n2?.focus(); (n2 as HTMLInputElement)?.select?.(); }, 0);
    }
  };
  const CC = 18; // internal column count
  const t = rows.reduce((s, x) => s + calcLine(x.l).total, 0);
  return <div className="table-wrap sheet-wrap"><table className="sheet" ref={ref} onKeyDown={nav}>
    <thead>
      {money && <tr className="grp"><th colSpan={6}>Оферта — както я вижда клиентът</th><th colSpan={CC} className="calc-h">Калкулация — вътрешна, не се печата</th>{editable && <th />}</tr>}
      <tr>
        <th className="no">№</th><th className="desc">Описание на СМР / материал</th><th className="u">Ед. мярка</th><th className="n">Кол-во</th><th className="n">Ед. цена</th><th className="n">Стойност</th>
        {money && <>
          <th className="n c">Материал</th><th className="n c">Доставка</th><th className="n c">Σ дост.</th><th className="n c">Надници</th><th className="n c">Надник</th><th className="n c">Монт./ед</th><th className="n c">Σ монтаж</th>
          <th className="n c">Сума</th><th className="n c">Реж.%</th><th className="n c">Σ реж.</th><th className="n c">Себ-ст</th><th className="n c">Печ.%</th><th className="n c">Печ./ед</th><th className="n c">Σ печ.</th>
          <th className="n c">Дан.%</th><th className="n c">Дан./ед</th><th className="n c">Ръчна</th><th className="n c">→ Ед.цена</th>
        </>}
        {editable && <th className="ops" />}
      </tr>
    </thead>
    <tbody>{rows.map(({ l, i }, r) => { const c = calcLine(l); const iss = lineIssues(l, c); return <tr key={i} className={iss.length ? 'issue' : ''}>
      <td className="no">{iss.length ? <span className="iss" title={iss.join('\n')}>⚠</span> : null}{r + 1}</td>
      <td className="desc"><DescCell l={l} r={r} smr={smr} products={products} editable={editable} onText={v => setL(i, 'description', v)} onPick={p => pickL(i, p)} /></td>
      <td className="u"><input data-g={`${r}:2`} disabled={!editable} value={l.unit || ''} onChange={e => setL(i, 'unit', e.target.value)} list="units" /></td>
      <td className="n">{inp(r, i, 'qty', 3, 76, '0.001')}</td>
      <td className="n price"><b>{fmtMoney(c.price)}</b>{c.manual && c.hasBreakdown && <div className="sub">изч. {fmtMoney(c.calculated)}</div>}</td>
      <td className="n price">{fmtMoney(c.total)}</td>
      {money && <>
        <td className="n c">{inp(r, i, 'material_cost', 4)}</td>
        <td className="n c">{inp(r, i, 'delivery_cost', 5)}</td>
        <td className="n c f">{c.hasBreakdown ? fmtMoney(c.delivery_sum) : '—'}</td>
        <td className="n c">{inp(r, i, 'labour_days', 7, 66, '0.0001')}</td>
        <td className="n c">{inp(r, i, 'day_rate', 8, 66)}</td>
        <td className="n c">{inp(r, i, 'install_cost', 9, 66)}</td>
        <td className="n c f">{c.hasBreakdown ? fmtMoney(c.labour_sum) : '—'}</td>
        <td className="n c f">{c.hasBreakdown ? fmtNum(c.direct, 2) : '—'}</td>
        <td className="n c">{inp(r, i, 'overhead_pct', 12, 52, '0.1')}</td>
        <td className="n c f">{c.hasBreakdown ? fmtMoney(c.overhead_sum) : '—'}</td>
        <td className="n c f">{c.hasBreakdown ? fmtMoney(c.cost_sum) : '—'}</td>
        <td className="n c">{inp(r, i, 'profit_pct', 15, 52, '0.1')}</td>
        <td className="n c f">{c.hasBreakdown ? fmtNum(c.profit, 2) : '—'}</td>
        <td className="n c f">{c.hasBreakdown ? fmtMoney(c.profit_sum) : '—'}</td>
        <td className="n c">{inp(r, i, 'tax_pct', 18, 52, '0.1')}</td>
        <td className="n c f">{c.hasBreakdown ? fmtNum(c.tax, 2) : '—'}</td>
        <td className="n c">{inp(r, i, 'manual_price', 20)}</td>
        <td className="n c f out">{c.hasBreakdown ? fmtMoney(c.calculated) : '—'}</td>
      </>}
      {editable && <td className="ops"><button className="ghost sm" aria-label="Изтрий реда" title="Изтрий реда" onClick={() => delL(i)}>✕</button></td>}
    </tr>; })}
    {!rows.length && <tr><td className="empty" colSpan={30}>Празен раздел — добавете ред или вмъкнете система от шаблон.</td></tr>}</tbody>
    <tfoot>
      {editable && <tr className="addrow"><td colSpan={30}><button className="sm" onClick={addLine}>+ Ред</button><span className="muted small"> Tab/стрелки — движение по клетките · Enter — нов ред</span></td></tr>}
      <tr className="tot"><td colSpan={5}>Общо без ДДС:</td><td className="n">{fmtMoney(t)}</td>{money && <td colSpan={CC} />}{editable && <td />}</tr>
      <tr className="tot"><td colSpan={5}>ДДС {fmtNum(vatPct, 0)}%:</td><td className="n">{fmtMoney(t * vatPct / 100)}</td>{money && <td colSpan={CC} />}{editable && <td />}</tr>
      <tr className="tot grand"><td colSpan={5}>Общо с ДДС:</td><td className="n"><b>{fmtMoney(t * (1 + vatPct / 100))}</b></td>{money && <td colSpan={CC} />}{editable && <td />}</tr>
    </tfoot>
  </table></div>;
}

export function OfferEditor({ id }: { id: number }) {
  const offer = useLoad<any>(`/offers/${id}`);
  const can = useCan();
  const cur = useCurrency();
  const { state } = useAuth();
  const smr = useLoad<any[]>('/smr-types');
  const products = useLoad<any[]>('/products');
  const { run, busy } = useAction();
  const [tab, setTab] = useState('lines');
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [head, setHead] = useState<Record<string, any>>({});
  const [sections, setSections] = useState<Section[]>([]);
  const [labour, setLabour] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showCost, setShowCost] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [picking, setPicking] = useState(false);
  const [preflight, setPreflight] = useState<null | { i: number; sec: string; issues: string[] }[]>(null);
  const [extras, setExtras] = useState(false);
  const templates = useLoad<any[]>(picking ? '/offer-templates' : null);
  const o = offer.data;
  const version = o?.versions.find((v: any) => v.version === (viewVersion ?? o.current_version));
  const defaults = { overhead_pct: N(state.settings.overhead_pct || 3.5), profit_pct: N(state.settings.profit_pct || 30), tax_pct: N(state.settings.corporate_tax_pct || 10) };

  useEffect(() => {
    if (!o || !version) return;
    setHead({ title: o.title, site_address: o.site_address || '', attention_to: version.attention_to || '', offer_date: version.offer_date || '', validity_months: version.validity_months ?? 1,
      discount_pct: version.discount_pct ?? 0, notes: version.notes || '', execution_logic: version.execution_logic || '' });
    setSections(version.sections.map((s: any) => ({ key: String(s.id), title: s.title, description: s.description || '', footer: s.footer || '', alternative: !!s.alternative })));
    setLines(version.lines.map((l: any) => ({ ...l, section: l.section_id ? String(l.section_id) : '' })));
    setLabour(version.labour_calc || JSON.parse(JSON.stringify(DEFAULT_LABOUR)));
    setDirty(false);
  }, [o?.row_version, version?.id]);

  const editable = !!o && can('offers', 'write') && version && !version.locked && version.version === o.current_version;
  const money = can('finance') || can('offers', 'write');
  const vatPct = N(state.settings.vat_pct || 20);
  const totals = useMemo(() => {
    const alt = new Set(sections.filter(s => s.alternative).map(s => s.key));
    let gross = 0, cost = 0;
    for (const l of lines) { const c = calcLine(l); const unitCost = c.hasBreakdown ? c.cost_sum : N(l.unit_cost) * N(l.qty); if (!alt.has(l.section)) { gross += c.total; cost += unitCost; } }
    const net = r2(gross * (1 - N(head.discount_pct) / 100));
    return { gross: r2(gross), net, cost: r2(cost), margin: r2(net - cost), vat: r2(net * vatPct / 100), withVat: r2(net * (1 + vatPct / 100)) };
  }, [lines, sections, head.discount_pct, vatPct]);

  if (!o || !version) return <Loader state={offer}><div /></Loader>;
  const touch = () => setDirty(true);
  const setL = (i: number, k: string, v: any) => { setLines(x => x.map((l, j) => j === i ? { ...l, [k]: v } : l)); touch(); };
  const pickL = (i: number, p: Partial<Line>) => { setLines(x => x.map((l, j) => j === i ? { ...l, ...p } : l)); touch(); };
  const delL = (i: number) => { setLines(x => x.filter((_, j) => j !== i)); touch(); };
  const setH = (k: string, v: any) => { setHead(x => ({ ...x, [k]: v })); touch(); };
  const setS = (i: number, k: keyof Section, v: any) => { setSections(x => x.map((s, j) => j === i ? { ...s, [k]: v } : s)); touch(); };
  const addLine = (section = '') => { setLines(x => [...x, { section, description: '', unit: 'м²', qty: 1, material_cost: '', delivery_cost: '', labour_days: '', day_rate: '', install_cost: '', manual_price: '', ...defaults }]); touch(); };
  const insertTemplate = (t: any) => {
    const key = 'tpl' + Date.now();
    setSections(x => [...x, { key, title: t.title, description: t.description || '', footer: t.footer || '', alternative: !!t.alternative }]);
    setLines(x => [...x, ...t.lines.map((l: any) => ({ material_cost: '', delivery_cost: '', labour_days: '', day_rate: '', install_cost: '', manual_price: '', ...defaults, ...l, section: key }))]);
    touch(); setPicking(false);
  };
  const addSection = () => { setSections(x => [...x, { key: 'new' + Date.now(), title: '', description: '', footer: '', alternative: false }]); touch(); };
  const applyLabour = (perUnit: number, dayRate: number, unit: string, name: string) => {
    const n = { count: 0 };
    setLines(x => x.map(l => { if (l.unit !== unit || filled(l.install_cost)) return l; n.count++; return { ...l, labour_days: perUnit, day_rate: dayRate }; }));
    touch();
    window.alert(n.count ? `${name}: ${n.count} реда с мярка „${unit}“ получиха надници ${perUnit}/ед. и надник ${dayRate} €` : `Няма редове с мярка „${unit}“ (или са с ръчен монтаж)`);
  };
  const labourRes = labour ? labourCalc(labour) : null;
  const labourChips = (labourRes?.activities || [])
    .filter((a: any) => a.per_unit != null && labourRes?.day_rate != null && a.unit)
    .map((a: any) => ({ a, n: lines.filter(l => l.unit === a.unit && !filled(l.install_cost) && !filled(l.labour_days)).length }))
    .filter((x: any) => x.n > 0);
  const payload = () => ({ ...head, labour_calc: labour, row_version: o.row_version, sections, lines: lines.map(l => ({ ...l, section: l.section || null })) });
  const save = () => run(async () => { const d = await api.put(`/offers/${id}`, payload()); offer.setData(d); setDirty(false); }, 'Офертата е записана');
  const act = (name: string, body: any = {}, ok?: string) => run(async () => { if (dirty && editable) await api.put(`/offers/${id}`, payload()); await api.post(`/offers/${id}/${name}`, body); await offer.reload(); setViewVersion(null); }, ok);
  const issues = lines.map((l, i) => ({ i, sec: sections.find(s => s.key === l.section)?.title || '', issues: lineIssues(l, calcLine(l)) })).filter(x => x.issues.length);
  const send = () => { if (issues.length) setPreflight(issues); else act('send', {}, 'Офертата е изпратена и версията е заключена'); };
  const alternatives = version.sections.filter((s: any) => s.alternative);
  const valid = dirty ? validUntil(head.offer_date, head.validity_months) : version.totals.valid_until;
  const groups: { key: string; section?: Section; idx?: number }[] = [{ key: '' }, ...sections.map((s, idx) => ({ key: s.key, section: s, idx }))];
  const clauses = String(state.settings.offer_clauses || '').split('\n').map(x => x.trim()).filter(Boolean);

  return <>
    <div className="page-head">
      <div><div className="muted small"><Link to="/offers">Оферти</Link> / {o.customer_name}</div><h1>Оферта № {o.code} <span className="muted" style={{ fontWeight: 400 }}>v{version.version}</span> <Status value={version.version === o.current_version ? o.status : version.status} /></h1></div>
      <span className="spacer" />
      <button disabled={dirty} title={dirty ? 'Запишете първо' : ''} onClick={() => window.open(`/api/offers/${id}/print?version=${version.version}`, '_blank')}>Печат / PDF</button>
      <button disabled={dirty} title={dirty ? 'Запишете първо' : ''} onClick={() => { window.location.href = `/api/offers/${id}/export.xlsx?version=${version.version}`; }}>Excel</button>
      {o.project_id && <button onClick={() => navigate(`/projects/${o.project_id}`)}>Картон на обекта {o.project_code}</button>}
      {editable && <button className="primary" disabled={busy || !dirty} onClick={save}>Запис{dirty ? ' •' : ''}</button>}
      {editable && <button disabled={busy || !lines.length} onClick={send}>Изпрати на клиента</button>}
      {can('offers', 'write') && o.status !== 'confirmed' && !!version.locked && version.version === o.current_version && <button disabled={busy} onClick={() => act('revise', { reason: window.prompt('Причина за ревизията:') || '' }, 'Създадена е нова ревизия')}>Нова ревизия</button>}
      {can('offers', 'write') && ['draft', 'sent'].includes(o.status) && version.version === o.current_version && <button className="primary" disabled={busy || !lines.length} onClick={() => { setChosen([]); setConfirming(true); }}>Потвърдена от клиента</button>}
      {can('offers', 'write') && ['draft', 'sent'].includes(o.status) && <button className="danger" disabled={busy} onClick={() => act('reject', { reason: window.prompt('Причина за отказа:') || '' }, 'Офертата е отказана')}>Отказана</button>}
    </div>
    {!!version.locked && o.status !== 'confirmed' && version.version === o.current_version && <div className="alert warn">Тази версия е изпратена и заключена. За промени създайте нова ревизия; старата версия се пази.</div>}
    {o.status === 'confirmed' && <div className="alert ok">Офертата е потвърдена (версия {o.confirmed_version}) и е търговската база на обект {o.project_code || '(създава се…)'}. Промени се правят с анекс към договора.</div>}
    {viewVersion != null && viewVersion !== o.current_version && <div className="alert">Преглеждате стара версия v{viewVersion}. <a onClick={() => setViewVersion(null)}>Към текущата</a></div>}

    <Tabs tabs={[['lines', 'Оферта'], ['labour', 'Труд'], ['head', 'Бележки и логика'], ['versions', `Версии (${o.versions.length})`]]} value={tab} onChange={setTab} />

    {tab === 'labour' && (editable ? <LabourTab labour={labour} setLabour={l => { setLabour(l); touch(); }} onApply={applyLabour} />
      : <Card title="Труд">{version.labour_calc ? <LabourTab labour={version.labour_calc} setLabour={() => {}} onApply={() => {}} /> : <div className="empty">Няма калкулация за труд.</div>}</Card>)}

    {tab === 'head' && <Card title="Бележки и логика"><div className="form c2">
      <Field label="Логика на изпълнение (СМР)" full><textarea disabled={!editable} value={head.execution_logic || ''} onChange={e => setH('execution_logic', e.target.value)} /></Field>
      <Field label="Бележки / причина за ревизията" full><textarea disabled={!editable} value={head.notes || ''} onChange={e => setH('notes', e.target.value)} /></Field>
    </div></Card>}

    {tab === 'lines' && <>
      <div className="row" style={{ marginBottom: 10 }}>
        {editable && <button onClick={addSection}>+ Раздел (система / вариант)</button>}
        {editable && <button className="primary" onClick={() => setPicking(true)}>+ От готов шаблон</button>}
        {money && <label className="row small muted"><input type="checkbox" checked={showCost} onChange={e => setShowCost(e.target.checked)} /> Показвай калкулацията (не се вижда от клиента)</label>}
        <span className="spacer" />
        {dirty && <span className="badge warn">незаписани промени</span>}
      </div>
      {editable && labourChips.length > 0 && <div className="row chips">
        <span className="muted small">От „Труд“:</span>
        {labourChips.map((x: any, i: number) => <span key={i} className="chip">{x.a.name} → {fmtNum(x.a.per_unit, 4)} над/{x.a.unit} × {fmtMoney(labourRes!.day_rate!)} · {x.n} ред{x.n > 1 ? 'а' : ''}
          <a onClick={() => applyLabour(x.a.per_unit, labourRes!.day_rate!, x.a.unit, x.a.name)}>приложи</a></span>)}
      </div>}

      <div className="doc card">
        <div className="doc-letterhead">
          <img className="doc-logo" src="/offer_logo.png" alt="" onError={e => (e.currentTarget.style.display = 'none')} />
          <div className="doc-head">
            <div className="dh-row"><span className="dh-l">На вниманието на:</span><input disabled={!editable} value={head.attention_to || ''} placeholder={o.customer_name} onChange={e => setH('attention_to', e.target.value)} /></div>
            <div className="dh-row"><span className="dh-l">Обект:</span><input disabled={!editable} value={head.title || ''} onChange={e => setH('title', e.target.value)} />
              <span className="dh-l">Адрес:</span><input disabled={!editable} value={head.site_address || ''} onChange={e => setH('site_address', e.target.value)} /></div>
            <div className="dh-row"><span className="dh-l">Оферта:</span><span className="dh-v">№ <b>{o.code}</b> /</span><input type="date" disabled={!editable} value={head.offer_date || ''} onChange={e => setH('offer_date', e.target.value)} />
              <span className="dh-l red">валидност:</span><input className="dh-months" type="number" min="1" step="1" disabled={!editable} value={head.validity_months ?? 1} onChange={e => setH('validity_months', e.target.value)} /><span className="dh-v red">месец/а</span></div>
            <div className="dh-row"><span className="dh-l">Валидна до:</span><span className="dh-v"><b>{fmtDate(valid)}</b></span>
              <span className="dh-l">Клиент:</span><span className="dh-v">{o.customer_code} · {o.customer_name}</span></div>
            <div className="dh-row"><span className="dh-l">Съставил:</span><span className="dh-v">{o.owner?.full_name || '—'}</span>
              <span className="dh-l">Тел. за връзка:</span><span className="dh-v">{o.owner?.phone || '—'}</span></div>
          </div>
        </div>

        {(head.notes || head.execution_logic || extras || editable) && <div className="doc-extras">
          <a className="small" onClick={() => setExtras(x => !x)}>{extras ? '▾' : '▸'} Бележки и логика на изпълнение</a>
          {extras && <div className="form c2" style={{ marginTop: 8 }}>
            <Field label="Логика на изпълнение (СМР)"><textarea disabled={!editable} value={head.execution_logic || ''} onChange={e => setH('execution_logic', e.target.value)} /></Field>
            <Field label="Бележки"><textarea disabled={!editable} value={head.notes || ''} onChange={e => setH('notes', e.target.value)} /></Field>
          </div>}
        </div>}

        {groups.map(g => {
          const rows = lines.map((l, i) => ({ l, i })).filter(x => (x.l.section || '') === g.key);
          if (!g.section && !rows.length && sections.length) return null;
          if (!g.section && !rows.length && !sections.length && !editable) return null;
          const s = g.section;
          if (!s && !rows.length && editable && sections.length) return null;
          return <section key={g.key || 'loose'} className={'doc-sec' + (s?.alternative ? ' alt' : '')}>
            {s ? <div className="doc-sec-head">
              {editable ? <input className="doc-sec-title" value={s.title} placeholder="Име на системата / раздела…" onChange={e => setS(g.idx!, 'title', e.target.value)} />
                : <h3>{s.title || 'Раздел'}</h3>}
              <label className="row small" title="Вариантите не се сумират в общата стойност — клиентът избира един">
                <input type="checkbox" disabled={!editable} checked={s.alternative} onChange={e => setS(g.idx!, 'alternative', e.target.checked)} /> вариант</label>
              {editable && <button className="ghost sm danger" title="Изтрий раздела и редовете му" onClick={() => { setLines(x => x.filter(l => l.section !== s.key)); setSections(x => x.filter(y => y.key !== s.key)); touch(); }}>✕</button>}
            </div> : sections.length > 0 && <div className="doc-sec-head"><h3 className="muted">Други редове</h3></div>}
            {s && (editable ? <textarea className="doc-sec-desc" rows={Math.max(2, Math.ceil((s.description || '').length / 110))} value={s.description}
              placeholder="Описание на системата — печата се над редовете…" onChange={e => setS(g.idx!, 'description', e.target.value)} />
              : s.description && <p className="doc-sec-desc">{s.description}</p>)}
            {s?.alternative && <div className="alt-note">Вариант — не се сумира в общата стойност.</div>}
            <SheetGrid rows={rows} editable={editable} money={money && showCost} smr={smr.data || []} products={products.data || []}
              setL={setL} pickL={pickL} delL={delL} addLine={() => addLine(g.key)} vatPct={vatPct} />
            {s && (editable || s.footer) && (editable ? <input className="doc-sec-foot" value={s.footer} placeholder="Бележка под раздела (незадължителна)…" onChange={e => setS(g.idx!, 'footer', e.target.value)} />
              : <p className="doc-sec-foot">{s.footer}</p>)}
          </section>;
        })}
        {editable && !lines.length && <div className="empty"><b>Празна оферта</b>Вмъкнете система от „+ От готов шаблон“ или добавете редове с „+ Раздел“ / „+ Ред“.</div>}

        <table className="doc-totals"><tbody>
          <tr><td>Общо{alternatives.length ? ' (без вариантите)' : ''}, {cur} без ДДС:</td><td className="n">{fmtMoney(totals.gross)}</td></tr>
          <tr><td>Отстъпка {editable ? <input className="dh-months" type="number" min="0" max="100" step="0.1" value={head.discount_pct ?? 0} onChange={e => setH('discount_pct', e.target.value)} /> : fmtNum(head.discount_pct, 1)}%:</td>
            <td className="n">−{fmtMoney(totals.gross - totals.net)}</td></tr>
          <tr><td>ДДС {fmtNum(vatPct, 0)}%:</td><td className="n">{fmtMoney(totals.vat)}</td></tr>
          <tr className="grand"><td>Общо, {cur} с ДДС:</td><td className="n">{fmtMoney(totals.withVat)}</td></tr>
          {money && <><tr className="fin"><td>Себестойност:</td><td className="n">{fmtMoney(totals.cost)}</td></tr>
            <tr className="fin"><td>Марж:</td><td className={'n ' + (totals.margin < 0 ? 'bad' : 'ok')}>{fmtMoney(totals.margin)}{totals.net ? ` (${fmtNum(totals.margin / totals.net * 100, 1)}%)` : ''}</td></tr></>}
        </tbody></table>

        {clauses.length > 0 && <ol className="doc-clauses">{clauses.map((c, i) => <li key={i}>{c}</li>)}</ol>}
      </div>
    </>}

    {tab === 'versions' && <Card pad={false} title="Версии на офертата"><div className="table-wrap"><table className="t"><thead><tr><th>Версия</th><th>Статус</th><th>Създадена</th><th>От</th><th>Бележка</th><th className="num">Без ДДС, {cur}</th><th /></tr></thead>
      <tbody>{o.versions.map((v: any) => <tr key={v.id}><td>v{v.version}{v.version === o.confirmed_version ? ' · търговска база' : ''}</td><td><Status value={v.status} /></td><td>{fmtDate(v.created_at)}</td><td>{v.created_by_name}</td><td>{v.notes}</td>
        <td className="num">{fmtMoney(v.totals.net)}</td><td><button className="sm" onClick={() => { setViewVersion(v.version); setTab('lines'); }}>Преглед</button></td></tr>)}</tbody></table></div></Card>}

    <datalist id="units">{['м²', 'л.м', 'бр.', 'к-т', 'кг', 'т', 'м³', 'ч'].map(u => <option key={u} value={u} />)}</datalist>

    {picking && <Modal wide title="Готови системи (от шаблона на офертите)" onClose={() => setPicking(false)}>
      {!templates.data ? <div className="empty">Зареждане…</div> : templates.data.length === 0 ? <div className="empty">Няма шаблони</div> :
        <div className="table-wrap"><table className="t"><thead><tr><th>Група</th><th>Система</th><th className="num">Редове</th><th>Вид</th><th /></tr></thead>
          <tbody>{templates.data.map((t: any) => <tr key={t.id}><td>{t.family}</td><td><b>{t.title}</b><div className="muted small">{(t.description || t.lines[0]?.description || '').slice(0, 160)}</div></td>
            <td className="num">{t.lines.length}</td><td>{t.alternative ? <span className="badge warn">вариант</span> : ''}</td><td><button className="sm primary" onClick={() => insertTemplate(t)}>Добави</button></td></tr>)}</tbody></table></div>}
      <p className="muted small">Цените в шаблоните са от Excel файла. Където трудът идва от калкулатора „Труд“, надниците и стойността на надника се попълват от таба „Труд“.</p>
    </Modal>}

    {preflight && <Modal title="Проверка преди изпращане" onClose={() => setPreflight(null)}
      footer={<><button onClick={() => setPreflight(null)}>Отказ — ще поправя</button>
        <button className="danger" onClick={() => { setPreflight(null); act('send', {}, 'Офертата е изпратена и версията е заключена'); }}>Изпрати все пак</button></>}>
      <p>Открити са {preflight.length} проблемни реда. Изпратена така, офертата може да е грешна:</p>
      <div className="table-wrap"><table className="t"><thead><tr><th>Ред</th><th>Раздел</th><th>Проблем</th></tr></thead>
        <tbody>{preflight.map(x => <tr key={x.i}><td>№{x.i + 1}</td><td>{x.sec || '—'}</td><td>{x.issues.join('; ')}</td></tr>)}</tbody></table></div>
    </Modal>}

    {confirming && <Modal title="Потвърждение от клиента" onClose={() => setConfirming(false)}
      footer={<><button onClick={() => setConfirming(false)}>Отказ</button><button className="primary" disabled={busy || (alternatives.length > 0 && !chosen.length)}
        onClick={async () => { setConfirming(false); await act('confirm', { sections: chosen }, 'Офертата е потвърдена. Създават се Картон на обекта и проект на договор.'); }}>Потвърди</button></>}>
      <p>След потвърждението тази версия се заключва като търговска база. Автоматично се създават Картон на обекта и проект на договор; Договори, Техник и Управител получават известие.</p>
      {dirty && <div className="alert warn">Има незаписани промени — ще бъдат записани преди потвърждението.</div>}
      {alternatives.length > 0 && <><h3>Кой вариант потвърди клиентът?</h3>{alternatives.map((s: any) => <label key={s.id} className="row" style={{ padding: '4px 0' }}>
        <input type="checkbox" checked={chosen.includes(s.id)} onChange={e => setChosen(x => e.target.checked ? [...x, s.id] : x.filter(y => y !== s.id))} /> {s.title}
        <span className="muted">— {fmtMoney(version.totals.sections.find((x: any) => x.section_id === s.id)?.net)} {cur}</span></label>)}
        {dirty && <div className="muted small">Запишете офертата първо, ако сте променяли раздели.</div>}</>}
    </Modal>}
  </>;
}
