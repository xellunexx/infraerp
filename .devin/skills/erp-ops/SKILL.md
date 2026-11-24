---
name: erp-ops
description: >
  Run/verify/operate infraerp locally and on the VM — ports, data dir, session
  minting, live probes without polluting the DB, restart procedure, deploy
  notes. Use when asked for a local link, to verify endpoints live, to restart
  the app, or before deploying.
---

# erp-ops — running and verifying the app

## Local app

- Start: `node server/index.js` from repo root → `http://127.0.0.1:4800`
  (`PORT` overrides; binds `0.0.0.0`).
- Data: `SYNCHRO_DATA` env, default `../synchro-data` relative to CWD →
  `C:\lab\infraerp\synchro-data\synchro.db` (+ `files/` uploads, `backups/`).
- Web: `cd web && npm run build` → server serves `web/dist` statically.
- **Sessions are DB rows** — a restart never logs anyone out. Cookie:
  `synchro_sid`, TTL 14 days.

## Session for API probes

```js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('C:/lab/infraerp/synchro-data/synchro.db');
db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?, datetime('now','+1 hour'))")
  .run('probe' + Math.random().toString(36).slice(2), <user_id>);
// then: curl -H "Cookie: synchro_sid=<tok>" http://127.0.0.1:4800/api/...
// CLEAN UP: DELETE FROM sessions WHERE token LIKE 'probe%'
```

Find user ids: `SELECT id, username, role FROM users` (live DB admin: `bosshev`).

## Verification rules

- **Reads**: any `GET` on the real DB is safe.
- **Write routes**: probe mount/gating only — POST a deliberately invalid
  body → 400 means mounted + gated; 404 means missing. A real write
  pollutes stock/finances — forbidden on the production DB.
- **Full write-path live check**: second instance on `:4801` with
  `SYNCHRO_DATA=<dir containing a COPY of synchro.db>`; kill it and delete
  the copy when done. Only `:4800` is a sanctioned survivor.

## Restart (pick up new server code)

```bash
netstat -ano | findstr ":4800" | findstr LISTENING   # get PID
taskkill //PID <pid> //F
cd /c/lab/infraerp/infraerp && node server/index.js &
```

## Deployed instance

- VM `68.210.226.194`, systemd unit `synchro.service` on `:4800`,
  `SYNCHRO_DATA=/home/devops/synchro/synchro-data`.
- External access via a Cloudflare quick tunnel (URL is per-run — check
  `cloudflared`/journal output on the VM, it rotates).
- Deploy = push code + restart the service; migrations are additive ALTERs
  in `server/db.js` and apply on boot — verify against a DB copy first for
  any schema change.

## Process hygiene (canon)

Every node/python/server/clone you start for verification dies the moment
its purpose is fulfilled. Before reporting done:
`netstat -ano | findstr "48"` should show only `:4800` LISTENING (the app).
