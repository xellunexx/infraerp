// Адресът се търси само в България: от пълния текст към по-кратък (квартал → град). Нищо извън България.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geocode, addressCandidates } from '../server/weather.js';

const json = b => ({ ok: true, status: 200, json: async () => b });

test('address candidates go from the full text down to the settlement', () => {
  assert.deepEqual(addressCandidates('гр.Бургас ж-к Славейков до бл.51'), ['Бургас ж.к. Славейков бл.51', 'Бургас ж.к. Славейков', 'Бургас']);
  assert.deepEqual(addressCandidates('гр. Бургас, кв. Зорница'), ['Бургас, кв. Зорница', 'Бургас']);
  assert.deepEqual(addressCandidates('с. Равда'), ['Равда']);
});

test('a block address is found through a shorter form, always inside Bulgaria', async () => {
  const calls = [];
  const fetchFn = async url => { calls.push(decodeURIComponent(url));
    if (url.includes('nominatim')) return json(decodeURIComponent(url).includes('q=Бургас ж.к. Славейков&') || decodeURIComponent(url).endsWith('q=Бургас ж.к. Славейков') ? [{ lat: '42.52', lon: '27.45', display_name: 'Славейков, Бургас, България' }] : []);
    return json({}); };
  const g = await geocode('гр.Бургас ж-к Славейков до бл.51', fetchFn);
  assert.deepEqual([g.latitude, g.longitude], [42.52, 27.45]);
  assert.ok(calls.filter(u => u.includes('nominatim')).every(u => u.includes('countrycodes=bg')), 'Bulgaria only');
});

test('nonsense addresses are not placed abroad', async () => {
  const fetchFn = async url => json(url.includes('countrycodes=bg') || url.includes('countryCode=BG') ? (url.includes('nominatim') ? [] : {}) : (url.includes('nominatim') ? [{ lat: '44.3', lon: '2.5', display_name: 'Aveyron, France' }] : { results: [{ latitude: 59.8, longitude: 30.3, name: 'X', country: 'Русия' }] }));
  await assert.rejects(geocode('12', fetchFn), /не е намерен/);
  await assert.rejects(geocode('гг', fetchFn), /не е намерен/);
});
