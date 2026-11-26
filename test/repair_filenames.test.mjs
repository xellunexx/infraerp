// Старите развалени имена на файлове се връщат в кирилица; здравите не се пипат.
import test from 'node:test';
import assert from 'node:assert/strict';
import { repairedName } from '../tools/repair_filenames.mjs';

test('mangled Cyrillic file names are repaired, healthy ones are left alone', () => {
  const good = '231G_Бургас Меден Рудник паркур ДП  2.11.16.pdf';
  assert.equal(repairedName(Buffer.from(good, 'utf8').toString('latin1')), good);
  assert.equal(repairedName(good), null);
  assert.equal(repairedName('report-final.pdf'), null);
  assert.equal(repairedName('Ðx'), null, 'not a clean round trip');
});
