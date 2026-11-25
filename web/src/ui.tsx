// Shared UI building blocks: tiny router, data loading hook, toasts, modal, form fields, table, badges.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, AuthState, Dept, User, api } from './api';

// ---- router (history API, no dependency)
const PathCtx = createContext<string>('/');
export function navigate(to: string) { window.history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }
export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => { const f = () => setPath(window.location.pathname + window.location.search); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f); }, []);
  return <PathCtx.Provider value={path}>{children}</PathCtx.Provider>;
}
export const usePath = () => useContext(PathCtx);
export function Link({ to, children, className, style, onClick }: { to: string; children: React.ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void }) {
  return <a href={to} className={className} style={style} onClick={e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); onClick?.(); navigate(to); }}>{children}</a>;
}

// ---- session
export const AuthCtx = createContext<{ state: AuthState; reload: () => Promise<void> }>(null as any);
export const useAuth = () => useContext(AuthCtx);
export const useUser = (): User => useContext(AuthCtx).state.user as User;
export const useCan = () => { const u = useUser(); return (res: string, action: 'read' | 'write' | 'approve' = 'read') => !!u?.perms?.[res]?.[action]; };
export const useDept = (code?: string | null): Dept | undefined => useContext(AuthCtx).state.departments.find(d => d.code === code);
export const useCurrency = () => useContext(AuthCtx).state.settings.currency || 'EUR';

// ---- data loading
export function useLoad<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) { setData(null); setLoading(false); return; }
    const n = ++seq.current;
    try { const d = await api.get<T>(url); if (n === seq.current) { setData(d); setError(null); } }
    catch (e: any) { if (n === seq.current) setError(e.message); }
    finally { if (n === seq.current) setLoading(false); }
  }, [url]);
  useEffect(() => { setLoading(!!url); reload(); }, [reload, ...deps]);
  return { data, error, loading, reload, setData };
}
export function Loader({ state, children }: { state: { data: any; error: string | null; loading: boolean }; children: React.ReactNode }) {
  if (state.error) return <div className="alert bad">{state.error}</div>;
  if (state.loading && state.data == null) return <div className="empty">Зареждане…</div>;
  return <>{children}</>;
}

/** A page that fails to render must not take the menu down with it; leaving the page (resetKey) clears the failure. */
export class ErrorBoundary extends React.Component<{ resetKey: string; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  render() {
    return this.state.error ? <div className="alert bad">Страницата не може да се покаже: {this.state.error.message} <button className="sm" onClick={() => this.setState({ error: null })}>Опитай отново</button></div> : this.props.children;
  }
}

