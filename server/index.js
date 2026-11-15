import path from 'node:path';
import { openDb, DATA_DIR } from './db.js';
import { startWorker } from './core.js';
import { createApp } from './app.js';
import mountOffers from './routes_offers.js';
import mountProjects from './routes_projects.js';
import { startWeatherWorker } from './weather.js';
import mountPrint from './print.js';
import mountExport from './export.js';
import mountTechnical from './routes_technical.js';
import mountAccounting from './routes_accounting.js';
import mountLogistics from './routes_logistics.js';
import mountBrigade from './routes_brigade.js';
import mountManagement from './routes_management.js';
import mountCatalog from './routes_catalog.js';
import mountChangeRequests from './routes_change_requests.js';
import { startReminderWorker } from './reminders.js';
import { syncProjectStatus } from './domain.js';

export const ROUTES = [mountOffers, mountProjects, mountTechnical, mountAccounting, mountLogistics, mountBrigade, mountManagement, mountCatalog, mountChangeRequests, mountPrint, mountExport];
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'index.js')) {
  const db = openDb(path.join(DATA_DIR, 'synchro.db'));
  const app = createApp(db, ROUTES);
  // one-time heal: coarse status follows the stage checklist (manual on_hold/closed untouched)
  for (const p of db.prepare("SELECT id FROM projects WHERE status NOT IN ('closed','on_hold')").all()) syncProjectStatus(db, p.id);
  startWorker(db);
  startWeatherWorker(db);
  startReminderWorker(db);
  const port = Number(process.env.PORT || 4800);
  app.listen(port, '0.0.0.0', () => console.log(`SYNCHRO listening on :${port}, data in ${DATA_DIR}`));
}