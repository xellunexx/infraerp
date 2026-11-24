# infraerp — agent runbook

Construction-operations ERP. One shared operational environment: Commercial,
Contracts, Technical, Accounting, Warehouse, Logistics, Brigadier, Management —
one project reality.

> **ENTER INFORMATION ONCE. SYNCHRONIZE EVERYWHERE.**
> One row written; it shows up filtered in every view. Never copy a fact between
> tables/pages — derive views from the shared record.

## Stack

- Node.js ES modules, Express-style router in `server/app.js` (`h()` wraps
  handlers → JSON, `HttpError`/`bad()` → 4xx).
- SQLite via `node:sqlite` `DatabaseSync` — synchronous, no ORM.
  `server/db.js` is the single schema file + additive ALTER migrations.
  `tx(db, fn)` = transaction. `nextCode(db, 'MRQ')` = running-number generator.
- React + TypeScript + Vite in `web/` — shared kit in `web/src/ui.tsx`
  (`useLoad`, `useAction`, `useForm`, `useCan`, `Modal`, `Table`, `Field`).
- Domain knowledge: `design.md` is the spec (Bulgarian). `CHECKLIST.md` tracks
  phase completion. `CHANGELOG.md` — every shipped change lands an entry the
  same session.

## Commands

| Task | Command |
|---|---|
| Run app | `node server/index.js` → `http://127.0.0.1:4800` (port via `PORT`) |
| Data dir | `SYNCHRO_DATA` env, default `../synchro-data` (=`C:\lab\infraerp\synchro-data`) — `synchro.db`, `files/`, `backups/` |
| Full tests | `node --test --test-concurrency=1 test/*.test.mjs` (~40 s, 60 tests) |
| One file | `node --test test/warehouse_reports.test.mjs` |
| Web build | `cd web && npm run build` |
| Mint session | insert row into `sessions(token, user_id, expires_at)`; cookie name `synchro_sid` |
| Probe-mounted-not-written | POST an invalid body → 400 = route mounted; 404 = missing |

## Conventions

- **Permissions**: `need(user, 'module', 'read'|'write')` throws 401/403;
  `can()` returns bool; `canSeeProject(db, user, pid)` scopes per-project.
  Every route gates server-side. Modules: commercial, contracts, technical,
  progress, warehouse, logistics, brigade, accounting, management, admin.
- **Events**: `emit(db, user, {type, origin, project_id, entity_type,
  entity_id, dedupe_key, next, affected})` → `server/domain.js` handlers
  (`notify()` to departments, status re-derivation, tracked issues).
- **Audit**: `audit(db, user, {project_id, entity_type, entity_id, action,
  after, module})` — corrections are auditable, never destructive edits.
- **Money/stock math lives in `server/calc.js`** — routes call it, never
  re-implement. `stock()`, `consumption()` know all movement kinds;
  extending kinds = extend the calc reader AND the write gate together.
- **Paired facts are one write** — a project↔project transfer writes both
  `transfer_out` and `transfer_in` inside `tx()`. Never accept the second
  half as a user-supplied kind.
- **Bulgarian UI/errors**. Test conventions: `test/helpers.mjs` `start()`
  (fresh DB + admin), `seedOffer(t)`, `mkUser`, `sync()`.
- **Corrections**: void/reopen flows with reason + approval, not edits.

## Pipeline (after ANY change)

`.devin/skills/review-pipeline/` is the contract — short form:

1. Root cause before edits (systematic-debugging); failing test first.
2. `node --test --test-concurrency=1 test/*.test.mjs` — all green.
3. `cd web && npm run build` — clean.
4. Live-verify routes mounted (400-vs-404 probes); **no writes on the real DB** —
   write-path proof = tests or a `:4801` clone of a DB copy.
5. Review bots: product-engineer review vs `design.md`, audit pass on the diff,
   QA outcome vectors (green suite = regression evidence, not acceptance).
6. `CHANGELOG.md` entry, `git status`/`git diff` sweep, kill every temp process.
   Only `:4800` stays running (the working app — restart it to pick up server
   changes; sessions are DB rows and survive).

## Deployed instance

VM `68.210.226.194` — systemd `synchro.service`, `SYNCHRO_DATA=/home/devops/synchro/synchro-data`, quick Cloudflare tunnel for external access.