// ---- toasts
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad = false) => { const id = Date.now() + Math.random(); setItems(x => [...x, { id, text, bad }]); setTimeout(() => setItems(x => x.filter(t => t.id !== id)), bad ? 7000 : 3500); }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status">{items.map(t => <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>{t.text}</div>)}</div></ToastCtx.Provider>;
}
/** Run an action, show the server's message on failure. Returns true on success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true);
    try { await fn(); if (okText) toast(okText); return true; }
    catch (e: any) { toast(e instanceof ApiError ? e.message : 'Неуспешна операция: ' + (e?.message || e), true); return false; }
    finally { setBusy(false); }
  }, [toast]);
  return { run, busy };
}

// ---- layout pieces
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [onClose]);
  return <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="ghost sm" onClick={onClose} aria-label="Затвори">✕</button></header>
      <div className="body">{children}</div>{footer && <footer>{footer}</footer>}
    </div></div>;
}
export function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <label className={'field' + (full ? ' full' : '')}><span>{label}</span>{children}</label>;
}
export function Card({ title, actions, children, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; pad?: boolean }) {
  return <section className="card">{(title || actions) && <header><h2>{title}</h2><span className="spacer" />{actions}</header>}<div className={pad ? 'body' : ''}>{children}</div></section>;
}
export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  return <div className={'kpi ' + (tone || '')}><div className="label">{label}</div><div className="value">{value}</div>{sub != null && <div className="sub">{sub}</div>}</div>;
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) { return <div className="empty"><b>{title}</b>{children}</div>; }
export function Progress({ pct, tone }: { pct: number; tone?: 'warn' | 'bad' }) { return <div className={'progress ' + (tone || '')} title={pct + '%'}><i style={{ width: Math.max(0, Math.min(100, pct)) + '%' }} /></div>; }
export function DeptBadge({ code }: { code?: string | null }) { const d = useDept(code); return d ? <span className="badge dept" style={{ ['--c' as any]: d.color }}>{d.name}</span> : null; }

const STATUS: Record<string, [string, string]> = {
  draft: ['Проект', ''], sent: ['Изпратена', 'info'], confirmed: ['Потвърдена', 'ok'], rejected: ['Отказана', 'bad'], superseded: ['Заменена', ''],
  review: ['За одобрение', 'warn'], approved: ['Одобрен', 'info'], signed: ['Подписан', 'ok'],
  contract_pending: ['Очаква договор', 'warn'], preparation: ['Подготовка', 'info'], execution: ['Изпълнение', 'ok'], completed: ['Завършен', 'ok'], closed: ['Закрит', ''], on_hold: ['Спрян', 'bad'],
  pending: ['Чака', 'warn'], processing: ['Обработва се', 'info'], processed: ['Обработено', 'ok'], failed: ['Неуспешно', 'bad'],
  open: ['Отворено', 'warn'], offered: ['С оферта', 'info'], in_progress: ['В работа', 'info'], done: ['Готово', 'ok'], cancelled: ['Отменено', ''], active: ['Активен', 'info'], skipped: ['Пропуснат', ''],
  submitted: ['Подадена', 'warn'], reserved: ['Резервирана', 'ok'], partial: ['Частично налична', 'warn'], to_purchase: ['За закупуване', 'bad'], issued: ['Издадена', 'info'], fulfilled: ['Изпълнена', 'ok'],
  planned: ['Планирана', ''], in_transit: ['На път', 'info'], delivered: ['Доставена', 'ok'], delayed: ['Закъснява', 'bad'], paid: ['Платено', 'ok'], committed: ['Задължение', 'warn'], resolved: ['Решено', 'ok'],
  ordered: ['Поръчана', ''], in_production: ['В производство', 'info'],
};
export function Status({ value }: { value?: string | null }) { if (!value) return null; const s = STATUS[value] || [value, '']; return <span className={'badge ' + s[1]}>{s[0]}</span>; }
export const statusLabel = (v: string) => (STATUS[v] || [v])[0];

export type Col<T> = { key: string; title: string; num?: boolean; render?: (row: T) => React.ReactNode; width?: number | string };
export function Table<T extends Record<string, any>>({ cols, rows, onRow, empty, foot }: { cols: Col<T>[]; rows: T[]; onRow?: (r: T) => void; empty?: React.ReactNode; foot?: React.ReactNode }) {
  if (!rows.length) return <>{empty ?? <Empty title="Няма записи" />}</>;
  return <div className="table-wrap"><table className="t"><thead><tr>{cols.map(c => <th key={c.key} className={c.num ? 'num' : ''} style={{ width: c.width }}>{c.title}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={r.id ?? i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>
      {cols.map(c => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}</tr>)}</tbody>{foot && <tfoot>{foot}</tfoot>}</table></div>;
}
export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <nav className="tabs">{tabs.map(([k, label]) => <a key={k} className={k === value ? 'active' : ''} onClick={() => onChange(k)}>{label}</a>)}</nav>;
}
/** Controlled form state with a setter per field. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const bind = (k: keyof T) => ({ value: v[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV(x => ({ ...x, [k]: e.target.value })) });
  return { v, setV, bind, set: (k: keyof T, val: any) => setV(x => ({ ...x, [k]: val })) };
}

// ---- document versions: every file keeps its history; new versions are appended, never overwritten
export function VersionLinks({ doc }: { doc: any }) {
  const vs: any[] = doc?.versions || [];
  if (!vs.length) return null;
  return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{vs.map((v: any) =>
    <a key={v.id} href={`/api/documents/${v.id}/file`} target="_blank" rel="noreferrer" className={'badge' + (v.version === doc.current_version ? ' ok' : '')} title={`${v.filename} · ${v.created_at?.slice(0, 16).replace('T', ' ')}`}>v{v.version}</a>)}</span>;
}
export function NewVersionButton({ doc, onDone, disabled }: { doc: any; onDone: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  return <>
    <input ref={ref} type="file" style={{ display: 'none' }} onChange={e => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      run(async () => {
        const fd = new FormData(); fd.append('file', f);
        const res = await fetch(`/api/documents/${doc.id}/versions`, { method: 'POST', credentials: 'same-origin', body: fd });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Грешка ${res.status}`);
        onDone();
      }, `Качена е версия ${(doc.current_version || 1) + 1}`);
    }} />
    <button className="sm ghost" disabled={disabled || busy} title="Качи нова версия на файла — старата се пази" onClick={e => { e.stopPropagation(); ref.current?.click(); }}>+ версия</button>
  </>;
}
export const useFilter = <T,>(rows: T[] | null, q: string, text: (r: T) => string) => useMemo(() => { const s = q.trim().toLowerCase(); return (rows || []).filter(r => !s || text(r).toLowerCase().includes(s)); }, [rows, q]);