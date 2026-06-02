# QUANTAN — Full-Stack Team Rectification: Master Execution Plan — 2026-06-01

**Author:** Claude Code (Opus 4.8), inspector-lead / coordinator.
**Purpose:** A single execution plan a full-stack developer team can pick up to engage the
rectification of QUANTAN. Synthesises the structural analysis + the 2026-05-30 D1–D5 inspection
(52 findings) + the parallel-agent work already done.

**Source-of-truth documents (read in this order):**
1. `workspace/INSPECTION_PROGRAM_2026-05-30.md` — the 52-finding D1–D5 inspection (severity + buckets).
2. `workspace/coordination/TEAM_RECTIFICATION_2026-06-01.md` — guardrails, OFF-LIMITS file table, WS map.
3. `workspace/coordination/CONSOLIDATION_2026-06-01.md` — verified status of the parallel run.
4. `workspace/coordination/reports/WS2.md` (quant spec), `WS4.md` (frontend blueprint),
   `WS5.md` (tracker spec), `WS1_FIX_PLAN_2026-06-01.md` (security fix detail).

---

## Part A — Architecture & module map (onboarding for a new team)

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · yahoo-finance2 · Vitest · lightweight-charts.
Deploys to Vercel (`quantan.vercel.app`) on merge to `main`. ~35,700 LOC TS across 212 files +
~6,400 LOC Python sidecars.

### Layers
- **`app/`** (52 files) — App Router. **27 API routes** (`app/api/**/route.ts`) + **15 pages**.
  API routes follow a canonical pattern: `normalizeTicker` (SSOT input validation) → `withRetry`/
  timeout around Yahoo → finite-or-null boundary filtering → `errorResponse`/`sanitizeError` envelope
  → `Cache-Control` headers. Pages are client components pulling from those routes via SWR/hooks.
- **`lib/`** (94 files) — the core. Sub-domains:
  `quant/` (26 — indicators SSOT, signals math, regime, sector rotation),
  `backtest/` (9 — engine, portfolioBacktest, signals, executionModel, walkForward, exitRules),
  `data/` (11 — provider abstraction yahoo/polygon/alphavantage/fred, SQLite warehouse, bloomberg bridge),
  `portfolio/` (8 — VaR, riskParity, stressTest, diversification, tracker),
  `optimize/` (3), `api/` (5 — rateLimit, csrf, sanitize, reliability), `options/` (5), `auth.ts`.
