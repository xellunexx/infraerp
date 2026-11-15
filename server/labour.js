// Labour calculator — the company's "Труд" sheet. Plain ESM without Node imports: used by the server tests and by the web app.
// Per activity: man-days = workers x working days; man-days per unit = man-days / quantity (goes into an offer line's "Надници").
// Costs: wages = counted man-days x daily wage; fuel per vehicle group = distance both ways x l/100 km / 100 x fuel factor x trips;
// nights x price per night; plus mechanisation, other СМР and other costs. Day rate ("Стойност" of a line) = total labour cost / counted man-days.
// In the Excel the totals exclude the Мобилизация and Демобилизация rows (E13 = SUM(E6:E12)); here that is the per-row "inWages" flag.
export const DEFAULT_LABOUR = {
  wage: 240, night_price: 30, fuel_factor: 1.05, mechanisation: 0, other_smr: 0, other: 0,
  activities: [
    { name: 'Мобилизация', unit: '', qty: 0, workers: 0, days: 0, nights: 0, inWages: false },
    { name: 'Демобилизация', unit: '', qty: 0, workers: 0, days: 0, nights: 0, inWages: false },
    { name: 'Механизация', unit: '', qty: 0, workers: 0, days: 0, nights: 0, inWages: true },
    { name: 'Други СМР', unit: 'м²', qty: 0, workers: 0, days: 0, nights: 0, inWages: true },
    { name: 'Плочи', unit: 'м²', qty: 0, workers: 0, days: 0, nights: 0, inWages: true },
    { name: 'Плочи', unit: 'л.м', qty: 0, workers: 0, days: 0, nights: 0, inWages: true },
    { name: 'Настилка', unit: 'м²', qty: 0, workers: 0, days: 0, nights: 0, inWages: true },
    { name: 'Разчертаване', unit: 'бр', qty: 0, workers: 0, days: 0, nights: 0, inWages: true },
    { name: 'Съоръжения', unit: 'бр', qty: 0, workers: 0, days: 0, nights: 0, inWages: true },
  ],
  vehicles: [
    { name: 'DACIA / TOURAN', consumption: 10, distance: 0, trips: 1 },
    { name: 'IVECO / RENAULT / FORD', consumption: 13, distance: 0, trips: 1 },
    { name: 'Камион с борд', consumption: 17, distance: 0, trips: 1 },
  ],
};
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const r4 = x => Math.round((x + Number.EPSILON) * 10000) / 10000;

export function labourCalc(input) {
  const c = { ...DEFAULT_LABOUR, ...(input || {}) };
  const activities = (c.activities || []).map(a => { const manDays = n(a.workers) * n(a.days); return { ...a, man_days: r4(manDays), per_unit: n(a.qty) > 0 ? r4(manDays / n(a.qty)) : null }; });
  const counted = activities.filter(a => a.inWages !== false);
  const manDays = counted.reduce((s, a) => s + a.man_days, 0);
  const nights = activities.reduce((s, a) => s + n(a.nights), 0);
  const vehicles = (c.vehicles || []).map(v => ({ ...v, cost: r2(n(v.distance) * n(v.consumption) / 100 * n(c.fuel_factor) * n(v.trips)) }));
  const wages = manDays * n(c.wage), fuel = vehicles.reduce((s, v) => s + v.cost, 0), nightsCost = nights * n(c.night_price);
  const total = wages + fuel + nightsCost + n(c.mechanisation) + n(c.other_smr) + n(c.other);
  return { activities, vehicles, man_days: r4(manDays), working_days: counted.reduce((s, a) => s + n(a.days), 0), nights,
    wages: r2(wages), fuel: r2(fuel), nights_cost: r2(nightsCost), total: r2(total), day_rate: manDays > 0 ? r2(total / manDays) : null };
}