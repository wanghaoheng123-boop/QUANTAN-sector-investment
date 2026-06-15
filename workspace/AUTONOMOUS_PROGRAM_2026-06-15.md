# QUANTAN — Autonomous Verification & Optimization Program (2026-06-15)

**Owner directive (2026-06-15):** run a full code-bug check + operational checks +
performance checks/optimizations over multiple weeks, covering *every line and
algorithm*; operate autonomously on a daily schedule with **full autonomy including
auto-merge/deploy**; lead with **quant & algorithm correctness**; pace to make full
use of the **$20 Claude Pro plan**.

This program EXTENDS — does not replace — `workspace/CONTINUOUS_IMPROVEMENT_LOOP.md`
(Learn→Feedback→Rectify→Review, VERIFY A–F, INSPECT 1–6, WR-floor rules). It is
driven by a scheduled cloud routine (cron) whose per-run procedure is §6 below and
whose work queue is `workspace/coordination/PROGRAM_QUEUE_2026-06-15.md`.

---

## 1. Scope & goal

Systematically verify and optimize the entire codebase — **~31k LOC TS/TSX (lib,
app, components, hooks) + 34 Python files**, 85 vitest + 8 pytest suites — one
bounded *cell* (a module/algorithm + its tests + a perf profile) per daily run, so
that over the program every file and algorithm gets a dedicated correctness +
performance pass. Definition of done for a cell:
1. **Correctness** — line-by-line review; no NaN/look-ahead/off-by-one/guard gaps;
   targeted tests pass; missing invariant/property tests added.
2. **Operational** — for API/route/provider/data cells: health + smoke verified.
3. **Performance** — hot paths profiled, measured, optimized behavior-preservingly
   (output-parity test required before any optimization merges).
4. **Recorded** — cell status + findings in the queue ledger; VERIFY A–F in
   `MEMORY_LOG.md`; daily report under `workspace/coordination/daily/`.

## 2. Task force (workstreams) — quant leads

| WS | Domain | Surface | Order |
|----|--------|---------|-------|
| **WS-Q** | Quant & algorithm correctness | `lib/backtest` (13f/3.1k), `lib/optimize` (3f/0.8k), `lib/quant` (26f/4.1k), `quant_framework/*.py` | **1 (lead)** |
| **WS-PY** | Python / ML tier | `server_trading_agents.py`, `server_options.py`, `alpha_miner.py`, `multi_agent_factor_mining/`, `trading_agents_*` | 2 |
| **WS-A** | API, security & ops | `app/api` (30 routes), `lib/api`, `lib/data` (providers), `middleware.ts`, smoke/health | 3 |
| **WS-P** | Performance & optimization | backtest engine, data load, signal compute, chart render, bundle size — cross-cutting | 4 (interleaved + weekly) |
| **WS-F** | Frontend/UX & a11y | `components` (62f/9k), `app` (52f/9.1k), `hooks` (7f/1.7k) | 5 |

Each WS has an ordered cell list in the PROGRAM_QUEUE. The daily run draws the next
`pending` cell respecting WS order (WS-Q exhausted before WS-PY, etc.), except the
weekly deep-sweep day (§7) which is cross-cutting.

## 3. Roles (per CONTINUOUS_IMPROVEMENT_LOOP §Agent roles)

The routine plays all roles in one cold-start session: **Coordinator** (boot, select
cell, record), **Implementer** (fix), **Verifier** (VERIFY A–F, benchmark double-run),
**ci-investigator** (triage any red check). It does NOT skip Verify after fixing.

## 4. Autonomy policy & guardrails (FULL AUTONOMY incl. auto-merge/deploy)

Owner granted auto-merge/deploy. Responsible auto-merge requires **ALL** of these,
else the change is left as an open PR and a blocker is logged (escalate, never force):

**AUTO-MERGE allowed only when:**
1. Change is in a **SAFE category** (§4a).
2. **All CI gates green:** typecheck · test · coverage · benchmark · smoke · Vercel.
3. **Benchmark net WR ≥ floor** (`53.29` net / aggregate `≥ 55%`; treat `< 56.35%`
   as investigate) — **no regression vs the pre-change run**.
4. tsc clean · no secrets in diff (VERIFY C/D) · no NaN/leakage (VERIFY F).
5. Diff within blast radius (≤ ~8 files / ≤ ~400 LOC for a single cell; larger →
   split or escalate).
6. **Post-merge prod smoke passes** (`/`, `/api/sector-rotation`, `/api/analytics/AAPL`
   via Vercel deploy). **If prod smoke fails → auto-revert (`git revert` + redeploy) +
   escalate.**

### 4a. SAFE categories (auto-mergeable)
Bug fix with a regression test; NaN/guard/finite hardening; dead-code removal
(grep-verified across hooks/app/lib/components/scripts/__tests__ **and** `tsc`);
offline-tier (python sidecar) fixes; behavior-preserving perf optimization (with an
output-parity test); added tests/docs; dependency **patch** bumps that pass full CI.

### 4b. DENY — escalate to owner, NEVER auto-merge
- Anything that **changes published numbers** (WR / returns / Sharpe / metrics) →
  needs an owner re-baseline (the standing "don't change published numbers" rule;
  e.g. **F-4 net-of-cost WR**).
- API/response-contract or schema changes; auth/security-policy changes; secret/env
  changes (agent never sets secrets); CSP enforce flip.
- Deleting tested-but-dormant modules (`lib/portfolio/riskParity` class); major/
  `--force` dependency bumps; Next.js major; **V-8 npm audit** (needs clean-env run).
- Any change whose correctness the routine cannot prove with a test.

