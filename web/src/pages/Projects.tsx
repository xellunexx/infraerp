import React, { useState } from 'react';
import { fmtDate, fmtMoney } from '../api';
import { Card, Empty, Loader, Progress, Status, Table, navigate, useCan, useCurrency, useFilter, useLoad } from '../ui';

export function Projects() {
  const list = useLoad<any[]>('/projects');
  const can = useCan();
  const cur = useCurrency();
  const [q, setQ] = useState('');
  const rows = useFilter(list.data, q, r => [r.code, r.name, r.customer_name, r.site_address, r.technical_name, r.brigadier_name].join(' '));
  return <>
    <div className="page-head"><h1>Обекти</h1><span className="spacer" /><input style={{ maxWidth: 260 }} placeholder="Филтър" value={q} onChange={e => setQ(e.target.value)} /></div>
    <Card pad={false}><Loader state={list}>
      <Table rows={rows} onRow={r => navigate(`/projects/${r.id}`)}
        empty={<Empty title="Няма обекти">Обект (Картон на обекта) се създава автоматично при потвърдена оферта.</Empty>} cols={[
          { key: 'code', title: '№', width: 120 }, { key: 'name', title: 'Обект' }, { key: 'customer_name', title: 'Клиент' }, { key: 'site_address', title: 'Адрес' },
          { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> },
          { key: 'progress_pct', title: 'Изпълнение', width: 150, render: r => <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.progress_pct} /><span className="small num" style={{ width: 44 }}>{r.progress_pct}%</span></div> },
          { key: 'technical_name', title: 'Техник' }, { key: 'brigadier_name', title: 'Бригадир' },
          { key: 'planned_start', title: 'Начало', render: r => fmtDate(r.planned_start) }, { key: 'planned_end', title: 'Край', render: r => fmtDate(r.planned_end) },
          ...(can('finance') ? [{ key: 'contract_value', title: `Договор, ${cur}`, num: true, render: (r: any) => fmtMoney(r.contract_value) }] : []),
          { key: 'critical_issues', title: 'Критични', num: true, render: r => r.critical_issues ? <span className="badge bad">{r.critical_issues}</span> : '—' }]} />
    </Loader></Card>
  </>;
}