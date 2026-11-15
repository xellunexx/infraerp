import React, { useMemo, useState } from 'react';
import { api, fmtDate, fmtDateTime, fmtNum } from '../api';
import { Card, Empty, Field, Loader, Table, useLoad } from '../ui';

const cell = (v: any, type?: string) => {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'date') return fmtDate(v);
  if (type === 'datetime') return fmtDateTime(v);
  if (type === 'link' && typeof v === 'string' && v.startsWith('/')) return <a href={v} onClick={e => { e.preventDefault(); window.history.pushState(null, '', v); window.dispatchEvent(new PopStateEvent('popstate')); }}>{v}</a>;
  if (typeof v === 'number') return fmtNum(v, Number.isInteger(v) ? 0 : 2);
  return String(v);
};

function csvDownload(name: string, cols: any[], rows: any[]) {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const txt = [cols.map(c => esc(c.label)).join(';'), ...rows.map(r => cols.map(c => esc(r[c.key])).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
  a.download = name + '.csv'; a.click(); URL.revokeObjectURL(a.href);
}

function ReportTable({ title, cols, rows }: { title?: string; cols: any[]; rows: any[] }) {
  return <Card title={title} pad={false} actions={rows.length ? <button className="sm" onClick={() => csvDownload(title || 'report', cols, rows)}>CSV</button> : undefined}>
    <Table rows={rows} empty={<Empty title="Няма данни" />} cols={cols.map(c => ({ key: c.key, title: c.label, num: c.num, render: (r: any) => cell(r[c.key], c.type) }))} />
  </Card>;
}

export function Reports() {
  const defs = useLoad<any[]>('/reports');
  const projects = useLoad<any[]>('/projects');
  const [id, setId] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const def = (defs.data || []).find(d => d.id === id);
  const projOpts = useMemo(() => (projects.data || []).map((p: any) => [String(p.id), `${p.code} — ${p.name}`]), [projects.data]);
  const run = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
      setResult(await api.get(`/reports/${id}${qs ? '?' + qs : ''}`));
    } catch (e: any) { setError(e.message || 'Грешка'); } finally { setBusy(false); }
  };
  return <>
    <div className="page-head"><h1>Справки</h1><span className="spacer" /></div>
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14, alignItems: 'start' }}>
      <Card title="Отчет" pad={false}>
        <div style={{ maxHeight: '70vh', overflow: 'auto' }}>{(defs.data || []).map(d =>
          <div key={d.id} onClick={() => { setId(d.id); setParams({}); setResult(null); setError(''); }}
            style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: id === d.id ? 'var(--accent-soft, rgba(37,99,235,.08))' : undefined }}>
            <b>{d.title}</b><div className="muted small">{d.desc}</div></div>)}
          {defs.data && !defs.data.length && <div className="empty">Няма налични справки.</div>}</div>
      </Card>
      <div>
        {def && <Card title={def.title} actions={<button className="primary" disabled={busy} onClick={run}>{busy ? '...' : 'Стартирай'}</button>}>
          <div className="form c3">
            {(def.params || []).map((p: any) => <Field key={p.key} label={p.label}>
              {p.type === 'select' ? <select value={params[p.key] || ''} onChange={e => setParams(x => ({ ...x, [p.key]: e.target.value }))}>
                {p.key === 'entity' && <option value="">— изберете —</option>}
                {(p.options || []).map((o: any) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
              </select>
              : p.type === 'project' ? <select value={params[p.key] || ''} onChange={e => setParams(x => ({ ...x, [p.key]: e.target.value }))}>
                <option value="">— всички —</option>{projOpts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
              : <input type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'} value={params[p.key] || ''}
                  onChange={e => setParams(x => ({ ...x, [p.key]: e.target.value }))} />}
            </Field>)}
            {!def.params?.length && <div className="muted small">Този отчет няма параметри — натиснете „Стартирай“.</div>}
          </div>
          {error && <div className="alert" style={{ marginTop: 8 }}>{error}</div>}
        </Card>}
        {result && <div style={{ marginTop: 14 }}>
          <ReportTable title={result.title} cols={result.cols} rows={result.rows || []} />
          {(result.sections || []).map((s: any, i: number) => <div key={i} style={{ marginTop: 14 }}><ReportTable title={s.title} cols={s.cols} rows={s.rows || []} /></div>)}
        </div>}
        {!def && <Card><div className="empty"><b>Изберете отчет отляво</b>Всеки отчет отговаря на operational въпрос — забавяне, план vs факт, изключения, пари, присъствие.</div></Card>}
      </div>
    </div>
  </>;
}