### 4c. HARD STOPS (abort the run, log blocker, push notification if configured)
- Benchmark WR below floor and cause not understood → revert, do not merge.
- Prod smoke red post-deploy → auto-revert + stop.
- CI red it can't fix in-run → leave PR open, escalate.
- Repeated tool/mount failure → checkpoint and stop (don't burn budget).

## 5. $20 Pro-plan budget discipline

The Pro plan has rolling 5-hour + weekly usage limits. To "make full use" without
stalling the program:
- **One bounded cell per daily run** (not the whole codebase) → steady, predictable burn.
- **Durable incremental state**: update the queue ledger + a CHECKPOINT after each
  sub-step, so a mid-run limit/timeout loses ≤ one sub-step and the next run resumes.
- **Never re-derive context**: each run boots from the state files, not from scratch.
- **No speculative re-runs**: rely on CI as the gate; don't loop the full vitest suite
  locally on the FUSE mount (it freezes — see MEMORY_LOG env lessons; pytest is fine).
- If a run hits the usage cap mid-cell → checkpoint and exit cleanly; the cron picks
  up next cycle. Cadence is tunable in §7 if there's headroom or if caps are hit.

## 6. Daily run procedure (cold-start; encoded in the cron prompt)

1. **BOOT/INSPECT** — read `AGENT.md`, `workspace/SESSION_STATE.json`, `MEMORY_LOG.md`,
   this plan, and `PROGRAM_QUEUE_2026-06-15.md`; recall memory. `git fetch`; checkout
   latest `main`; symlink `node_modules` to repo root (the `@` path breaks npm ESM).
2. **RECONCILE prior runs** — for any PR opened by a previous run: if CI now green +
   SAFE → apply §4 auto-merge (then post-merge smoke + §4c); if red → fix or escalate.
3. **SELECT CELL** — next `pending` cell by WS order (or the weekly sweep on the deep day).
4. **VERIFY (correctness)** — read module + tests; line-by-line bug review; run targeted
   `pytest` / `node node_modules/vitest/dist/cli.js run <file>`; add invariant/property
   tests for algorithms; for signal/backtest cells run `npm run benchmark` (record WR).
5. **PROFILE (performance)** — measure the cell's hot path; optimize only with a parity
   test; re-measure and record the delta.
6. **OPS** (API/route/provider/data cells) — `npm run check:smoke:local` / health.
7. **FIX + GATE** — smallest diff on a branch `auto/<ws>-<cell>-YYYY-MM-DD`; tsc + targeted
   tests + benchmark; commit with VERIFY notes; push; open PR.
8. **AUTO-MERGE per §4** (or escalate). Post-merge: CI on merge commit + prod smoke;
   auto-revert on smoke failure.
9. **RECORD** — queue cell → `done`/`partial`/`blocked` (+ findings/perf delta);
   `MEMORY_LOG` VERIFY A–F row; daily report `workspace/coordination/daily/
   PROGRAM-DAY-YYYY-MM-DD.md`; bump `SESSION_STATE.last_program_run`.
10. **CHECKPOINT** — if near a limit, write CHECKPOINT and exit cleanly.

## 7. Schedule — daily + weekly deep sweep

Implemented as the Claude Code scheduled task **`quantan-autonomous-program`**
(`~/.claude/scheduled-tasks/quantan-autonomous-program/SKILL.md`), cron `0 9 * * *`.

- **Daily run** — every day at **09:00 local time**. NOTE: this scheduler runs while
  the Claude app is open; if the app was closed when a run was due, it runs **on next
  launch**. So it is "one bounded cell per day whenever the app is next open," not a
  server-side cloud cron. One cell per run.
- **Weekly DEEP SWEEP** — the **Monday** run branches to the deep sweep (same task; the
  prompt checks day-of-week): full `npm run benchmark` + `benchmark:oos` +
  `portfolio:backtest` + `stryker` + `npm audit --omit=dev` + cross-cutting perf profile
  + reconcile `findings-ledger.csv` + milestone update in this doc. No single cell.
- Time/cadence adjustable via the **Scheduled** sidebar or `update_scheduled_task`. Raise
  to twice-daily if Pro-plan headroom allows; drop to weekdays-only if usage caps are hit
  (the routine logs usage outcomes in the daily report to tune this).

## 8. Milestones / exit criteria

| M | Criteria |
|---|----------|
| **M1** | WS-Q cells all `done` (backtest/optimize/quant/quant_framework verified + perf-profiled) |
| **M2** | WS-PY + WS-A `done`; all 30 API routes ops-verified; provider resilience confirmed |
| **M3** | WS-P pass complete: documented perf deltas on every identified hot path |
| **M4** | WS-F `done`; a11y axe clean; chart/render paths covered |
| **M5** | Full coverage ledger green; mutation score baseline; zero open auto-program blockers |

Each weekly deep-sweep day updates the milestone table + a one-line program status here.

## 9. Tracking artifacts

- **Queue/coverage ledger:** `workspace/coordination/PROGRAM_QUEUE_2026-06-15.md` (SSOT for cell status)
- **Daily reports:** `workspace/coordination/daily/PROGRAM-DAY-YYYY-MM-DD.md`
- **Findings:** `reviews/findings-ledger.csv` (formal) + `IMPROVEMENT_BACKLOG.json`
- **Verify log:** `workspace/MEMORY_LOG.md`
- **State:** `workspace/SESSION_STATE.json` (`last_program_run`, `program_checkpoint`)

*Created 2026-06-15. The scheduled routine maintains §8 + the queue; the owner adjusts
§4 policy and §7 cadence.*
