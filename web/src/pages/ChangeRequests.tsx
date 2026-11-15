import React, { useMemo, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { Card, Empty, Field, Loader, Modal, Status, Table, Tabs, useAction, useAuth, useLoad } from '../ui';

const KIND_LABEL: Record<string, string> = { edit: 'промяна', delete: 'изтриване' };
const DATE_RE = /(^|_)(date|on|from|to|start|end|deadline)$/;
const NUM_RE = /qty|amount|price|cost|pct|days|hours|beds|pallets|sort|version|latitude|longitude|norm|stock|advance|vat|discount|prelim|validity|labour|terms/i;
const BOOL_RE = /^(active|exceptional|palletized|archived|locked|voided|removed|paid)$/;

const val = (v: any) => v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'да' : 'не') : String(v);

function DiffTable({ detail }: { detail: any }) {
  const labels = useMemo(() => Object.fromEntries((detail.cols || []).map((c: any) => [c.key, c.label])), [detail.cols]);
  const payload = detail.payload || {};
  const cur = detail.current || {};
  const shown = detail.kind === 'delete' ? [] : Object.keys(payload);
  return <table className="t"><thead><tr><th>Поле</th><th>Сега</th><th>Предложено</th></tr></thead><tbody>
    {detail.kind === 'delete'
      ? <tr><td colSpan={3}>Заявка за <b>изтриване</b> на този запис.</td></tr>
      : shown.map(k => <tr key={k}><td>{labels[k] || k}</td><td className="muted">{val(cur[k])}</td><td><b>{val(payload[k])}</b></td></tr>)}
    {detail.kind !== 'delete' && !shown.length && <tr><td colSpan={3} className="muted">Няма предложени стойности — промената е описана в причината.</td></tr>}
  </tbody></table>;
}

function RequestModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const d = useLoad<any>(`/change-requests/${id}`);
  const { run, busy } = useAction();
  const { state } = useAuth();
  const isAdmin = state.user?.role === 'admin';
  const [note, setNote] = useState('');
  const r = d.data;
  const decide = (decision: string) => run(async () => {
    await api.post(`/change-requests/${id}/decide`, { decision, note: note || undefined });
    onDone(); onClose();
  }, decision === 'approve' ? 'Заявката е приложена' : 'Заявката е отказана');
  return <Modal wide title={r ? `Заявка ${r.code} — ${KIND_LABEL[r.kind] || r.kind} · ${r.entity_label || ''}` : 'Заявка'} onClose={onClose}
    footer={<>
      {r?.status === 'pending' && isAdmin && <>
        <input placeholder="Бележка към решението" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1 }} />
        <button className="danger" disabled={busy} onClick={() => decide('reject')}>Откажи</button>
        <button className="primary" disabled={busy} onClick={() => decide('approve')}>Одобри и приложи</button>
      </>}
      <button onClick={onClose}>Затвори</button>
    </>}>
    <Loader state={d}>{r && <>
      <dl className="dl">
        <dt>Вид</dt><dd>{KIND_LABEL[r.kind]} · {r.label}</dd>
        <dt>Заявил</dt><dd>{r.requester_name} · {fmtDateTime(r.created_at)}</dd>
        <dt>Статус</dt><dd><Status value={r.status} />{r.decider_name ? ` · ${r.decider_name}` : ''}{r.decided_at ? ` · ${fmtDateTime(r.decided_at)}` : ''}</dd>
        {r.decision_note && <><dt>Бележка</dt><dd>{r.decision_note}</dd></>}
        {r.entity_gone && <><dt>Внимание</dt><dd><span className="badge bad">Записът вече не съществува</span></dd></>}
      </dl>
      <h3 style={{ margin: '10px 0 6px' }}>Причина</h3><div className="body" style={{ whiteSpace: 'pre-wrap' }}>{r.reason}</div>
      <h3 style={{ margin: '10px 0 6px' }}>Запис и предложени промени</h3>
      <DiffTable detail={r} />
      {r.status !== 'pending' && r.result && <div className="muted small" style={{ marginTop: 8 }}>Приложено: {JSON.stringify(r.result)}</div>}
    </>}</Loader>
  </Modal>;
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const meta = useLoad<any[]>('/change-requests/meta');
  const [type, setType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [kind, setKind] = useState<'edit' | 'delete'>('edit');
  const [reason, setReason] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const entities = useLoad<any[]>(type ? `/change-requests/entities?type=${type}` : null);
  const { run, busy } = useAction();
  const ent = (meta.data || []).find((m: any) => m.type === type);
  const pickType = (t: string) => { setType(t); setEntityId(''); setVals({}); };
  const submit = () => run(async () => {
    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(vals)) {
      if (v === '') continue;
      payload[k] = BOOL_RE.test(k) ? v === '1' : NUM_RE.test(k) && !isNaN(Number(v)) && v !== '' ? Number(v) : v;
    }
    await api.post('/change-requests', { entity_type: type, entity_id: Number(entityId), kind, payload: kind === 'edit' ? payload : undefined, reason });
    setEntityId(''); setReason(''); setVals({}); onDone();
  }, 'Заявката е изпратена за преглед');
  const set = (k: string, v: string) => setVals(x => ({ ...x, [k]: v }));
  return <Card title="Нова заявка за промяна или изтриване">
    <div className="form c2">
      <Field label="Тип запис"><select value={type} onChange={e => pickType(e.target.value)}><option value="">— изберете —</option>
        {(meta.data || []).map((m: any) => <option key={m.type} value={m.type}>{m.label}</option>)}</select></Field>
      {type && <Field label={`${ent?.label} — запис`}><select value={entityId} onChange={e => setEntityId(e.target.value)}>
        <option value="">— изберете —</option>{(entities.data || []).map((r: any) => <option key={r.id} value={r.id}>{r.label}{r.sub ? ` · ${r.sub}` : ''}</option>)}</select></Field>}
      {entityId && <Field label="Какво заявявате"><select value={kind} onChange={e => setKind(e.target.value as any)}>
        <option value="edit">Промяна на полета</option><option value="delete">Изтриване на записа</option></select></Field>}
      {kind === 'edit' && entityId && (ent?.cols || []).map((c: any) => {
        const isBool = BOOL_RE.test(c.key), isNum = NUM_RE.test(c.key) && !DATE_RE.test(c.key);
        return <Field key={c.key} label={c.label}>
          {isBool
            ? <select value={vals[c.key] ?? ''} onChange={e => set(c.key, e.target.value)}><option value="">— без промяна —</option><option value="1">да</option><option value="0">не</option></select>
            : <input type={DATE_RE.test(c.key) ? 'date' : isNum ? 'number' : 'text'} step={isNum ? 'any' : undefined} value={vals[c.key] ?? ''}
                placeholder="празно = без промяна" onChange={e => set(c.key, e.target.value)} />}
        </Field>;
      })}
      {entityId && <Field label="Причина (защо е нужна промяната)" full><textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
      <div className="actions" style={{ gridColumn: '1 / -1' }}>
        <button className="primary" disabled={busy || !type || !entityId || !reason.trim()}
          onClick={submit}>Изпрати за одобрение</button>
        <span className="muted small">Заявката отива при администратор — нищо не се променя, докато не бъде одобрена. Ако не попълните полета, администраторът коригира ръчно и затваря заявката.</span>
      </div>
    </div>
  </Card>;
}

