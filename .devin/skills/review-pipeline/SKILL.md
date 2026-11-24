---
name: review-pipeline
description: >
  Full post-change verification and review pipeline for infraerp. Use after any
  code change reaches implementation-complete, when the operator asks to "run
  the bots/pipeline/audit/QA", or before committing/deploying. Orchestrates:
  failing-test-first → full suite → build → live mount probes → product-engineer
  review → audit review → QA outcome vectors → CHANGELOG → process cleanup.
---

# Review Pipeline — infraerp

The operator's loop: `review → evaluate → verify → report → brainstorm → design
→ test → verify → commit → deploy`. This skill is the *test → verify* half,
run every time code changes, in this order. Do not skip steps; do not reorder.

## Step 0 — Root cause already proven?

For bugfixes/regressions: was `systematic-debugging` followed and a failing
test written BEFORE the fix? If not, stop and do that first. The fix must hit
the mechanism (the gate/extraction/validation), never a line/ID-shaped symptom.

## Step 1 — Test suite (regression evidence)

```bash
node --test --test-concurrency=1 test/*.test.mjs   # ~40s
```

All green required. A file that hangs = a leaked server/DB handle from a
failing test that skipped `t.stop()` — fix the test, not the suite.

## Step 2 — Frontend build

```bash
cd web && npm run build   # must end "✓ built in …ms"
```

## Step 3 — Live mount verification

The running app on `:4800` serves OLD code — restart it to mount new routes
(sessions are DB rows, they survive):

```bash
taskkill //PID <pid on :4800> //F && node server/index.js &
```

Then probe WITHOUT writing to the real DB:

- `GET /api/<new-read-route>` with a session cookie → 200 = mounted.
- `POST` an invalid body to a new/changed write route → **400 = mounted and
  gated**; 404 = missing; 401 = fix your cookie (`synchro_sid`).
- **Never write to the real DB for verification.** Write-path proof = the
  test suite, or a second instance on `:4801` against a COPY of `synchro.db`
  (kill it and delete the copy when done).

## Step 4 — Review bots (three passes, all required)

1. **Product-engineer review** — `.devin/skills/product-engineer-review/`:
   does the shipped behavior serve the workflow `design.md` intends?
   Dispatch a `subagent_explore` (read-only) with the change summary.
2. **Audit review** — `.devin/skills/audit-review/`: line-by-line diff audit
   for correctness/security/concurrency/contract drift. Report as severity-
   tagged findings; fix P0/P1 before reporting done.
3. **QA vectors** — `.devin/skills/qa-vectors/`: observable input→output
   proof of the *human outcome*, not just green tests. Suite green =
   regression evidence; vectors = acceptance evidence.

Confirmed defects → fix, re-run Steps 1–3. Non-issues → record why in the
final report so they are not re-litigated.

## Step 5 — Close-out checklist

- `CHANGELOG.md` entry in this same session (unbreakable rule).
- `CHECKLIST.md` phase lines still truthful (no stale "NOT started").
- `git status` + `git diff` — no debug leftovers, no accidental files.
- Process hygiene: every server/clone/watcher you started is dead.
  `:4800` is the only sanctioned survivor.
- Final report: before→after table, what is measured vs "not measured",
  `In plain words:` block.

## Forbidden shortcuts

- "should work" / "it compiled" as verification.
- Skipping the full suite because the changed file's tests pass.
- Writing to the production `synchro.db` to verify a write path.
- Reporting review findings you did not actually read.
