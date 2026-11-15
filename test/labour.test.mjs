import test from 'node:test';
import assert from 'node:assert/strict';
import { labourCalc, DEFAULT_LABOUR } from '../server/labour.js';

test('labour calculator follows the Труд sheet', () => {
  const acts = DEFAULT_LABOUR.activities.map(a => ({ ...a }));
  acts[0] = { ...acts[0], workers: 4, days: 1, nights: 0 };           // Мобилизация: not in wages, as in the Excel totals
  acts[6] = { ...acts[6], qty: 600, workers: 5, days: 6, nights: 20 }; // Настилка 600 м², 5 people x 6 days = 30 man-days
  acts[7] = { ...acts[7], qty: 1, workers: 3, days: 2, nights: 0 };    // Разчертаване 6 man-days
  const veh = DEFAULT_LABOUR.vehicles.map(v => ({ ...v }));
  veh[1] = { ...veh[1], distance: 400, trips: 2 };                     // 400 km x 13/100 x 1.05 x 2 = 109.20
  const r = labourCalc({ ...DEFAULT_LABOUR, activities: acts, vehicles: veh, mechanisation: 500 });
  assert.equal(r.man_days, 36);
  assert.equal(r.wages, 8640);                     // 36 x 240
  assert.equal(r.fuel, 109.2);
  assert.equal(r.nights_cost, 600);                // 20 x 30
  assert.equal(r.total, 9849.2);                   // 8640 + 109.20 + 600 + 500
  assert.equal(r.day_rate, 273.59);                // 9849.20 / 36
  assert.equal(r.activities[6].per_unit, 0.05);    // 30 / 600 man-days per м²
  assert.equal(r.activities[0].per_unit, null);
  assert.equal(labourCalc({}).day_rate, null, 'no man-days: no day rate instead of a division by zero');
});