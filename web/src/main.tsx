import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, AuthState } from './api';
import { AuthCtx, Field, Link, RouterProvider, ToastProvider, navigate, useAction, useAuth, useForm, useLoad, usePath } from './ui';
import { Customers } from './pages/Customers';
import { Catalog } from './pages/Catalog';
import { Offers, OfferEditor } from './pages/Offers';
import { Contracts } from './pages/Contracts';
import { Projects } from './pages/Projects';
import { ProjectCard } from './pages/ProjectCard';
import { Notifications, Settings } from './pages/Admin';
import { Dashboard } from './pages/Dashboard';
import { Technical, TechnicalProject } from './pages/Technical';
import { Accounting } from './pages/Accounting';
import { Logistics } from './pages/Logistics';
import { Brigade, BrigadeProject } from './pages/Brigade';
import { Management } from './pages/Management';
import { ChangeRequests } from './pages/ChangeRequests';
import { Warehouse } from './pages/Warehouse';
import { Reports } from './pages/Reports';

type Nav = { to: string; label: string; res?: string; dept?: string; admin?: boolean };
const NAV: (Nav | null)[] = [
  { to: '/', label: 'Табло' }, { to: '/projects', label: 'Обекти', res: 'projects' }, null,
  { to: '/offers', label: 'Оферти', res: 'offers', dept: 'offers' }, { to: '/contracts', label: 'Договори', res: 'contracts', dept: 'contracts' },
  { to: '/technical', label: 'Техник', res: 'technical', dept: 'technical' }, { to: '/accounting', label: 'Счетоводство', res: 'finance', dept: 'accounting' },
  { to: '/warehouse', label: 'Склад', res: 'warehouse', dept: 'warehouse' }, { to: '/logistics', label: 'Логистика', res: 'logistics', dept: 'logistics' },
  { to: '/brigade', label: 'Бригадир', res: 'progress', dept: 'brigadier' }, { to: '/management', label: 'Управител', res: 'approvals', dept: 'management' }, null,
  { to: '/customers', label: 'Клиенти', res: 'customers' }, { to: '/catalog', label: 'Номенклатури', res: 'catalog' },
  { to: '/change-requests', label: 'Заявки' },
  { to: '/notifications', label: 'Известия' }, { to: '/reports', label: 'Справки', res: 'reports' }, { to: '/settings', label: 'Настройки', res: 'settings', admin: true },
];

function Soon({ title }: { title: string }) {
  return <><div className="page-head"><h1>{title}</h1></div><div className="card"><div className="empty"><b>Модулът още не е изграден</b>Предстои в следваща фаза. Виж списъка за изпълнение в „Настройки“.</div></div></>;
}

