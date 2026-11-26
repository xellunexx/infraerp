// Едно плащане — един запис. Договори и Логистика докладват, Счетоводство записва направо или потвърждава.
import React, { useState } from 'react';
import { api, fmtDate, fmtDateTime, fmtMoney, today } from '../api';
import { Card, Empty, Field, Loader, Modal, Table, useAction, useCan, useCurrency, useForm, useLoad } from '../ui';

export const MILESTONE: Record<string, string> = { advance: 'Аванс', interim: 'Междинно плащане', final: 'Окончателно плащане' };
const STAGE: Record<string, string> = { advance: 'Аванс', final: 'Доплащане' };
const ST: Record<string, string> = { paid: 'платено', reported: 'докладвано' };

function Similar({ rows, cur }: { rows: any[]; cur: string }) {
  return <div className="alert warn" style={{ gridColumn: '1 / -1' }}>Има подобно плащане по този обект:
    {rows.map(s => <div key={s.id} className="small">{s.code} · {fmtMoney(s.amount, cur)} · {fmtDate(s.tx_date)} · {ST[s.status] || s.status}{s.document_ref ? ' · ' + s.document_ref : ''}</div>)}</div>;
}

function VatField({ value, amount, onChange }: { value: string; amount: number; onChange: (v: string) => void }) {
  const p = Number(value), inside = value !== '' && p >= 0 && amount > 0 ? Math.round(amount * p / (100 + p) * 100) / 100 : null;
  return <Field label="ДДС % в сумата (0 = без ДДС)"><input type="number" min="0" max="100" step="any" value={value} onChange={e => onChange(e.target.value)} />
    {inside != null && <span className="small muted">ДДС {fmtMoney(inside)} · без ДДС {fmtMoney(amount - inside)}</span>}</Field>;
}