- **`components/`** (56 files) — React. Largest: `KLineChart.tsx` (1039 — cohesive),
  `DarkPoolPanel`, options/*, backtest/*, stock/quantlab/*.
- **Python sidecars** (separate services, HTTP-proxied, NOT imported by TS):
  `server_trading_agents.py` (LLM multi-agent, via `TRADING_AGENTS_BASE`),
  `ml/` ensemble (via `ML_SIDECAR_URL`), `quant_framework/` GARCH (via `QUANT_FRAMEWORK_URL`),
  bloomberg bridge (via `BLOOMBERG_BRIDGE_URL`). `alpha_miner.py` / `multi_agent_factor_mining/` are
  **orphaned** from the TS app (research-only; no runtime link). Staffing note: the TS app is fully
  functional without any Python service (all proxies fail-closed/degrade) — a JS/TS full-stack team
  can own 90% of this; Python is optional/specialist.

### The 7 god-files (complexity hotspots, for assignment)
`components/KLineChart.tsx` 1039 · `app/crypto/btc/page.tsx` 813 · `lib/backtest/signals.ts` 732 ·
`lib/quant/indicators.ts` 667 · `app/stock/[ticker]/page.tsx` 654 · `lib/backtest/engine.ts` 643 ·
`lib/backtest/portfolioBacktest.ts` 608.

### Two structural facts the team MUST know
1. **Dual signal path.** The production *label* benchmark (`scripts/benchmark-signals.ts`, **53.79%
   net**, verified honest) is SEPARATE from the §2 *portfolio-simulation* metrics shown in the UI
   (`lib/backtest/portfolioBacktest.ts`). The quant bugs (WS2) affect the *portfolio-sim metrics*,
   NOT the production label. Don't conflate them.
2. **Indicator SSOT.** `lib/quant/indicators.ts` is canonical; `lib/quant/technicals.ts` is a thin
   delegate layer (no duplicate math). KLineChart's `calc*` are already thin delegates (a prior
   "reimplementation" finding was a false positive).

### Health baseline (`main` @ `8d56955`, verified)
tsc clean · vitest 979 pass / 17 skip (81 files) · `npm run build` PASS · benchmark 53.79% net.
0 TODO/FIXME · 0 `@ts-ignore`. Mature, green codebase — rectification is targeted, not a rewrite.

---

## Part B — Work already done (parallel agent run, 2026-06-01)

All branches fork `main` @ `8d56955`. **Nothing is pushed/PR'd — merges = production deploys = owner-only.**

| Branch | Findings | State | Verify |
|--------|----------|-------|--------|
| `fix/ws1-api-security-fixed` @ `58b49c3` | D4-1, D4-3 | ✅ DONE (Bucket B draft) | tsc clean · 992/17/0 |
| `fix/ws3-structure-safe` @ `d4e409e` | D1-3 | ✅ DONE | tsc clean · 979/17 |
| `fix/ws5-tracker-reconcile` @ `1f6e01c` | D2-4 + tracker | ✅ DONE | tsc clean · 979/17 |
| `fix/darkpool-fetchedat-freshness` @ `6b371d1` | D3-11 | ✅ DONE | tsc clean · 979/17 |
| (specs) WS2.md | D2-1/2/5/6/7 | 📋 spec only | n/a |
| (specs) WS4.md | D3-2/8/9 | 📋 blueprint | n/a |

Plus the pre-existing open PRs **#24–#32** (the inspection's §2 covers their merge order).

---

## Part C — Team workstreams & assignments

Roles map to a typical full-stack team. Each item cites its finding + bucket (A=safe, B=needs-decision).

### Role 1 — Backend / API engineer
- **[READY, owner-decision] D4-1 security** — review `fix/ws1-api-security-fixed`; OWNER picks auth
  posture (provision `QUANTAN_API_KEY` vs require-session-only), then it can become a PR. HIGH severity.
- **[A] D5-3/D5-4/D5-7/D4-2** — already done in PR #31; review & merge.
- **[SPEC, after #28+#31] D1-5** — eliminate `lib/quant/technicals.ts` wrapper (blocked: importers in
  engine.ts/#28 + ma-deviation/#31). Spec in WS3 territory; ~6 importers to migrate to `indicators.ts`.

### Role 2 — Quant / algorithms engineer (Bucket B — needs re-baseline discipline)
Execute **WS2.md** spec (read it fully). All re-baseline the §2 portfolio-sim metrics, none touch the
production label. Priority order:
- **D2-1 (HIGH)** portfolioBacktest BUY fills same-bar close (look-ahead) → T+1 like engine.ts.
- **D2-2 (MED)** pnlPct gross-of-cost while equity net → inflates WR/PF.
- **D2-6 (MED)** enhanced-path ATR score inverted for dip-buy.
- **D2-5 (LOW)** priceWasNearSmaRecently uses today's SMA. **D2-7 (LOW)** 252 annualization w/ BTC.
- Each needs a documented C1/C2 re-baseline in `reviews/invariants-baseline.md` (sequence after #28).
- **Blocked:** portfolioBacktest.ts is in PR #29, engine.ts in #28 — do after they merge.

### Role 3 — Frontend engineer
- **[A] a11y sweep** — done in PR #32; review & merge. Then apply the stacked
  `fix/darkpool-fetchedat-freshness`.
- **[SPEC, after #32] D3-2/8/9** — execute **WS4.md** blueprint: decompose `app/crypto/btc/page.tsx`
  (813 LOC) mirroring the backtest-page pattern; co-locate `useQuantLabLlm` hook (LlmTab prop-drill);
  extract duplicated `buildVisFromIndicatorPreset`.

### Role 4 — Architecture / platform
- **[A] D1-3** — done on `fix/ws3-structure-safe` (5 dead mockData exports removed); review & merge.
- **[SPEC, after #28] D1-1** — break engine↔walkForward circular dep (extract `backtestInstrument`
  to `lib/backtest/core.ts`). **D1-6** — install `eslint-config-next` + audit the 4 `exhaustive-deps`
  suppressions for real stale-closure bugs.

### Role 5 — Docs / QA
- **[A] D2-4** — done on `fix/ws5-tracker-reconcile` (regimeSignal docstring); review & merge.
- **[A] tracker reconciliation** — apply WS5.md spec to `IMPROVEMENT_BACKLOG.json` (close
  Q-008/019/037, mark Q-035 partial, note Q-005; mark F1.11 fixed).

---

## Part D — Sequencing (dependency-ordered)

```
NOW (owner): merge existing PRs in inspection §2 order:
  #30 → #27 → #25 → #28 → #29 → #26 → #24(REWORK first)
  ... and review the new A-bucket branches: #31, #32, ws3, ws5, darkpool-fetchedat.
AFTER #28 merges:  D1-1 (engine core.ts) · WS2 quant re-baselines · invariants §-edits.
AFTER #28+#31:     D1-5 technicals.ts wrapper removal.
AFTER #32 merges:  WS4 frontend decompositions · fold darkpool-fetchedat-freshness.
OWNER DECISION:    D4-1 auth posture → then WS1 becomes a PR.
ANYTIME (safe):    WS5 tracker JSON · D1-6 eslint.
```

## Part E — Acceptance criteria (every workstream)
- `node node_modules/typescript/bin/tsc --noEmit` clean (symlink node_modules in worktree first).
- `node node_modules/vitest/dist/cli.js run` ≥ 979 pass / 17 skip (+ any new tests).
- Signal/backtest changes: `npm run benchmark` net WR ≥ 53.29% floor (invariants §1b) + C1/C2 note.
- No edits to OFF-LIMITS files (the table in TEAM_RECTIFICATION_2026-06-01.md). No push to main.
- Bucket-B code: reviewable draft + owner sign-off before PR.

## Part F — Known environment gotchas
- Path contains `@` → npm scripts' ESM resolver breaks. Run tools via node entrypoints; symlink
  `node_modules` to repo root in each worktree.
- Worktree + symlinked node_modules + `vite-tsconfig-paths` can't resolve worktree-ONLY new files
  for vitest (existing files fine). tsc is the authoritative local gate; new-file runtime tests need
  real `node_modules`/CI (or the temp-root-resolution trick documented in WS1_FIX_PLAN).
- Google-Drive-mounted FS: `next dev`/`next start` are slow to bind locally; rely on `npm run build`
  + production smoke. File reads can stall intermittently — retry.
