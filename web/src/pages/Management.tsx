// Управител: портфолио табло — KPI, опашки за внимание, парични показатели по обекти, натоварване по отдели.
import React from 'react';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../api';
import { Card, DeptBadge, Empty, Kpi, Link, Loader, Progress, Status, Table, navigate, useCurrency, useLoad } from '../ui';

const PRI: Record<string, string> = { low: 'нисък', normal: 'нормален', high: 'висок', urgent: 'спешен' };
const KIND: Record<string, string> = { problem: 'Проблем', delay: 'Закъснение', material_shortage: 'Липса на материал', damage: 'Повреда', additional_work: 'Допълнителна работа', other: 'Друго' };
const SEV: Record<string, [string, string]> = { low: ['нисък', ''], medium: ['среден', 'warn'], high: ['висок', 'bad'], critical: ['критичен', 'bad'] };

export function Management() {
  const m = useLoad<any>('/management');
  const cur = useCurrency();
  const d = m.data;
  if (!d) return <Loader state={m}><div /></Loader>;
  const k = d.kpis || {};
  const money = k.contract_value != null;
  return <>
    <div className="page-head"><h1>Управител</h1><span className="muted small">Портфолио, пари и какво изисква внимание</span></div>
    <div className="grid g4 kpis-m" style={{ marginBottom: 14 }}>
      <Kpi label="Активни обекти" value={k.active_projects ?? 0} />
      {money && <Kpi label={`Договорна стойност, ${cur}`} value={fmtMoney(k.contract_value, cur)} />}
      {money && <Kpi label={`Вземания, ${cur}`} value={fmtMoney(k.receivables, cur)} tone={k.receivables > 0 ? 'warn' : undefined} />}
      {money && <Kpi label={`Плащания, ${cur}`} value={fmtMoney(k.payables, cur)} />}
      {money && <Kpi label={`Резултат до момента, ${cur}`} value={fmtMoney(k.result_to_date, cur)} />}
      {money && <Kpi label={`Прогноза, ${cur}`} value={fmtMoney(k.forecast_result, cur)} />}
      <Kpi label="Изисква одобрение" value={k.pending_approvals ?? 0} tone={k.pending_approvals ? 'warn' : undefined} />
      <Kpi label="Закъснели задачи" value={k.overdue_tasks ?? 0} tone={k.overdue_tasks ? 'warn' : undefined} />
      <Kpi label="Критични проблеми" value={k.critical_issues ?? 0} tone={k.critical_issues ? 'bad' : undefined} />
      <Kpi label="Неуспешна синхронизация" value={k.failed_events ?? 0} tone={k.failed_events ? 'bad' : undefined} />
      <Kpi label="Доставки в път" value={k.in_transit ?? 0} />
    </div>

    <div className="grid c2" style={{ marginBottom: 14 }}>
      <Card pad={false} title="Изисква одобрение" actions={<Link to="/accounting">Счетоводство</Link>}>
        <Table rows={d.attention.approvals.slice(0, 10)} empty={<Empty title="Нищо за одобрение" />} cols={[
          { key: 'title', title: 'Заявка', render: (r: any) => <span style={{ fontWeight: 600 }}>{r.title}</span> },
          { key: 'project_code', title: 'Обект', render: (r: any) => r.project_code || '—' },
          { key: 'amount', title: cur, num: true, render: (r: any) => r.amount != null ? fmtMoney(r.amount, cur) : '—' },
          { key: 'ts', title: 'Кога', render: (r: any) => fmtDateTime(r.ts) },
        ]} onRow={r => r.link && navigate(r.link)} /></Card>
      <Card pad={false} title="Критични проблеми" actions={<Link to="/brigade">Бригадир</Link>}>
        <Table rows={d.attention.issues.slice(0, 10)} empty={<Empty title="Няма критични проблеми" />} cols={[
          { key: 'title', title: 'Проблем', render: (r: any) => <>{r.title}<div className="small muted">{r.project_code || ''} · {KIND[r.kind] || r.kind}</div></> },
          { key: 'severity', title: 'Приоритет', render: (r: any) => { const s = SEV[r.severity] || [r.severity, '']; return <span className={'badge ' + s[1]}>{s[0]}</span>; } },
          { key: 'assigned_dept_name', title: 'Към', render: (r: any) => r.assigned_dept_name || '—' },
        ]} onRow={r => r.link && navigate(r.link)} /></Card>
      <Card pad={false} title="Закъснели задачи" actions={<Link to="/technical">Технически</Link>}>
        <Table rows={d.attention.tasks.slice(0, 10)} empty={<Empty title="Няма закъснели задачи" />} cols={[
          { key: 'title', title: 'Задача', render: (r: any) => <>{r.title}<div className="small muted">{r.project_code || 'без обект'} · {r.assignee_name || r.assignee_dept_name || 'няма отговорник'}</div></> },
          { key: 'due_date', title: 'Срок', render: (r: any) => <span className="badge bad">{fmtDate(r.due_date)}</span> },
          { key: 'priority', title: 'Приоритет', render: (r: any) => PRI[r.priority] || r.priority },
        ]} onRow={r => r.link && navigate(r.link)} /></Card>
      <Card pad={false} title="Неуспешна синхронизация" actions={<Link to="/settings">Настройки</Link>}>
        <Table rows={d.attention.events.slice(0, 10)} empty={<Empty title="Всичко синхронизирано" />} cols={[
          { key: 'type', title: 'Събитие', render: (r: any) => <>{r.type}<div className="small muted">{r.project_code || ''}</div></> },
          { key: 'last_error', title: 'Грешка', render: (r: any) => <span className="small">{(r.last_error || '').slice(0, 90)}</span> },
          { key: 'ts', title: 'Кога', render: (r: any) => fmtDateTime(r.ts) },
        ]} onRow={r => r.link && navigate(r.link)} /></Card>
    </div>

    <div style={{ marginBottom: 14 }}><Card pad={false} title="Портфолио по обекти">
      <Table rows={d.projects} empty={<Empty title="Няма обекти" />} onRow={r => navigate(`/projects/${r.id}`)} cols={[
        { key: 'code', title: '№', width: 100 }, { key: 'name', title: 'Обект', render: (r: any) => <>{r.name}<div className="small muted">{r.customer_name}</div></> },
        { key: 'status', title: 'Статус', render: (r: any) => <Status value={r.status} /> },
        { key: 'progress_pct', title: 'Изпълнение', width: 120, render: (r: any) => <div className="row" style={{ flexWrap: 'nowrap' }}><Progress pct={r.progress_pct} /><span className="small num" style={{ width: 38 }}>{r.progress_pct}%</span></div> },
        ...(money ? [
          { key: 'contract_value', title: 'Договор', num: true, render: (r: any) => fmtMoney(r.contract_value, cur) },
          { key: 'invoiced', title: 'Фактурирано', num: true, render: (r: any) => fmtMoney(r.invoiced, cur) },
          { key: 'received', title: 'Получено', num: true, render: (r: any) => fmtMoney(r.received, cur) },
          { key: 'receivables', title: 'Вземания', num: true, render: (r: any) => fmtMoney(r.receivables, cur) },
          { key: 'payables', title: 'Плащания', num: true, render: (r: any) => fmtMoney(r.payables, cur) },
          { key: 'result_to_date', title: 'Резултат', num: true, render: (r: any) => <span style={{ color: (r.result_to_date || 0) >= 0 ? 'inherit' : 'var(--bad)' }}>{fmtMoney(r.result_to_date, cur)}</span> },
          { key: 'forecast_result', title: 'Прогноза', num: true, render: (r: any) => fmtMoney(r.forecast_result, cur) },
        ] : []),
        { key: 'critical_issues', title: 'Пробл.', width: 70, num: true, render: (r: any) => r.critical_issues ? <span className="badge bad">{r.critical_issues}</span> : '0' },
      ]} /></Card></div>

    <Card pad={false} title="Натоварване по отдели">
      <Table rows={d.workload} empty={<Empty title="Няма отдели" />} cols={[
        { key: 'name', title: 'Отдел', render: (r: any) => <DeptBadge code={r.department} /> },
        { key: 'open_tasks', title: 'Отворени задачи', num: true },
        { key: 'open_issues', title: 'Отворени проблеми', num: true },
        { key: 'critical_issues', title: 'Критични', num: true, render: (r: any) => r.critical_issues ? <span className="badge bad">{r.critical_issues}</span> : fmtNum(r.critical_issues) },
      ]} /></Card>
  </>;
}