function CRTable({ rows, onRow }: { rows: any[]; onRow: (r: any) => void }) {
  return <Table rows={rows} onRow={onRow} empty={<Empty title="Няма заявки" />} cols={[
    { key: 'code', title: '№', width: 90 }, { key: 'entity_label', title: 'Запис', render: r => <span>{r.entity_label}{r.entity_gone ? ' ' : ''}{r.entity_gone && <span className="badge bad">липсва</span>}</span> },
    { key: 'kind', title: 'Вид', width: 100, render: r => <span className={'badge ' + (r.kind === 'delete' ? 'bad' : 'info')}>{KIND_LABEL[r.kind]}</span> },
    { key: 'reason', title: 'Причина', render: r => <span className="muted">{String(r.reason || '').slice(0, 90)}</span> },
    { key: 'requester_name', title: 'Заявил', width: 130 }, { key: 'created_at', title: 'Кога', width: 130, render: r => fmtDateTime(r.created_at) },
    { key: 'status', title: 'Статус', width: 110, render: r => <Status value={r.status} /> },
    { key: 'decider_name', title: 'Решил', width: 120, render: r => r.decider_name || '—' }]} />;
}

export function ChangeRequests() {
  const { state } = useAuth();
  const isAdmin = state.user?.role === 'admin';
  const [tab, setTab] = useState('new');
  const [open, setOpen] = useState<number | null>(null);
  const mine = useLoad<any[]>('/change-requests?scope=mine');
  const queue = useLoad<any[]>(isAdmin ? '/change-requests?scope=queue' : null);
  const all = useLoad<any[]>(isAdmin ? '/change-requests?scope=all' : null);
  const reloadAll = () => { mine.reload(); queue.reload(); all.reload(); };
  const tabs: [string, string][] = [['new', 'Нова заявка'], ['mine', 'Моите заявки'], ...(isAdmin ? [['queue', `Чакащи (${(queue.data || []).length})`], ['all', 'Всички']] as [string, string][] : [])];
  return <>
    <div className="page-head"><h1>Заявки за промяна</h1><span className="spacer" /><button className="sm" onClick={reloadAll}>Обнови</button></div>
    <Tabs tabs={tabs} value={tab} onChange={setTab} />
    {tab === 'new' && <RequestForm onDone={reloadAll} />}
    {tab === 'mine' && <Card pad={false}><Loader state={mine}><CRTable rows={mine.data || []} onRow={r => setOpen(r.id)} /></Loader></Card>}
    {tab === 'queue' && <Card pad={false}><Loader state={queue}><CRTable rows={queue.data || []} onRow={r => setOpen(r.id)} /></Loader></Card>}
    {tab === 'all' && <Card pad={false}><Loader state={all}><CRTable rows={all.data || []} onRow={r => setOpen(r.id)} /></Loader></Card>}
    {open && <RequestModal id={open} onClose={() => setOpen(null)} onDone={reloadAll} />}
  </>;
}
