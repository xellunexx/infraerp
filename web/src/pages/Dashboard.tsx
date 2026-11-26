import React from 'react';
import { fmtDateTime, fmtMoney } from '../api';
import { Card, DeptBadge, Empty, Link, Loader, Progress, Status, Table, navigate, useCan, useCurrency, useLoad, useUser } from '../ui';

/** Role-aware start page. Each role sees the queues it is responsible for; figures come from the shared records. */
export function Dashboard() {
  const user = useUser();
  const can = useCan();
  const cur = useCurrency();
  const dash = useLoad<any>(can('projects') ? '/dashboard' : null);
  const offers = useLoad<any[]>(can('offers') ? '/offers' : null);
  const contracts = useLoad<any[]>(can('contracts') ? '/contracts' : null);
  const notes = useLoad<any[]>('/notifications');
  const openOffers = (offers.data || []).filter(o => ['draft', 'sent'].includes(o.status));
  const pendingContracts = (contracts.data || []).filter(c => c.status !== 'signed');
  return <>
    <div className="page-head"><div><h1>Табло</h1><div className="muted small">{user.full_name} · <DeptBadge code={user.department} /></div></div></div>
    {can('projects') && <Loader state={dash}><div className="grid g3" style={{ marginBottom: 14 }}>
      {[['executing', 'В изпълнение'], ['upcoming', 'Предстоящи'], ['negotiating', 'В договаряне']].map(([k, label]) =>
        <Card key={k} pad={false} title={`${label} (${(dash.data?.[k] || []).length})`} actions={<Link to={`/projects?stage=${k}`}>Всички →</Link>}><Table rows={(dash.data?.[k] || []).slice(0, 8)} onRow={r => navigate(`/projects/${r.id}`)}
          empty={<Empty title="Няма обекти" />} cols={[
            { key: 'code', title: '№ / Обект', render: (r: any) => <>{r.code} — {r.name}<div className="small muted">{r.customer_name}</div></> },
            { key: 'progress_pct', title: '%', render: (r: any) => <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.progress_pct} /><span className="small">{r.progress_pct}%</span></div> },
            { key: 'x', title: '', render: (r: any) => r.awaiting_advance ? <span className="badge warn">чака аванс</span> : k === 'executing' ? <span className="badge ok">в работа</span> : null }]} /></Card>)}
    </div></Loader>}
    <div className="grid g2">
      <Card pad={false} title="Последни известия" actions={<Link to="/notifications">Всички</Link>}><Loader state={notes}>
        <Table rows={(notes.data || []).slice(0, 8)} onRow={r => r.link && navigate(r.link)} empty={<Empty title="Няма известия" />} cols={[
          { key: 'created_at', title: 'Кога', render: r => fmtDateTime(r.created_at), width: 120 },
          { key: 'title', title: 'Известие', render: r => <span style={{ fontWeight: r.is_read ? 400 : 650 }}>{r.title}{r.author_name ? <span className="muted small"> · {r.author_name}</span> : null}</span> }]} /></Loader></Card>
      {can('offers') && <Card pad={false} title="Оферти в работа" actions={<Link to="/offers">Всички</Link>}><Loader state={offers}>
        <Table rows={openOffers.slice(0, 8)} onRow={r => navigate(`/offers/${r.id}`)} empty={<Empty title="Няма отворени оферти" />} cols={[
          { key: 'code', title: '№' }, { key: 'title', title: 'Обект' }, { key: 'customer_name', title: 'Клиент' }, { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> },
          { key: 'total', title: cur, num: true, render: r => fmtMoney(r.total) }]} /></Loader></Card>}
      {can('contracts') && <Card pad={false} title="Договори за действие" actions={<Link to="/contracts">Всички</Link>}><Loader state={contracts}>
        <Table rows={pendingContracts.slice(0, 8)} onRow={r => navigate(`/projects/${r.project_id}?tab=contract`)} empty={<Empty title="Няма договори за действие" />} cols={[
          { key: 'code', title: '№' }, { key: 'project_name', title: 'Обект' }, { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> }]} /></Loader></Card>}
    </div>
  </>;
}