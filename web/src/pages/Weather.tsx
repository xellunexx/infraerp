// Weather at the project site: several independent forecasts side by side, a consensus row and work warnings.
import React, { useState } from 'react';
import { api, fmtDateTime, fmtNum } from '../api';
import { Card, Empty, Field, Modal, useAction, useCan, useLoad } from '../ui';

const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dayLabel = (d: string) => { const x = new Date(d + 'T00:00:00'); return `${WD[x.getDay()]} ${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`; };
const t = (v: any) => v == null ? '—' : `${Math.round(v)}°`;

export function WeatherCard({ project, onLocationSaved }: { project: any; onLocationSaved: () => void }) {
  const [days, setDays] = useState(7);
  const w = useLoad<any>(`/projects/${project.id}/weather?days=${days}`, [project.latitude, project.longitude]);
  const can = useCan();
  const { run, busy } = useAction();
  const [detail, setDetail] = useState(false);
  const [editLoc, setEditLoc] = useState(false);
  const [lat, setLat] = useState(project.latitude ?? ''), [lon, setLon] = useState(project.longitude ?? '');
  const refresh = () => run(async () => { const r = await api.post(`/projects/${project.id}/weather/refresh?days=${days}`); w.setData(r.view); onLocationSaved(); }, 'Прогнозата е обновена');
  const v = w.data;
  const okSources = (v?.sources || []).filter((s: any) => s.status === 'ok' && s.days > 0);
  const last = (v?.sources || []).map((s: any) => s.fetched_at).filter(Boolean).sort().pop();
  const loc = v?.location;
  return <Card title="Прогноза за времето на обекта" actions={<>
    <div className="row" style={{ gap: 2 }}>{[7, 14].map(n => <button key={n} className={'sm' + (days === n ? ' primary' : '')} onClick={() => setDays(n)}>{n} дни</button>)}</div>
    <button className="sm" disabled={busy || !project.site_address} onClick={refresh}>Обнови</button>
    {v?.days?.length > 0 && <button className="sm" onClick={() => setDetail(true)}>По източници</button>}</>}>
    <div className="muted small" style={{ marginBottom: 8 }}>
      {loc?.latitude != null ? <>Местоположение: {loc.geo_label || 'координати'} ({fmtNum(loc.latitude, 4)}, {fmtNum(loc.longitude, 4)}) · {loc.geo_source === 'manual' ? 'въведено ръчно' : 'по адреса на обекта'}</>
        : project.site_address ? 'Местоположението се определя по адреса при първото обновяване.' : 'Въведете адрес на обекта (раздел „Клиент и обект“), за да има прогноза.'}
      {can('projects', 'write') && <> · <a onClick={() => setEditLoc(true)}>коригирай</a></>}
      {last && <> · обновено {fmtDateTime(last)} · източници с данни: {okSources.length} от {v.sources.length}</>}
    </div>
    {!v?.days?.length ? <Empty title="Няма прогноза">{project.site_address ? 'Натиснете „Обнови“. След това прогнозата се обновява автоматично на всеки 3 часа.' : ''}</Empty> :
      <div className="table-wrap"><table className="t"><thead><tr><th>Ден</th><th className="num">Макс.</th><th className="num">Мин.</th><th className="num">Валеж мм</th><th className="num">Вятър м/с</th><th className="num">Източници</th><th>Внимание</th></tr></thead>
        <tbody>{v.days.map((d: any) => { const c = d.consensus; return <tr key={d.date}>
          <td className="nowrap"><b>{dayLabel(d.date)}</b></td>
          <td className="num">{t(c.tmax)}{c.tmax_spread > 4 && <span className="faint small" title="Разлика между източниците"> ±{Math.round(c.tmax_spread / 2)}</span>}</td>
          <td className="num">{t(c.tmin)}</td>
          <td className="num">{c.precip == null ? '—' : fmtNum(c.precip, 1)}{c.precip_max > (c.precip ?? 0) + 2 && <span className="faint small"> до {fmtNum(c.precip_max, 1)}</span>}{c.prob != null && <span className="faint small"> · {Math.round(c.prob)}%</span>}</td>
          <td className="num">{c.wind == null ? '—' : fmtNum(c.wind, 1)}</td>
          <td className="num" title={`${c.rainy_sources} от ${c.sources} дават валеж`}>{c.sources}</td>
          <td>{d.warnings.map((x: string) => <span key={x} className="badge warn" style={{ marginRight: 4 }}>{x}</span>)}</td></tr>; })}</tbody></table></div>}
    {v?.days?.length > 0 && <div className="faint small" style={{ marginTop: 6 }}>Стойностите са медиана от наличните източници. Прагове за предупреждение: валеж ≥ {v.thresholds.rain_mm} мм, вятър ≥ {v.thresholds.wind_ms} м/с, минимум под {v.thresholds.min_temp}°C (Настройки).
      {days === 14 && ' След 7-ия ден остават само по-дългосрочните модели, затова източниците намаляват.'}</div>}

    {detail && v && <Modal wide title="Прогноза по източници" onClose={() => setDetail(false)}>
      <table className="t small"><thead><tr><th>Източник</th><th>Хоризонт</th><th>Състояние</th><th>Обновен</th></tr></thead><tbody>{v.sources.map((s: any) => <tr key={s.key}><td>{s.label}</td><td>{s.horizon} дни</td>
        <td>{s.status === 'ok' ? <span className="badge ok">{s.days} дни</span> : s.status === 'never' ? <span className="badge">не е зареждан</span> : <span className="badge bad" title={s.error}>грешка: {s.error}</span>}</td><td>{fmtDateTime(s.fetched_at)}</td></tr>)}</tbody></table>
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="t small"><thead><tr><th>Ден</th>{v.sources.map((s: any) => <th key={s.key}>{s.label.split(' — ')[0]}</th>)}</tr></thead>
        <tbody>{v.days.map((d: any) => <tr key={d.date}><td className="nowrap"><b>{dayLabel(d.date)}</b></td>{v.sources.map((s: any) => { const x = d.per[s.key]; return <td key={s.key} className="nowrap">
          {x ? <>{t(x.tmin)} / {t(x.tmax)}<br /><span className="muted">{x.precip != null ? fmtNum(x.precip, 1) + ' мм' : (x.text || '')}{x.wind != null ? ' · ' + fmtNum(x.wind, 1) + ' м/с' : ''}</span></> : <span className="faint">—</span>}</td>; })}</tr>)}</tbody></table></div>
    </Modal>}

    {editLoc && <Modal title="Местоположение на обекта" onClose={() => setEditLoc(false)} footer={<>
      <button onClick={() => run(async () => { await api.patch(`/projects/${project.id}`, { latitude: null, longitude: null, row_version: project.row_version }); setEditLoc(false); onLocationSaved(); }, 'Ще се определи отново по адреса')}>Определи по адреса</button>
      <button className="primary" disabled={busy || lat === '' || lon === ''} onClick={() => run(async () => { await api.patch(`/projects/${project.id}`, { latitude: Number(lat), longitude: Number(lon), row_version: project.row_version }); setEditLoc(false); onLocationSaved(); }, 'Координатите са записани')}>Запис</button></>}>
      <p className="muted">Ако адресът не е намерен точно (нов обект, извън населено място), въведете координатите от карта (десен бутон в Google Maps → координати).</p>
      <div className="form c2"><Field label="Географска ширина (напр. 42.5065)"><input type="number" step="0.0001" value={lat} onChange={e => setLat(e.target.value)} /></Field>
        <Field label="Географска дължина (напр. 27.4689)"><input type="number" step="0.0001" value={lon} onChange={e => setLon(e.target.value)} /></Field></div>
    </Modal>}
  </Card>;
}