function Shell() {
  const { state, reload } = useAuth();
  const user = state.user!;
  const path = usePath().split('?')[0];
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('synchro-theme') || 'light');
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('synchro-theme', theme); }, [theme]);
  const notes = useLoad<any[]>('/notifications', [path]);
  const unread = (notes.data || []).filter(n => !n.is_read).length;
  const dept = state.departments.find(d => d.code === user.department);
  const [q, setQ] = useState('');
  const results = useLoad<any[]>(q.trim().length >= 2 ? '/search?q=' + encodeURIComponent(q.trim()) : null);
  const target: Record<string, (id: number) => string> = { project: id => `/projects/${id}`, offer: id => `/offers/${id}`, customer: () => '/customers', contract: () => '/contracts', product: () => '/catalog', smr: () => '/catalog' };
  const kindLabel: Record<string, string> = { project: 'Обект', offer: 'Оферта', customer: 'Клиент', contract: 'Договор', product: 'Продукт', smr: 'СМР' };
  const seg = path.split('/');
  let page: React.ReactNode;
  if (path === '/') page = <Dashboard />;
  else if (seg[1] === 'projects' && seg[2]) page = <ProjectCard id={Number(seg[2])} />;
  else if (seg[1] === 'projects') page = <Projects />;
  else if (seg[1] === 'offers' && seg[2]) page = <OfferEditor id={Number(seg[2])} />;
  else if (seg[1] === 'offers') page = <Offers />;
  else if (seg[1] === 'contracts') page = <Contracts />;
  else if (seg[1] === 'technical' && seg[2]) page = <TechnicalProject id={Number(seg[2])} />;
  else if (seg[1] === 'technical') page = <Technical />;
  else if (seg[1] === 'accounting') page = <Accounting />;
  else if (seg[1] === 'warehouse') page = <Warehouse />;
  else if (seg[1] === 'reports') page = <Reports />;
  else if (seg[1] === 'logistics') page = <Logistics />;
  else if (seg[1] === 'brigade' && seg[2]) page = <BrigadeProject id={Number(seg[2])} />;
  else if (seg[1] === 'brigade') page = <Brigade />;
  else if (seg[1] === 'management') page = <Management />;
  else if (seg[1] === 'customers') page = <Customers />;
  else if (seg[1] === 'catalog') page = <Catalog />;
  else if (seg[1] === 'change-requests') page = <ChangeRequests />;
  else if (seg[1] === 'notifications') page = <Notifications onChange={notes.reload} />;
  else if (seg[1] === 'settings') page = user.role === 'admin' ? <Settings /> : <div className="card"><div className="empty"><b>Само за администратори</b>Настройките, потребителите и правата се управляват единствено от администратор.</div></div>;
  else page = <Soon title={(NAV.find(n => n && n.to === '/' + seg[1]) as Nav | undefined)?.label || 'Страница'} />;

  return <div className="shell">
    <aside className={'side' + (open ? ' open' : '')}>
      <div className="brand">SYNCHRO<small>{state.settings.company_name || 'Оперативна платформа'}</small></div>
      <nav className="nav">{NAV.map((n, i) => {
        if (!n) return <div key={i} className="sep" />;
        if (n.admin && user.role !== 'admin') return null;
        if (n.res && !user.perms[n.res]?.read) return null;
        const c = state.departments.find(d => d.code === n.dept)?.color;
        const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
        return <Link key={n.to} to={n.to} className={active ? 'active' : ''} style={{ ['--c' as any]: c }} onClick={() => setOpen(false)}>
          <span className="dot" />{n.label}{n.to === '/notifications' && unread > 0 && <span className="count">{unread}</span>}</Link>;
      })}</nav>
      <div className="side-foot"><b>{user.full_name}</b>{dept?.name} · {user.role}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Светла тема' : 'Тъмна тема'}</button>
          <button className="sm" onClick={async () => { await api.post('/auth/logout'); await reload(); navigate('/'); }}>Изход</button>
        </div></div>
    </aside>
    <div className="main dept-bar" style={{ ['--dept' as any]: dept?.color }}>
      <div className="topbar">
        <button className="menu-btn sm" onClick={() => setOpen(o => !o)} aria-label="Меню">☰</button>
        <div className="search">
          <input placeholder="Търсене: обекти, клиенти, договори, оферти, продукти" value={q} onChange={e => setQ(e.target.value)} aria-label="Търсене" />
          {q.trim().length >= 2 && <div className="card" style={{ position: 'absolute', left: 0, right: 0, top: 38, zIndex: 30, maxHeight: 360, overflow: 'auto' }}>
            {(results.data || []).length === 0 ? <div className="empty">Няма резултати</div> : (results.data || []).map((r, i) =>
              <a key={i} style={{ display: 'block', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }} onClick={() => { setQ(''); navigate(target[r.kind](r.ref_id)); }}>
                <span className="badge">{kindLabel[r.kind]}</span> <b>{r.code}</b> {r.title} <span className="muted small">{r.body}</span></a>)}
          </div>}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <Link to="/notifications" className="muted">Известия{unread > 0 ? ` (${unread})` : ''}</Link>
      </div>
      <main className="content" onClick={() => open && setOpen(false)}>{page}</main>
    </div>
  </div>;
}

function Login({ setup }: { setup: boolean }) {
  const { reload } = useAuth();
  const f = useForm({ username: '', password: '', full_name: '', company_name: '' });
  const { run, busy } = useAction();
  const submit = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await api.post(setup ? '/auth/setup' : '/auth/login', f.v); await reload(); }); };
  return <div className="login"><form className="card" onSubmit={submit}><header><h2>SYNCHRO{setup ? ' — първоначална настройка' : ''}</h2></header>
    <div className="body form">
      {setup && <div className="alert">Системата е празна. Създайте първия администраторски акаунт; останалите служители се добавят от „Настройки“.</div>}
      {setup && <Field label="Фирма"><input {...f.bind('company_name')} /></Field>}
      {setup && <Field label="Име и фамилия"><input {...f.bind('full_name')} required /></Field>}
      <Field label="Потребителско име"><input {...f.bind('username')} required autoFocus autoComplete="username" /></Field>
      <Field label={setup ? 'Парола (поне 8 символа)' : 'Парола'}><input type="password" {...f.bind('password')} required minLength={setup ? 8 : 1} autoComplete={setup ? 'new-password' : 'current-password'} /></Field>
      <button className="primary" disabled={busy}>{setup ? 'Създай администратор' : 'Вход'}</button>
    </div></form></div>;
}

function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => { try { setState(await api.get<AuthState>('/auth/state')); setError(null); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { reload(); const f = () => reload(); window.addEventListener('synchro:unauthorized', f); return () => window.removeEventListener('synchro:unauthorized', f); }, [reload]);
  if (error) return <div className="login"><div className="alert bad">Няма връзка със сървъра: {error} <button className="sm" onClick={reload}>Опитай отново</button></div></div>;
  if (!state) return <div className="empty">Зареждане…</div>;
  return <AuthCtx.Provider value={{ state, reload }}>{state.user ? <Shell /> : <Login setup={state.needs_setup} />}</AuthCtx.Provider>;
}

createRoot(document.getElementById('root')!).render(<RouterProvider><ToastProvider><App /></ToastProvider></RouterProvider>);