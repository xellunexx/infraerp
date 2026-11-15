// Weather for the project site: geocode the site address, pull daily forecasts from several independent services,
// keep the last good result per source in weather_forecasts, and build a per-day comparison + consensus.
import { setting } from './core.js';

const UA = 'SYNCHRO/0.1 (internal construction operations platform)';
export const SOURCES = {
  om_ecmwf: { label: 'ECMWF (Европейски център) — Open-Meteo', horizon: 15 },
  om_gfs: { label: 'GFS (NOAA, САЩ) — Open-Meteo', horizon: 16 },
  om_icon: { label: 'ICON (DWD, Германия) — Open-Meteo', horizon: 7 },
  met_no: { label: 'MET Norway (yr.no)', horizon: 10 },
  seventimer: { label: '7Timer!', horizon: 7 },
};
const OM_MODEL = { om_ecmwf: 'ecmwf_ifs025', om_gfs: 'gfs_seamless', om_icon: 'icon_seamless' };
const med = a => { const v = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const r1 = n => n == null ? null : Math.round(n * 10) / 10;

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- geocoding
export async function geocode(address, fetchFn = fetch) {
  const q = String(address || '').trim();
  if (!q) throw new Error('Няма въведен адрес на обекта');
  const nom = await getJson(fetchFn, `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=bg&q=${encodeURIComponent(q)}`).catch(() => []);
  if (nom[0]) return { latitude: Number(nom[0].lat), longitude: Number(nom[0].lon), label: nom[0].display_name, source: 'nominatim' };
  // fall back to the settlement name (text before the first comma, without "гр."/"с." prefixes)
  const place = q.split(',')[0].replace(/^(гр\.|град|с\.|село)\s*/i, '').trim();
  const om = await getJson(fetchFn, `https://geocoding-api.open-meteo.com/v1/search?count=1&language=bg&name=${encodeURIComponent(place)}`).catch(() => ({}));
  const r = om.results?.[0];
  if (r) return { latitude: r.latitude, longitude: r.longitude, label: [r.name, r.admin1, r.country].filter(Boolean).join(', '), source: 'open-meteo-geocoding' };
  throw new Error('Адресът не е намерен на картата. Въведете координати ръчно.');
}

// ---------------------------------------------------------------- normalizers (each returns [{date, tmax, tmin, precip, prob, wind, gust, text}])
export function fromOpenMeteo(j) {
  const d = j.daily || {};
  return (d.time || []).map((date, i) => ({ date, tmax: d.temperature_2m_max?.[i] ?? null, tmin: d.temperature_2m_min?.[i] ?? null, precip: d.precipitation_sum?.[i] ?? null,
    prob: d.precipitation_probability_max?.[i] ?? null, wind: d.wind_speed_10m_max?.[i] ?? null, gust: d.wind_gusts_10m_max?.[i] ?? null, code: d.weather_code?.[i] ?? null }))
    .filter(x => x.tmax != null || x.tmin != null);
}
/** MET Norway gives hourly then 6-hourly steps in UTC; group by the site's local date. Precipitation uses next_1_hours while hourly steps exist, then next_6_hours. */
export function fromMetNo(j, timeZone = 'Europe/Sofia') {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = new Map();
  const ts = j.properties?.timeseries || [];
  ts.forEach((t, i) => {
    const date = fmt.format(new Date(t.time)), det = t.data?.instant?.details || {};
    const day = days.get(date) || { date, temps: [], winds: [], precip: 0, havePrecip: false, symbols: [] };
    if (det.air_temperature != null) day.temps.push(det.air_temperature);
    if (det.wind_speed != null) day.winds.push(det.wind_speed);
    const nextGap = i + 1 < ts.length ? (Date.parse(ts[i + 1].time) - Date.parse(t.time)) / 3600000 : 6;
    const block = nextGap <= 1 ? t.data?.next_1_hours : t.data?.next_6_hours;
    if (block?.details?.precipitation_amount != null) { day.precip += block.details.precipitation_amount; day.havePrecip = true; }
    if (block?.summary?.symbol_code) day.symbols.push(block.summary.symbol_code);
    days.set(date, day);
  });
  return [...days.values()].filter(d => d.temps.length >= 2).map(d => ({ date: d.date, tmax: Math.max(...d.temps), tmin: Math.min(...d.temps),
    precip: d.havePrecip ? r1(d.precip) : null, prob: null, wind: d.winds.length ? Math.max(...d.winds) : null, gust: null, text: d.symbols.find(s => /rain|snow|sleet|thunder/.test(s)) || d.symbols[0] || null }));
}
// 7Timer wind10m_max is a 1-8 scale; mid-points of its documented m/s bands
const SEVENTIMER_WIND = { 1: 0.2, 2: 1.9, 3: 5.7, 4: 9.4, 5: 14, 6: 20.9, 7: 28.6, 8: 32.6 };
export function from7Timer(j) {
  return (j.dataseries || []).map(d => { const s = String(d.date); return { date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, tmax: d.temp2m?.max ?? null, tmin: d.temp2m?.min ?? null,
    precip: null, prob: null, wind: SEVENTIMER_WIND[d.wind10m_max] ?? null, gust: null, text: d.weather || null, rainy: /rain|snow|ts/.test(d.weather || '') }; });
}

export async function fetchSource(source, lat, lon, fetchFn = fetch, timeZone = 'Europe/Sofia') {
  if (OM_MODEL[source]) {
    const j = await getJson(fetchFn, `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=${OM_MODEL[source]}&forecast_days=16&timezone=auto&wind_speed_unit=ms` +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code');
    return { days: fromOpenMeteo(j), timezone: j.timezone };
  }
  if (source === 'met_no') return { days: fromMetNo(await getJson(fetchFn, `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`), timeZone) };
  if (source === 'seventimer') return { days: from7Timer(await getJson(fetchFn, `https://www.7timer.info/bin/api.pl?lon=${lon}&lat=${lat}&product=civillight&output=json`)) };
  throw new Error('Непознат източник');
}

// ---------------------------------------------------------------- refresh + view
export async function refreshProject(db, projectId, fetchFn = fetch) {
  const p = db.prepare('SELECT id, site_address, latitude, longitude, geo_source FROM projects WHERE id = ?').get(projectId);
  if (!p) throw new Error('Обектът не е намерен');
  let { latitude: lat, longitude: lon } = p;
  if (lat == null || lon == null) {
    const g = await geocode(p.site_address, fetchFn);
    db.prepare('UPDATE projects SET latitude = ?, longitude = ?, geo_label = ?, geo_source = ? WHERE id = ?').run(g.latitude, g.longitude, g.label, g.source, projectId);
    lat = g.latitude; lon = g.longitude;
  }
  const save = db.prepare(`INSERT INTO weather_forecasts(project_id, source, fetched_at, status, error, days, latitude, longitude) VALUES (?,?, datetime('now'), ?,?,?,?,?)
    ON CONFLICT(project_id, source) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, error = excluded.error,
      days = CASE WHEN excluded.status = 'ok' THEN excluded.days ELSE weather_forecasts.days END, latitude = excluded.latitude, longitude = excluded.longitude`);
  let tz = 'Europe/Sofia';
  const results = {};
  for (const source of Object.keys(SOURCES)) {   // sequential: Open-Meteo first gives the site's time zone for MET Norway
    try {
      const r = await fetchSource(source, lat, lon, fetchFn, tz);
      if (r.timezone) tz = r.timezone;
      if (!r.days.length) throw new Error('празен отговор');
      save.run(projectId, source, 'ok', null, JSON.stringify(r.days), lat, lon);
      results[source] = r.days.length;
    } catch (e) { save.run(projectId, source, 'error', String(e.message || e).slice(0, 300), '[]', lat, lon); results[source] = `грешка: ${e.message}`; }
  }
  return results;
}

export function weatherView(db, projectId, horizon = 7) {
  const p = db.prepare('SELECT site_address, latitude, longitude, geo_label, geo_source FROM projects WHERE id = ?').get(projectId);
  const rows = db.prepare('SELECT * FROM weather_forecasts WHERE project_id = ?').all(projectId);
  const th = { rain_mm: Number(setting(db, 'weather_rain_mm', '2')), wind_ms: Number(setting(db, 'weather_wind_ms', '10')), min_temp: Number(setting(db, 'weather_min_temp', '5')) };
  const today = new Date().toISOString().slice(0, 10);
  const stale = rows.some(r => r.latitude !== p.latitude || r.longitude !== p.longitude);
  const bySource = Object.fromEntries(rows.filter(r => !stale || (r.latitude === p.latitude && r.longitude === p.longitude))
    .map(r => [r.source, JSON.parse(r.days || '[]').filter(d => d.date >= today)]));
  const dates = [...new Set(Object.values(bySource).flat().map(d => d.date))].sort().slice(0, horizon);
  const days = dates.map(date => {
    const per = {};
    for (const [s, list] of Object.entries(bySource)) { const d = list.find(x => x.date === date); if (d) per[s] = d; }
    const v = Object.values(per);
    const rainyVotes = v.filter(d => (d.precip != null && d.precip >= 1) || d.rainy || /rain|snow|sleet|thunder/.test(d.text || '')).length;
    const c = { sources: v.length, tmax: r1(med(v.map(d => d.tmax))), tmin: r1(med(v.map(d => d.tmin))), precip: r1(med(v.map(d => d.precip))),
      precip_max: r1(Math.max(0, ...v.map(d => d.precip ?? 0))), prob: med(v.map(d => d.prob)), wind: r1(med(v.map(d => d.wind))), wind_max: r1(Math.max(0, ...v.map(d => d.wind ?? 0))),
      tmax_spread: v.length > 1 ? r1(Math.max(...v.map(d => d.tmax ?? -99)) - Math.min(...v.map(d => d.tmax ?? 99))) : null, rainy_sources: rainyVotes };
    const warnings = [];
    if ((c.precip ?? 0) >= th.rain_mm || rainyVotes * 2 > v.length) warnings.push('валежи');
    if ((c.wind ?? 0) >= th.wind_ms) warnings.push('силен вятър');
    if (c.tmin != null && c.tmin < th.min_temp) warnings.push(`под ${th.min_temp}°C`);
    return { date, per, consensus: c, warnings };
  });
  return { location: p, thresholds: th, horizon,
    sources: Object.entries(SOURCES).map(([key, s]) => { const r = rows.find(x => x.source === key); return { key, label: s.label, horizon: s.horizon, status: r?.status || 'never', error: r?.error || null,
      fetched_at: r?.fetched_at || null, days: (bySource[key] || []).length }; }),
    days };
}

/** Background refresh: active projects whose forecast is older than `weather_refresh_hours`. */
export function startWeatherWorker(db, fetchFn = fetch, everyMs = 10 * 60 * 1000) {
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const hours = Number(setting(db, 'weather_refresh_hours', '3'));
      const due = db.prepare(`SELECT p.id FROM projects p WHERE p.archived = 0 AND p.status NOT IN ('closed') AND p.site_address IS NOT NULL AND p.site_address != ''
        AND COALESCE((SELECT MIN(fetched_at) FROM weather_forecasts w WHERE w.project_id = p.id), '1970-01-01') < datetime('now', ?)`).all(`-${hours} hours`);
      for (const p of due) { try { await refreshProject(db, p.id, fetchFn); } catch (e) { console.error('weather', p.id, e.message); } }
    } finally { busy = false; }
  };
  const t = setInterval(tick, everyMs); t.unref?.(); setTimeout(tick, 5000).unref?.();
  return () => clearInterval(t);
}