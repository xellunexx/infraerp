import React, { useState } from 'react';
import { fmtDate, fmtMoney } from '../api';
import { Card, Empty, Loader, Progress, Status, Table, Tabs, navigate, useCan, useCurrency, useFilter, useLoad, usePath } from '../ui';

const STAGES: [string, string][] = [['', 'Всички'], ['negotiating', 'В договаряне'], ['upcoming', 'Предстоящи'], ['executing', 'В изпълнение']];

export function Projects() {
  const [showArchived, setShowArchived] = useState(false);
  const list = useLoad<any[]>(showArchived ? '/projects?archived=1' : '/projects');
  const cur = useCurrency(), money = useCan()('finance');
  const [q, setQ] = useState('');
  const path = usePath();
  const [stage, setStage] = useState(new URLSearchParams(path.split('?')[1] || '').get('stage') || '');
  React.useEffect(() => { setStage(new URLSearchParams(path.split('?')[1] || '').get('stage') || ''); }, [path]);
  const rows = useFilter((list.data || []).filter(r => !stage || r.stage === stage), q, r => [r.code, r.name, r.customer_name, r.site_address, r.technical_name, r.brigadier_name].join(' '));
  return <>
    <div className="page-head"><h1>{showArchived ? 'Обекти — архив' : 'Обекти'}</h1><span className="spacer" />
      <button className={showArchived ? 'sm primary' : 'sm ghost'} onClick={() => setShowArchived(v => !v)}>Архив</button>
      <input style={{ maxWidth: 260 }} placeholder="Филтър" value={q} onChange={e => setQ(e.target.value)} /></div>
    {!showArchived && <Tabs value={stage} onChange={setStage} tabs={STAGES.map(([k, l]) => [k, k ? `${l} (${(list.data || []).filter(r => r.stage === k).length})` : l] as [string, string])} />}
    <Card pad={false}><Loader state={list}>
      <Table rows={rows} onRow={r => navigate(`/projects/${r.id}`)}
        empty={<Empty title="Няма обекти">Обект (Картон на обекта) се създава автоматично при потвърдена оферта.</Empty>} cols={[
          { key: 'code', title: '№', width: 120 }, { key: 'name', title: 'Обект' }, { key: 'customer_name', title: 'Клиент' }, { key: 'site_address', title: 'Адрес' },
          { key: 'status', title: 'Статус', render: r => <Status value={r.status} /> },
          { key: 'progress_pct', title: 'Изпълнение', width: 150, render: r => <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.progress_pct} /><span className="small num" style={{ width: 44 }}>{r.progress_pct}%</span></div> },
          ...(money ? [{ key: 'contract_value', title: `Стойност, ${cur}`, num: true, render: (r: any) => r.contract_value == null ? '—' : <>{fmtMoney(r.contract_value)}<div className="small muted">себ. {fmtMoney(r.cost_price)}</div></> } as any] : []),
          { key: 'technical_name', title: 'Техник' }, { key: 'brigadier_name', title: 'Бригадир' },
          { key: 'planned_start', title: 'Начало', render: r => fmtDate(r.planned_start) }, { key: 'planned_end', title: 'Край', render: r => fmtDate(r.planned_end) },
          { key: 'critical_issues', title: 'Критични', num: true, render: r => r.critical_issues ? <span className="badge bad">{r.critical_issues}</span> : '—' }]} />
    </Loader></Card>
  </>;
}