import React from 'react';
import { fmtDateTime, fmtMoney } from '../api';
import { Card, DeptBadge, Empty, Kpi, Link, Loader, Progress, Status, Table, navigate, useCan, useCurrency, useLoad, useUser } from '../ui';

/** Role-aware start page. Each role sees the queues it is responsible for; figures come from the shared records. */
export function Dashboard() {
  const user = useUser();
  const can = useCan();
  const cur = useCurrency();
  const projects = useLoad<any[]>(can('projects') ? '/projects' : null);
  const offers = useLoad<any[]>(can('offers') ? '/offers' : null);
  const contracts = useLoad<any[]>(can('contracts') ? '/contracts' : null);
  const notes = useLoad<any[]>('/notifications');
  const active = (projects.data || []).filter(p => !['closed', 'completed'].includes(p.status));
  const openOffers = (offers.data || []).filter(o => ['draft', 'sent'].includes(o.status));
  const pendingContracts = (contracts.data || []).filter(c => c.status !== 'signed');
  const unread = (notes.data || []).filter(n => !n.is_read);
  const money = can('finance');
  return <>
    <div className="page-head"><div><h1>Табло</h1><div className="muted small">{user.full_name} · <DeptBadge code={user.department} /></div></div></div>
    <div className="grid g4 kpis-m" style={{ marginBottom: 14 }}>
      {can('projects') && <Kpi label="Активни обекти" value={active.length} />}
      {can('offers') && <Kpi label="Отворени оферти" value={openOffers.length} sub={money ? fmtMoney(openOffers.reduce((s, o) => s + (o.total || 0), 0), cur) : undefined} />}
      {can('contracts') && <Kpi label="Договори в работа" value={pendingContracts.length} tone={pendingContracts.length ? 'warn' : undefined} />}
      <Kpi label="Непрочетени известия" value={unread.length} tone={unread.length ? 'warn' : undefined} />
    </div>
    <div className="grid g2">
      {can('projects') && <Card pad={false} title="Обекти" actions={<Link to="/projects">Всички</Link>}><Loader state={projects}>
        <Table rows={active.slice(0, 8)} onRow={r => navigate(`/projects/${r.id}`)} empty={<Empty title="Няма активни обекти" />} cols={[
          { key: 'code', title: '№' }, { key: 'name', title: 'Обект' }, { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> },
          { key: 'progress_pct', title: 'Изпълнение', render: r => <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.progress_pct} /><span className="small">{r.progress_pct}%</span></div> }]} /></Loader></Card>}
      <Card pad={false} title="Последни известия" actions={<Link to="/notifications">Всички</Link>}><Loader state={notes}>
        <Table rows={(notes.data || []).slice(0, 8)} onRow={r => r.link && navigate(r.link)} empty={<Empty title="Няма известия" />} cols={[
          { key: 'created_at', title: 'Кога', render: r => fmtDateTime(r.created_at), width: 120 },
          { key: 'title', title: 'Известие', render: r => <span style={{ fontWeight: r.is_read ? 400 : 650 }}>{r.title}</span> }]} /></Loader></Card>
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