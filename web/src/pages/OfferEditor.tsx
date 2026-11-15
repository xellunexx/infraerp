// Offer editor. The price columns follow the company's Excel offer template:
// material + delivery + labour -> overhead % -> profit % -> corporate tax % -> unit price (or a price typed by hand).
import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtDate, fmtMoney, fmtNum } from '../api';
import { Card, Field, Kpi, Link, Loader, Modal, Status, Tabs, navigate, useAction, useAuth, useCan, useCurrency, useLoad } from '../ui';

type Line = Record<string, any>;
type Section = { key: string; title: string; description: string; footer: string; alternative: boolean };
const N = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const filled = (v: any) => v !== null && v !== undefined && v !== '';

/** Same arithmetic as server/pricing.js (the server recomputes and stores the result on save). */
export function calcLine(l: Line) {
  const labour = filled(l.install_cost) ? N(l.install_cost) : N(l.labour_days) * N(l.day_rate);
  const direct = N(l.material_cost) + N(l.delivery_cost) + labour;
  const overhead = direct * N(l.overhead_pct) / 100, profit = direct * N(l.profit_pct) / 100, tax = profit * N(l.tax_pct) / 100;
  const calculated = r2(direct + overhead + profit + tax);
  const price = filled(l.manual_price) ? r2(N(l.manual_price)) : calculated;
  return { labour, direct, overhead, profit, tax, calculated, price, total: r2(N(l.qty) * price), cost: (direct + overhead) * N(l.qty), hasBreakdown: direct > 0 };
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
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showCost, setShowCost] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const o = offer.data;
  const version = o?.versions.find((v: any) => v.version === (viewVersion ?? o.current_version));
  const defaults = { overhead_pct: N(state.settings.overhead_pct || 3.5), profit_pct: N(state.settings.profit_pct || 30), tax_pct: N(state.settings.corporate_tax_pct || 10) };

  useEffect(() => {
    if (!o || !version) return;
    setHead({ title: o.title, site_address: o.site_address || '', attention_to: version.attention_to || '', offer_date: version.offer_date || '', validity_months: version.validity_months ?? 1,
      discount_pct: version.discount_pct ?? 0, notes: version.notes || '', execution_logic: version.execution_logic || '' });
    setSections(version.sections.map((s: any) => ({ key: String(s.id), title: s.title, description: s.description || '', footer: s.footer || '', alternative: !!s.alternative })));
    setLines(version.lines.map((l: any) => ({ ...l, section: l.section_id ? String(l.section_id) : '' })));
    setDirty(false);
  }, [o?.row_version, version?.id]);

  const editable = !!o && can('offers', 'write') && version && !version.locked && version.version === o.current_version;
  const money = can('finance') || can('offers', 'write');
  const totals = useMemo(() => {
    const alt = new Set(sections.filter(s => s.alternative).map(s => s.key));
    let gross = 0, cost = 0; const per: Record<string, number> = {};
    for (const l of lines) { const c = calcLine(l); const unitCost = c.hasBreakdown ? c.cost : N(l.unit_cost) * N(l.qty); per[l.section || ''] = (per[l.section || ''] || 0) + c.total; if (!alt.has(l.section)) { gross += c.total; cost += unitCost; } }
    const net = r2(gross * (1 - N(head.discount_pct) / 100)), vat = N(state.settings.vat_pct || 20);
    return { gross: r2(gross), net, cost: r2(cost), margin: r2(net - cost), vat: r2(net * vat / 100), withVat: r2(net * (1 + vat / 100)), vatPct: vat, per };
  }, [lines, sections, head.discount_pct]);

  if (!o || !version) return <Loader state={offer}><div /></Loader>;
  const touch = () => setDirty(true);
  const setL = (i: number, k: string, v: any) => { setLines(x => x.map((l, j) => j === i ? { ...l, [k]: v } : l)); touch(); };
  const setH = (k: string, v: any) => { setHead(x => ({ ...x, [k]: v })); touch(); };
  const setS = (i: number, k: keyof Section, v: any) => { setSections(x => x.map((s, j) => j === i ? { ...s, [k]: v } : s)); touch(); };
  const addLine = (section = '') => { setLines(x => [...x, { section, description: '', unit: 'м²', qty: 1, material_cost: '', delivery_cost: '', labour_days: '', day_rate: '', install_cost: '', manual_price: '', ...defaults }]); touch(); };
  const addSection = () => { setSections(x => [...x, { key: 'new' + Date.now(), title: '', description: '', footer: '', alternative: false }]); touch(); };
  const pickSmr = (i: number, sid: string) => { const s = (smr.data || []).find(x => x.id === Number(sid)); setLines(x => x.map((l, j) => j === i ? { ...l, smr_type_id: s?.id || null, code: s?.code || l.code, description: s ? s.name : l.description, unit: s?.unit || l.unit } : l)); touch(); };
  const payload = () => ({ ...head, row_version: o.row_version, sections, lines: lines.map(l => ({ ...l, section: l.section || null })) });
  const save = () => run(async () => { const d = await api.put(`/offers/${id}`, payload()); offer.setData(d); setDirty(false); }, 'Офертата е записана');
  const act = (name: string, body: any = {}, ok?: string) => run(async () => { if (dirty && editable) await api.put(`/offers/${id}`, payload()); await api.post(`/offers/${id}/${name}`, body); await offer.reload(); setViewVersion(null); }, ok);
  const alternatives = version.sections.filter((s: any) => s.alternative);
  const valid = version.totals.valid_until;
  const groups: { key: string; section?: Section; idx?: number }[] = [{ key: '' }, ...sections.map((s, idx) => ({ key: s.key, section: s, idx }))];
  const inp = (i: number, k: string, w = 78, step = '0.01') => <input className="cell-input num" style={{ width: w }} type="number" step={step} min="0" disabled={!editable} value={lines[i][k] ?? ''} onChange={e => setL(i, k, e.target.value)} />;

  return <>
    <div className="page-head">
      <div><div className="muted small"><Link to="/offers">Оферти</Link> / {o.customer_name}</div><h1>Оферта № {o.code} <span className="muted" style={{ fontWeight: 400 }}>v{version.version}</span> <Status value={version.version === o.current_version ? o.status : version.status} /></h1></div>
      <span className="spacer" />
      {o.project_id && <button onClick={() => navigate(`/projects/${o.project_id}`)}>Картон на обекта {o.project_code}</button>}
      {editable && <button className="primary" disabled={busy || !dirty} onClick={save}>Запис</button>}
      {editable && <button disabled={busy || !lines.length} onClick={() => act('send', {}, 'Офертата е изпратена и версията е заключена')}>Изпрати на клиента</button>}
      {can('offers', 'write') && o.status !== 'confirmed' && !!version.locked && version.version === o.current_version && <button disabled={busy} onClick={() => act('revise', { reason: window.prompt('Причина за ревизията:') || '' }, 'Създадена е нова ревизия')}>Нова ревизия</button>}
      {can('offers', 'write') && ['draft', 'sent'].includes(o.status) && version.version === o.current_version && <button className="primary" disabled={busy || !lines.length} onClick={() => { setChosen([]); setConfirming(true); }}>Потвърдена от клиента</button>}
      {can('offers', 'write') && ['draft', 'sent'].includes(o.status) && <button className="danger" disabled={busy} onClick={() => act('reject', { reason: window.prompt('Причина за отказа:') || '' }, 'Офертата е отказана')}>Отказана</button>}
    </div>
    {!!version.locked && o.status !== 'confirmed' && version.version === o.current_version && <div className="alert warn">Тази версия е изпратена и заключена. За промени създайте нова ревизия; старата версия се пази.</div>}
    {o.status === 'confirmed' && <div className="alert ok">Офертата е потвърдена (версия {o.confirmed_version}) и е търговската база на обект {o.project_code || '(създава се…)'}. Промени се правят с анекс към договора.</div>}
    {viewVersion != null && viewVersion !== o.current_version && <div className="alert">Преглеждате стара версия v{viewVersion}. <a onClick={() => setViewVersion(null)}>Към текущата</a></div>}

    <div className="grid g4 kpis-m" style={{ marginBottom: 14 }}>
      <Kpi label={`Общо без ДДС, ${cur}`} value={fmtMoney(totals.net)} sub={N(head.discount_pct) ? `отстъпка ${head.discount_pct}% от ${fmtMoney(totals.gross)}` : undefined} />
      <Kpi label={`ДДС ${totals.vatPct}%`} value={fmtMoney(totals.vat)} sub={`с ДДС: ${fmtMoney(totals.withVat)}`} />
      {money && <Kpi label="Себестойност" value={fmtMoney(totals.cost)} />}
      {money && <Kpi label="Марж" value={fmtMoney(totals.margin)} tone={totals.margin < 0 ? 'bad' : 'ok'} sub={totals.net ? fmtNum(totals.margin / totals.net * 100, 1) + '% от продажбата' : undefined} />}
    </div>

    <Tabs tabs={[['lines', 'Редове и цени'], ['head', 'Данни за офертата'], ['versions', `Версии (${o.versions.length})`]]} value={tab} onChange={setTab} />

    {tab === 'head' && <Card title="Данни за офертата"><div className="form c3">
      <Field label="Обект"><input disabled={!editable} value={head.title || ''} onChange={e => setH('title', e.target.value)} /></Field>
      <Field label="Адрес на обекта"><input disabled={!editable} value={head.site_address || ''} onChange={e => setH('site_address', e.target.value)} /></Field>
      <Field label="На вниманието на"><input disabled={!editable} value={head.attention_to || ''} onChange={e => setH('attention_to', e.target.value)} /></Field>
      <Field label="Дата на офертата"><input type="date" disabled={!editable} value={head.offer_date || ''} onChange={e => setH('offer_date', e.target.value)} /></Field>
      <Field label="Валидност (месеци)"><input type="number" min="1" step="1" disabled={!editable} value={head.validity_months ?? 1} onChange={e => setH('validity_months', e.target.value)} /></Field>
      <Field label="Валидна до"><input disabled value={dirty ? 'изчислява се при запис' : fmtDate(valid)} /></Field>
      <Field label="Съставил"><input disabled value={o.owner ? `${o.owner.full_name}${o.owner.phone ? ' · ' + o.owner.phone : ''}` : '—'} /></Field>
      <Field label="Отстъпка %"><input type="number" min="0" max="100" step="0.1" disabled={!editable} value={head.discount_pct ?? 0} onChange={e => setH('discount_pct', e.target.value)} /></Field>
      <Field label="Клиент"><input disabled value={`${o.customer_code} · ${o.customer_name}`} /></Field>
      <Field label="Логика на изпълнение (СМР)" full><textarea disabled={!editable} value={head.execution_logic || ''} onChange={e => setH('execution_logic', e.target.value)} /></Field>
      <Field label="Бележки / причина за ревизията" full><textarea disabled={!editable} value={head.notes || ''} onChange={e => setH('notes', e.target.value)} /></Field>
    </div></Card>}

    {tab === 'lines' && <>
      <div className="row" style={{ marginBottom: 10 }}>
        {editable && <button onClick={addSection}>+ Раздел (система / вариант)</button>}
        {money && <label className="row small muted"><input type="checkbox" checked={showCost} onChange={e => setShowCost(e.target.checked)} /> Показвай калкулацията (не се вижда от клиента)</label>}
      </div>
      {groups.map(g => {
        const rows = lines.map((l, i) => ({ l, i })).filter(x => (x.l.section || '') === g.key);
        if (!g.section && !rows.length && sections.length) return null;
        const s = g.section;
        return <Card key={g.key || 'none'} pad={false} title={s ? <span>{s.title || 'Нов раздел'} {s.alternative && <span className="badge warn">вариант</span>}</span> : (sections.length ? 'Редове извън раздел' : 'Редове')}
          actions={<span className="muted">Общо: <b>{fmtMoney(totals.per[g.key] || 0)}</b> {cur}</span>}>
          {s && <div className="body form c2" style={{ borderBottom: '1px solid var(--border)' }}>
            <Field label="Заглавие на раздела / система"><input disabled={!editable} value={s.title} onChange={e => setS(g.idx!, 'title', e.target.value)} /></Field>
            <div className="row" style={{ alignItems: 'end' }}><label className="row"><input type="checkbox" disabled={!editable} checked={s.alternative} onChange={e => setS(g.idx!, 'alternative', e.target.checked)} /> Вариант (не се сумира в общата стойност)</label>
              <span className="spacer" />{editable && <button className="sm danger" onClick={() => { setLines(x => x.filter(l => l.section !== s.key)); setSections(x => x.filter(y => y.key !== s.key)); touch(); }}>Изтрий раздела</button>}</div>
            <Field label="Описание (печата се в офертата)" full><textarea disabled={!editable} value={s.description} onChange={e => setS(g.idx!, 'description', e.target.value)} /></Field>
          </div>}
          <div className="table-wrap"><table className="t">
            <thead><tr><th style={{ width: 30 }}>№</th><th style={{ minWidth: 240 }}>Описание на СМР / материал</th><th>Мярка</th><th className="num">Количество</th>
              {showCost && money && <><th className="num">Материал</th><th className="num">Доставка</th><th className="num">Надници</th><th className="num">Надник</th><th className="num">Монтаж/ед.</th><th className="num">Реж. %</th><th className="num">Печ. %</th><th className="num">Изчислена</th><th className="num">Ръчна цена</th></>}
              <th className="num">Ед. цена</th><th className="num">Стойност</th>{editable && <th />}</tr></thead>
            <tbody>{rows.map(({ l, i }, n) => { const c = calcLine(l); return <tr key={i}>
              <td className="muted">{n + 1}</td>
              <td>{editable && (smr.data || []).length > 0 && <select className="cell-input" style={{ marginBottom: 4 }} value={l.smr_type_id || ''} onChange={e => pickSmr(i, e.target.value)}><option value="">— СМР от номенклатурата —</option>{(smr.data || []).map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select>}
                <textarea className="cell-input" style={{ minHeight: 40 }} disabled={!editable} value={l.description || ''} onChange={e => setL(i, 'description', e.target.value)} /></td>
              <td><input className="cell-input" style={{ width: 62 }} disabled={!editable} value={l.unit || ''} onChange={e => setL(i, 'unit', e.target.value)} /></td>
              <td className="num">{inp(i, 'qty', 86, '0.001')}</td>
              {showCost && money && <><td className="num">{inp(i, 'material_cost')}</td><td className="num">{inp(i, 'delivery_cost')}</td><td className="num">{inp(i, 'labour_days', 70, '0.0001')}</td><td className="num">{inp(i, 'day_rate')}</td>
                <td className="num">{inp(i, 'install_cost')}</td><td className="num">{inp(i, 'overhead_pct', 58, '0.1')}</td><td className="num">{inp(i, 'profit_pct', 58, '0.1')}</td>
                <td className="num muted">{c.hasBreakdown ? fmtMoney(c.calculated) : '—'}</td><td className="num">{inp(i, 'manual_price')}</td></>}
              <td className="num"><b>{fmtMoney(c.price)}</b></td><td className="num">{fmtMoney(c.total)}</td>
              {editable && <td><button className="ghost sm" aria-label="Изтрий реда" onClick={() => { setLines(x => x.filter((_, j) => j !== i)); touch(); }}>✕</button></td>}</tr>; })}</tbody>
            {editable && <tfoot><tr><td colSpan={20}><button className="sm" onClick={() => addLine(g.key)}>+ Ред</button></td></tr></tfoot>}
          </table></div>
        </Card>; })}
    </>}

    {tab === 'versions' && <Card pad={false} title="Версии на офертата"><div className="table-wrap"><table className="t"><thead><tr><th>Версия</th><th>Статус</th><th>Създадена</th><th>От</th><th>Бележка</th><th className="num">Без ДДС, {cur}</th><th /></tr></thead>
      <tbody>{o.versions.map((v: any) => <tr key={v.id}><td>v{v.version}{v.version === o.confirmed_version ? ' · търговска база' : ''}</td><td><Status value={v.status} /></td><td>{fmtDate(v.created_at)}</td><td>{v.created_by_name}</td><td>{v.notes}</td>
        <td className="num">{fmtMoney(v.totals.net)}</td><td><button className="sm" onClick={() => { setViewVersion(v.version); setTab('lines'); }}>Преглед</button></td></tr>)}</tbody></table></div></Card>}

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