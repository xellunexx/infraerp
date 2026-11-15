import path from 'node:path';
import { openDb, DATA_DIR } from './db.js';
import { startWorker } from './core.js';
import { createApp } from './app.js';
import mountOffers from './routes_offers.js';
import mountProjects from './routes_projects.js';
import { startWeatherWorker } from './weather.js';
import mountPrint from './print.js';
import mountExport from './export.js';

export const ROUTES = [mountOffers, mountProjects, mountPrint, mountExport];
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'index.js')) {
  const db = openDb(path.join(DATA_DIR, 'synchro.db'));
  const app = createApp(db, ROUTES);
  startWorker(db);
  startWeatherWorker(db);
  const port = Number(process.env.PORT || 4800);
  app.listen(port, '0.0.0.0', () => console.log(`SYNCHRO listening on :${port}, data in ${DATA_DIR}`));
}