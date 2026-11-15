import React, { useState } from 'react';
import { fmtDate, fmtMoney } from '../api';
import { Card, Empty, Loader, Status, Table, navigate, useCurrency, useFilter, useLoad } from '../ui';

export function Contracts() {
  const list = useLoad<any[]>('/contracts');
  const cur = useCurrency();
  const [q, setQ] = useState('');
  const rows = useFilter(list.data, q, r => [r.code, r.project_code, r.project_name, r.customer_name].join(' '));
  return <>
    <div className="page-head"><h1>Договори</h1><span className="spacer" /><input style={{ maxWidth: 260 }} placeholder="Филтър" value={q} onChange={e => setQ(e.target.value)} /></div>
    <Card pad={false}><Loader state={list}>
      <Table rows={rows} onRow={r => navigate(`/projects/${r.project_id}?tab=contract`)}
        empty={<Empty title="Няма договори">Договор се създава автоматично, когато клиентът потвърди оферта.</Empty>} cols={[
          { key: 'code', title: '№', width: 100 }, { key: 'project_code', title: 'Обект №' }, { key: 'project_name', title: 'Обект' }, { key: 'customer_name', title: 'Клиент' },
          { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> }, { key: 'active_version', title: 'Версия', render: r => r.active_version ? 'v' + r.active_version : 'проект' },
          { key: 'total', title: `Стойност без ДДС, ${cur}`, num: true, render: r => fmtMoney(r.total) },
          { key: 'install_start', title: 'Монтаж от', render: r => fmtDate(r.install_start) }, { key: 'install_deadline', title: 'Краен срок', render: r => fmtDate(r.install_deadline) },
          { key: 'signed_on', title: 'Подписан', render: r => fmtDate(r.signed_on) }]} />
    </Loader></Card>
  </>;
}