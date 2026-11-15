import test from 'node:test';
import assert from 'node:assert/strict';
import { start, seedOffer } from './helpers.mjs';
import { fromMetNo, from7Timer } from '../server/weather.js';

const day = (i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
const json = body => ({ ok: true, status: 200, json: async () => body });
/** Fake network: geocoder + three Open-Meteo models + MET Norway (fails) + 7Timer. */
function fakeFetch(calls) {
  return async url => {
    calls.push(url);
    if (url.includes('nominatim')) return json([{ lat: '42.5065', lon: '27.4689', display_name: 'Бургас, България' }]);
    if (url.includes('api.open-meteo.com')) {
      const n = url.includes('icon') ? 7 : 16, base = url.includes('gfs') ? 12 : url.includes('ecmwf') ? 10 : 11;
      const t = Array.from({ length: n }, (_, i) => day(i));
      return json({ timezone: 'Europe/Sofia', daily: { time: t, temperature_2m_max: t.map(() => base), temperature_2m_min: t.map(() => base - 8), precipitation_sum: t.map((_, i) => i === 1 ? 6 : 0),
        precipitation_probability_max: t.map(() => 20), wind_speed_10m_max: t.map(() => 4), wind_gusts_10m_max: t.map(() => 8), weather_code: t.map(() => 3) } });
    }
    if (url.includes('met.no')) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes('7timer')) return json({ dataseries: Array.from({ length: 7 }, (_, i) => ({ date: Number(day(i).replaceAll('-', '')), weather: i === 1 ? 'rain' : 'cloudy', temp2m: { max: 11, min: 2 }, wind10m_max: 3 })) });
    throw new Error('unexpected ' + url);
  };
}

test('weather: geocodes the site address, compares sources per day, flags work risks, keeps going when a source fails', async () => {
  const t = await start();
  try {
    const { offer } = await seedOffer(t);
    await t.admin.post(`/api/offers/${offer.id}/confirm`); t.sync();
    const calls = [];
    const { refreshProject, weatherView } = await import('../server/weather.js');
    const results = await refreshProject(t.db, 1, fakeFetch(calls));
    assert.match(String(results.met_no), /грешка: HTTP 503/);
    assert.equal(results.om_gfs, 16);
    const p = t.db.prepare('SELECT latitude, longitude, geo_source FROM projects WHERE id = 1').get();
    assert.deepEqual({ ...p }, { latitude: 42.5065, longitude: 27.4689, geo_source: 'nominatim' });
    assert.ok(calls.some(u => u.includes('latitude=42.5065')), 'forecast requested for the geocoded site');

    const v7 = weatherView(t.db, 1, 7), v14 = weatherView(t.db, 1, 14);
    assert.equal(v7.days.length, 7); assert.equal(v14.days.length, 14);
    assert.equal(v7.days[0].consensus.sources, 4, 'ECMWF, GFS, ICON, 7Timer (MET Norway failed)');
    assert.equal(v7.days[0].consensus.tmax, 11, 'median of 10, 11, 11, 12');
    assert.equal(v14.days[13].consensus.sources, 2, 'beyond day 7 only ECMWF and GFS remain');
    assert.ok(v7.days[1].warnings.includes('валежи'));
    assert.ok(v7.days[0].warnings.includes('под 5°C'), 'median minimum 2.5 is below the 5°C threshold');
    assert.equal(v7.sources.find(s => s.key === 'met_no').status, 'error');

    // the API is permission-checked and returns the same view; a changed address resets the location
    const api = await t.admin.get('/api/projects/1/weather?days=14');
    assert.equal(api.status, 200); assert.equal(api.data.days.length, 14);
    const row = (await t.admin.get('/api/projects/1')).data;
    await t.admin.patch('/api/projects/1', { site_address: 'Варна, ул. Друга 2', row_version: row.row_version });
    assert.equal(t.db.prepare('SELECT latitude FROM projects WHERE id = 1').get().latitude, null);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM weather_forecasts WHERE project_id = 1').get().n, 0);
    const row2 = (await t.admin.get('/api/projects/1')).data;
    assert.equal((await t.admin.patch('/api/projects/1', { latitude: 43.2, longitude: 27.9, row_version: row2.row_version })).status, 200);
    assert.equal(t.db.prepare('SELECT geo_source FROM projects WHERE id = 1').get().geo_source, 'manual');
    assert.equal((await t.admin.patch('/api/projects/1', { latitude: 200, longitude: 1, row_version: row2.row_version + 1 })).status, 400);
  } finally { await t.stop(); }
});

test('weather parsers: MET Norway hourly/6-hourly precipitation is not double counted; 7Timer dates and wind scale', () => {
  const ts = [
    { time: '2026-11-16T10:00:00Z', data: { instant: { details: { air_temperature: 8, wind_speed: 3 } }, next_1_hours: { details: { precipitation_amount: 1 }, summary: { symbol_code: 'rain' } }, next_6_hours: { details: { precipitation_amount: 9 } } } },
    { time: '2026-11-16T11:00:00Z', data: { instant: { details: { air_temperature: 10, wind_speed: 5 } }, next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 9 } } } },
    { time: '2026-11-16T12:00:00Z', data: { instant: { details: { air_temperature: 9, wind_speed: 4 } }, next_6_hours: { details: { precipitation_amount: 2 } } } },
  ];
  const d = fromMetNo({ properties: { timeseries: ts } }, 'Europe/Sofia');
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].date, d[0].tmax, d[0].tmin, d[0].precip, d[0].wind], ['2026-11-16', 10, 8, 3.5, 5]);
  const s = from7Timer({ dataseries: [{ date: 20261116, weather: 'lightrain', temp2m: { max: 9, min: 1 }, wind10m_max: 4 }] });
  assert.deepEqual([s[0].date, s[0].wind, s[0].rainy], ['2026-11-16', 9.4, true]);
});