/** url: where to post; choices: what is being paid; report: the server decides by rights, this only sets the wording. */
export function PaymentForm({ title, url, dateKey = 'tx_date', report, choices, fixed, amount, vat, onClose, onDone }: {
  title: string; url: string; dateKey?: string; report: boolean; choices?: { value: string; label: string; body: any; amount: number }[]; fixed?: any; amount?: number; vat?: { last: number | null }; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const cur = useCurrency();
  const [uid] = useState(() => crypto.randomUUID());
  const [similar, setSimilar] = useState<any[] | null>(null);
  const f = useForm({ choice: choices?.[0]?.value || '', amount: String(choices?.[0]?.amount ?? amount ?? ''), date: '', note: '', vat: vat?.last == null ? '' : String(vat.last) });
  const pick = (v: string) => { const c = choices?.find(x => x.value === v); f.setV({ ...f.v, choice: v, amount: c ? String(c.amount) : f.v.amount }); setSimilar(null); };
  const save = (separate: boolean) => run(async () => {
    try {
      await api.post(url, { uid, ...(fixed || {}), ...(choices?.find(c => c.value === f.v.choice)?.body || {}), amount: Number(f.v.amount), [dateKey]: f.v.date, ...(vat ? { vat_pct: f.v.vat } : {}), note: f.v.note || undefined, separate });
      onDone(); onClose();
    } catch (e: any) { if (e?.data?.similar) setSimilar(e.data.similar); throw e; }
  }, report ? 'Плащането е докладвано — чака потвърждение от Счетоводство' : 'Плащането е записано');
  const ok = Number(f.v.amount) > 0 && f.v.date && (!vat || f.v.vat !== '');
  return <Modal title={title} onClose={onClose} footer={<><button onClick={onClose}>Отказ</button>
    {similar ? <button className="primary" disabled={busy || !ok} onClick={() => save(true)}>Отделно плащане — запиши</button>
      : <button className="primary" disabled={busy || !ok} onClick={() => save(false)}>{report ? 'Докладвай' : 'Запиши'}</button>}</>}>
    <div className="form c2">
      {choices && <Field label="Какво се плаща" full><select value={f.v.choice} onChange={e => pick(e.target.value)}>{choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>}
      <Field label={`Сума с ДДС, ${cur}`}><input type="number" min="0" step="0.01" value={f.v.amount} onChange={e => { f.set('amount', e.target.value); setSimilar(null); }} /></Field>
      <Field label="Дата по банка"><input type="date" max={today()} value={f.v.date} onChange={e => { f.set('date', e.target.value); setSimilar(null); }} /></Field>
      {vat && <VatField value={f.v.vat} amount={Number(f.v.amount)} onChange={v => f.set('vat', v)} />}
      <Field label="Бележка" full><input {...f.bind('note')} /></Field>
      {report && <div className="muted small" style={{ gridColumn: '1 / -1' }}>Сумите и сроковете се променят едва след потвърждение от Счетоводство.</div>}
      {similar && <Similar rows={similar} cur={cur} />}
    </div>
  </Modal>;
}

export const milestoneChoices = (payments: any[]) => payments.filter(p => p.id && p.gross !== 0).map(p => ({ value: String(p.id), label: `${p.label || MILESTONE[p.kind] || p.kind}${p.paid_at ? ' (платено)' : ''}`, body: { contract_payment_id: p.id }, amount: Math.max(0, Math.round(((p.gross || 0) - p.paid) * 100) / 100) }));
export const orderChoices = (o: any) => (['advance', 'final'] as const).map(s => ({ value: s, label: STAGE[s], body: { stage: s }, amount: Math.max(0, Math.round((((s === 'advance' ? o.advance_eur : o.final_eur) || 0) - ((s === 'advance' ? o.advance_paid_amount : o.final_paid_amount) || 0)) * 100) / 100) }));

export function ConfirmTab({ queue, onDone }: { queue: any; onDone: () => void }) {
  const { run, busy } = useAction();
  const can = useCan(), cur = useCurrency(), write = can('finance', 'write');
  const [sel, setSel] = useState<any | null>(null);
  const reject = (r: any) => { const reason = window.prompt('Причина за отхвърляне (вижда я докладвалият):'); if (reason?.trim()) run(async () => { await api.post(`/payments/${r.id}/reject`, { reason, row_version: r.row_version }); onDone(); }, 'Плащането е отхвърлено'); };
  const clear = (r: any) => { if (window.confirm(`Старата дата ${fmtDate(r.unmatched_date)} ще бъде изчистена. Плащане не се създава. Да продължа?`)) run(async () => { await api.post(`/payments/unmatched/${r.id}/clear`); onDone(); }, 'Датата е изчистена'); };
  return <Loader state={queue}>
    <Card title="Докладвани плащания" pad={false}><Table rows={queue.data?.reported || []} empty={<Empty title="Няма плащания за потвърждение" />} cols={[
      { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}</> },
      { key: 'for', title: 'За', render: (r: any) => r.order_code ? `${r.order_code} · ${STAGE[r.order_stage] || ''}` : r.proforma_code || r.milestone_label || MILESTONE[r.milestone_kind] || '—' },
      { key: 'direction', title: '', render: (r: any) => <span className="badge">{r.direction === 'in' ? 'приход' : 'разход'}</span> },
      { key: 'amount', title: `Сума с ДДС, ${cur}`, num: true, render: (r: any) => fmtMoney(r.amount) },
      { key: 'tx_date', title: 'Дата по банка', render: (r: any) => fmtDate(r.tx_date) },
      { key: 'by', title: 'Докладвал', render: (r: any) => <>{r.reported_by_name || '—'}<div className="small muted">{fmtDateTime(r.created_at)}</div></> },
      { key: 'sim', title: '', render: (r: any) => r.similar.length ? <span className="badge warn">подобно плащане</span> : null },
      { key: 'x', title: '', width: 190, render: (r: any) => write ? <span className="row" style={{ flexWrap: 'nowrap' }}><button className="sm primary" disabled={busy} onClick={() => setSel(r)}>Потвърди</button>
        <button className="sm ghost" disabled={busy} onClick={() => reject(r)}>Отхвърли</button></span> : null }]} /></Card>
    {(queue.data?.unmatched || []).length > 0 && <Card title="Стара дата без плащане" pad={false}><Table rows={queue.data.unmatched} cols={[
      { key: 'pj', title: 'Обект', render: (r: any) => <>{r.project_code} — {r.project_name}</> }, { key: 'kind', title: 'Етап', render: (r: any) => r.label || MILESTONE[r.kind] || r.kind },
      { key: 'gross', title: `Сума с ДДС, ${cur}`, num: true, render: (r: any) => fmtMoney(r.gross) }, { key: 'unmatched_date', title: 'Въведена дата', render: (r: any) => fmtDate(r.unmatched_date) },
      { key: 'x', title: '', width: 300, render: (r: any) => write ? <span className="row" style={{ flexWrap: 'nowrap' }}><button className="sm primary" onClick={() => setSel({ unmatched: r })}>Запиши плащане</button><button className="sm ghost" disabled={busy} onClick={() => clear(r)}>Изчисти датата</button></span> : null }]} /></Card>}
    {sel?.unmatched && <PaymentForm title={`Плащане — ${sel.unmatched.project_code}`} url={`/projects/${sel.unmatched.project_id}/payments`} report={false} fixed={{ contract_payment_id: sel.unmatched.id }} amount={sel.unmatched.gross ?? undefined} onClose={() => setSel(null)} onDone={onDone} />}
    {sel && !sel.unmatched && <ConfirmModal r={sel} onClose={() => setSel(null)} onDone={onDone} />}
  </Loader>;
}

function ConfirmModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const cur = useCurrency();
  const [similar, setSimilar] = useState<any[]>(r.similar || []);
  const order = r.supplier_order_id != null;
  const f = useForm({ amount: String(r.amount), date: r.tx_date, vat: String(r.vat_pct ?? 0) });
  const confirm = (separate: boolean) => run(async () => {
    try { await api.post(`/payments/${r.id}/confirm`, { amount: Number(f.v.amount), tx_date: f.v.date, ...(order ? { vat_pct: f.v.vat } : {}), separate, row_version: r.row_version }); onDone(); onClose(); }
    catch (e: any) { if (e?.data?.similar) setSimilar(e.data.similar); throw e; }
  }, 'Плащането е потвърдено');
  const merge = (into: any) => run(async () => { await api.post(`/payments/${r.id}/merge`, { into: into.id, row_version: r.row_version }); onDone(); onClose(); }, `Обединено с ${into.code}`);
  return <Modal title={`Потвърждаване на ${r.code}`} onClose={onClose} footer={<><button onClick={onClose}>Отказ</button>
    {similar.map(s => <button key={s.id} disabled={busy} onClick={() => merge(s)}>Същото като {s.code}</button>)}
    <button className="primary" disabled={busy || !(Number(f.v.amount) > 0) || !f.v.date || (order && f.v.vat === '')} onClick={() => confirm(similar.length > 0)}>{similar.length ? 'Отделно плащане — потвърди' : 'Потвърди'}</button></>}>
    <div className="form c2"><Field label={`Сума с ДДС, ${cur}`}><input type="number" min="0" step="0.01" value={f.v.amount} onChange={e => { f.set('amount', e.target.value); setSimilar([]); }} /></Field>
      <Field label="Дата по банка"><input type="date" max={today()} value={f.v.date} onChange={e => { f.set('date', e.target.value); setSimilar([]); }} /></Field>
      {order && <VatField value={f.v.vat} amount={Number(f.v.amount)} onChange={v => f.set('vat', v)} />}
      {similar.length > 0 && <Similar rows={similar} cur={cur} />}</div>
  </Modal>;
}

export const useQueue = (on: boolean) => useLoad<any>(on ? '/payments/queue' : null);
