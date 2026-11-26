// Д1 (т.39): no silent write. Every route that writes the database must leave an event (record/emit/notify),
// unless it is listed in server/routing.js EXEMPT with a reason. Every event type has a Bulgarian name.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRoutes, emittedTypes } from './lib/write_routes.mjs';
import { EXEMPT, ROUTING } from '../server/routing.js';
import { EVENT_LABEL } from '../server/human.js';

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');

test('every write route tells someone, or is exempt with a reason', () => {
  const silent = writeRoutes(server).filter(r => r.write && !r.tells && !EXEMPT[r.route]).map(r => `${r.route} (${r.file})`);
  assert.deepEqual(silent, [], 'write routes with no event — use record() or list them in EXEMPT with a reason');
  for (const [route, why] of Object.entries(EXEMPT)) assert.ok(String(why).trim().length > 5, `exemption without a reason: ${route}`);
});

test('every exemption still exists (no stale entries)', () => {
  const routes = new Set(writeRoutes(server).map(r => r.route));
  assert.deepEqual(Object.keys(EXEMPT).filter(r => !routes.has(r)), []);
});

test('every event type has a Bulgarian name for the timeline and the notifications', () => {
  const types = new Set([...emittedTypes(server), ...Object.keys(ROUTING)]);
  assert.deepEqual([...types].filter(t => !EVENT_LABEL[t]).sort(), []);
});
