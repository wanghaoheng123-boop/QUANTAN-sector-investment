# QUANTAN Future Improvement Plan

**Date:** 2026-05-23 (synced — supersedes 2026-05-21 audit)
**Audience:** Claude Code / Cursor agents
**Repo:** `QUANTAN-sector-investment`
**Canonical plan:** `reviews/PHASE-15-PLAN.md` ← **START HERE**
**Backlog:** `workspace/IMPROVEMENT_BACKLOG.json` (50 tasks: 9 done, 3 partial, 38 pending)
**Quick start:** `workspace/CLAUDE_CODE_INSTRUCTIONS.md`

---

## CLAUDE CODE START HERE

```
1. Read reviews/PHASE-15-PLAN.md (canonical) before any work.
2. Read workspace/IMPROVEMENT_BACKLOG.json — work tasks in priority order
   within their phase15_sprint slot (S1 → S4).
3. Read AGENT.md boot rules; never commit unless user asks.
4. Before each task: grep/read listed files; after each: run verify_commands.
5. Benchmark floor: aggregate WR >= 56.35% (re-baselines after F1.4 + F1.5 land in S2).
6. Do not regress test count below 798 (was 486 in pre-2026-05-21 snapshot).
7. Default first task: Q-039-NEW (auth regex P0).
```

---

## Executive summary (2026-05-23)

1. **Core is healthier than May-21 snapshot:** **798 tests pass** (was 486; +312 since PR#12 Phase 14 S1 sweep + waves 37–41). Canonical benchmark **57.05%** WR (above **56.35%** floor; up from 56.96% on 05-21). **Enhanced WR 52.63%** (vs baseline −3.72pp; was −5.81pp — improving but still below floor, **Q-009 still P0**).
2. **33 open Phase-13/14 findings** in `reviews/findings-ledger.csv` (down from 36). Top: distributed rate limit (F4.3), FRED RFR (F1.4/F3.9), API integration tests (F8.4), CI gaps (F8.6/F8.7), god-component decomp (F5.2/F5.3).
3. **Uncommitted main drift RESOLVED:** Q-026 closed via PR#16 (commit `7321b54`) — all `lib/portfolio/*`, `lib/data/providers/*`, `SectorRotationPanel.tsx` files present on main. `AuthNav.tsx` intentionally replaced by `SafeAuth.tsx`.
4. **AGENTS.md still drift:** 7-phase plan markers don't reflect current state — Q-007 cleans this up in S3.
5. **CI:** `.github/workflows/ci.yml` = **typecheck only** (unchanged). **Q-001 P0 in S1** wires test + benchmark + check:ci.
6. **NEW Phase 15 findings (10 net-new in `IMPROVEMENT_BACKLOG.json`):**
   - **Q-039-NEW** (P0) — auth regex `/[ -]/` rejects legitimate names + accepts XSS/null payloads
   - **Q-040-NEW** (P0) — CSP still Report-Only with `unsafe-inline`+`unsafe-eval`
   - **Q-041-NEW** (P0) — GARCH conditional vol (R9-C-1)
   - **Q-042-NEW** (P0) — HMM 3-state regime (R9-C-2)
   - **Q-043-NEW / Q-045-NEW / Q-046-NEW** — scenario engine + tail-risk + portfolio Greeks (R9-C-3/-4/-H-2)
   - **Q-044-NEW** — factor attribution (R9-C-5)
   - **Q-047-NEW** — Stryker mutation testing setup (F8.3)
   - **Q-048-NEW** — Polygon provider primary + dispatcher (F4.5/F7.8 evolution)
   - **Q-049-NEW** — `useLiveQuote` lifecycle tests
   - **Q-050-NEW** — crypto WS-primary architecture (REST-fallback only on flap)

---

## Verified snapshot (2026-05-23)

Collected from worktree `competent-wu-a84629` (synced with main via PR #16).

| Metric | Value | Command / source |
|--------|-------|------------------|
| **Git branch** | `fix/options-investigation` (synced to main via PR#16) | `git branch --show-current` |
| **Last 5 commits** | `7321b54` wave 40-41 · `db4c431` wave 39 · `e2f82b6` SSE waves 37-38 · `f525f57` SSE wave · `fe8cd96` Phase 14 S1 sweep | `git log -5 --oneline` |
| **Test files** | **48** | `find __tests__ -name '*.test.ts*' \| wc -l` |
| **Test cases (vitest)** | **798 passed** | `npm run test` (2.79s, 2026-05-23) |
| **Open findings** | **33 open · 54 FIXED · 3 closed · 90 data rows** | `reviews/findings-ledger.csv` |
| **Canonical benchmark WR (floor)** | **56.35%** | `reviews/invariants-baseline.md` (re-baselines in S1) |
| **Canonical benchmark WR (run)** | **57.05%** | `scripts/benchmark-results.json` |
| **Enhanced benchmark WR** | **52.63%** (−3.72pp vs baseline) | `scripts/benchmark-results-enhanced.json` |
| **Loop 1 grid results** | Present | `scripts/optimization-results-loop1.json` |
| **Portfolio backtest results** | Present (2026-05-14 run) | `scripts/portfolio-backtest-results.json` |
| **Largest component LOC** | **1,684** (`QuantLabPanel.tsx`) | S3 target ≤ 500 |
| **Largest lib LOC** | **807** (`engine.ts`) | S3 target ≤ 600 |
| **Silent `.catch(() => {})`** | **0** | `rg "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}" lib app components` |
| **Backlog tasks** | **50 total, 38 pending** | `workspace/IMPROVEMENT_BACKLOG.json` |

---

## Code vs docs drift (AGENTS.md vs disk NOW)

| AGENTS.md claim | Actual 2026-05-23 | Action |
|-----------------|-------------------|--------|
| `lib/portfolio/*` complete | **All 5 files present** (PR#16 confirmed) | Update Phase 6 docs |
| `lib/data/providers/` + fallback chain | **All 6 files present**; types in `types.ts` | Update Phase 5 docs (Q-007) |
| `components/SectorRotationPanel.tsx` | **Present** at 143 LOC | Update Phase 4 docs |
| **266 / 486 tests passing** | **798 tests / 48 files** | Q-014 re-baseline |
| Phase 8 scripts "TO CREATE" | All exist + JSON results present | Mark Phase 8 complete |
| `scripts/backtest/engine.ts` | **Deleted**; canonical `lib/backtest/engine.ts` (807 LOC) | Confirm no imports |
| Benchmark "≥ 55%" guard only | Enhanced **52.63%** still below 56.35% | Q-009 — feature-flag off until ≥ 56.35% |
| `Math.random` in `lib/` = 0 | **1** use in `lib/api/reliability.ts` (retry jitter) | Document (jitter is intentional) |
| Silent `.catch(() => {})` = 4 | **0** empty catches | RESOLVED in wave 35 (Q-012 done) |

---

## Module inventory (major areas)

### `lib/backtest/` (present, active)

| File | LOC | Role |
|------|-----|------|
| `engine.ts` | **807** | Trade simulation; F1.3 intraday stops RESOLVED via `evaluateStopHit` primitive. **Q-008/F5.2 target: extract walkForward (P15-NEW-10) → ≤ 600** |
| `signals.ts` | 681 | `enhancedCombinedSignal`, sector gates; **Q-009 P0 — flag off prod path** |
| `exitRules.ts` | 312 | ATR stops; **F1.22 / Q-016 still open** (forming-bar bias) |
| `portfolioBacktest.ts` | 604 | Multi-position engine (tests exist); **Q-031 still imports from `@/scripts/backtest/dataLoader`** |
| `dataLoader.ts` | — | JSON/SQLite load; **Q-018 — under-tested** |

### `lib/quant/` (SSOT + legacy)

| File | Notes |
|------|-------|
| `indicators.ts` | Canonical SMA/EMA/RSI/MACD/ATR/ADX (667 LOC) |
| `technicals.ts` | **Q-032 OPEN** — legacy `rsi()` at L28 and `sharpeRatio(rf=0.04)` at L61 still exported |
| `constants.ts` | **BACKTEST_RFR_ANNUAL=0.045** (Q1-H-2 bumped), **OPTIONS_RFR_ANNUAL=0.0525** — **Q-004 P1 (S2)** to replace with FRED |
| `regimeDetection.ts`, `sectorRotation.ts`, `intermarket.ts` | Phase 4 analytics — **Q-042-NEW will replace ad-hoc regime with HMM** |

### `lib/options/`

| File | Notes |
|------|-------|
| `chain.ts` | Yahoo + Greeks; wave 39 dead-code gate fixed; wave 40 picker fix; F3.9 RFR static |
| `greeks.ts`, `gex.ts`, `flow.ts`, `sentiment.ts` | All tested; wave 41 added regression tests |

### `lib/data/`

| File | Notes |
|------|-------|
| `warehouse.ts` | SQLite — **Q-017 still untested** |
| `mergeQuotes.ts` | Has tests; per-field provenance via `QuoteProvenance` |
| `bloomberg/bridgeClient.ts` | **Q-037 / F7.5** still open (timing-safe TBD) |
| `providers/{yahoo,polygon,fred,alphavantage}.ts` | All present; no dispatcher yet — **Q-048-NEW in S4** |

### `lib/optimize/`

| File | Notes |
|------|-------|
| `gridSearch.ts` | **Q-031 OPEN** — imports `@/scripts/backtest/dataLoader` |
| `sectorProfiles.ts`, `parameterSets.ts` | Loop 1/2 params |

### `app/api/` (25 routes)

Notable: `prices`, `options/[ticker]`, `analytics/[ticker]`, `sector-rotation`, `stream/[ticker]` (SSE), `backtest`, `ml/[ticker]`, `trading-agents/[ticker]`. **Q-020 / F8.4 — no route-handler integration tests**.

### `app/` pages (13)

`page.tsx` (desk), `stock/[ticker]`, `backtest` (887 LOC — Q-019), `heatmap`, `briefs`, `crypto/btc` (806 LOC — over budget; **Q-050-NEW WS primary**), `ma-deviation`, `commodities`, `desk`, `sector/[slug]` (now on SSE per wave 37). **No `app/portfolio/page.tsx` — Q-028 in S4.**

### `components/`

| File | LOC | Issue |
|------|-----|-------|
| `stock/QuantLabPanel.tsx` | **1,684** | F5.2 / Q-008 monolith (grew from 1,653 baseline) |
| `KLineChart.tsx` | **1,014** | F-NEW — needs plugin registry + Suspense |
| `crypto/BtcQuantLab.tsx` | 516 | needs decomp; has `setInterval` 30s |
| `DarkPoolPanel.tsx` | 339 | OK |
| `GlobalSearch.tsx` | 318 | uses SWR + 280ms debounce |
| `options/OptionsChainTable.tsx` | 229 | wave 41 added `memo` + `useMemo` perf |

### `scripts/`

| Script | Status |
|--------|--------|
| `benchmark-signals.mjs` | Canonical floor reference (57.05% WR) |
| `benchmark-enhanced.ts` | Produces enhanced JSON (52.63% WR — Q-009) |
| `optimize-grid.ts` | Loop 1 — results file present |
| `portfolio-backtest.ts` | Results JSON present (2026-05-14 run) |

### `.github/workflows/`

| Workflow | Runs |
|----------|------|
| `ci.yml` | **`npm ci` + `typecheck` only** — Q-001 P0 expands it |
| `refresh-data.yml` | Weekly backtest data |

### `hooks/` (NEW since 2026-05-21 snapshot)

| File | LOC | Notes |
|------|-----|-------|
| `useLiveQuote.ts` | 268 | EventSource lifecycle for single-ticker SSE |
| `useLiveQuotes.ts` | 240 | Multi-ticker SSE fan-out, MAX_LIVE_STREAMS=20 |
| `useLivePrices.ts` | 125 | SWR-based price polling |
| `useDialogA11y.ts` | 102 | Focus trap + return focus + body lock |
| `useWatchlist.ts` | 83 | localStorage wrapper with quota guard |
| `useErrorToast.ts` | 74 | Toast queue for error UX |

---

## Findings by domain (open ledger + code evidence)

### Quant / Backtest — P0/P1

| ID | Pri | Problem | Evidence | Fix | Verify |
|----|-----|---------|----------|-----|--------|
| Q-009 | P0 | Enhanced WR < floor | `benchmark-results-enhanced.json` 52.63% (vsBaseline −3.72pp) | Feature-flag off | `npm run benchmark:enhanced` |
| F1.4 / Q-004 | P1 | RFR hardcoded 4.5% | `engine.ts`, `constants.ts` L33 | FRED `getRiskFreeRate()` | `npm run test` |
| F1.5 / Q-021 | P1 | B&H ignores dividends | `engine.ts` ~343 | Yahoo dividends array | engine tests + benchmark |
| F1.22 / Q-016 | P1 | ATR includes entry bar | `exitRules.ts` L80–82 | Prior bar only | `__tests__/backtest/exitRules.test.ts` |
| F1.11 / Q-025 | P2 | Linear RSI score | `signals.ts` ~561 | Piecewise per Wilder (1978) | signals tests + benchmark |
| F1.15 / Q-038 | P3 | oosRatio clamp | `engine.ts` ~633 | Unclamp or doc | engine tests |

### Options — P1

| ID | Pri | Problem | Evidence | Fix | Verify |
|----|-----|---------|----------|-----|--------|
| F3.9 | P1 | RFR 5.25% static | `constants.ts` L42, `chain.ts` | Tenor-matched FRED (Q-004) | `npm run test` |

### Data / API — P0/P1

| ID | Pri | Problem | Evidence | Fix | Verify |
|----|-----|---------|----------|-----|--------|
| F4.3 / Q-005 | P0 | In-memory rate limit | `lib/api/rateLimit.ts` L13 | Vercel KV / Upstash | rateLimit tests |
| F4.5 / Q-048-NEW | P1 | Yahoo ToS + Polygon migration | All yahoo routes | Provider dispatcher | smoke local |
| Q-017 | P2 | warehouse untested | `lib/data/warehouse.ts` | Unit tests | new file |
| Q-018 | P2 | dataLoader untested | `lib/backtest/dataLoader.ts` | Unit tests | new file |

### Frontend — P1/P2

| ID | Pri | Problem | Evidence | Fix | Verify |
|----|-----|---------|----------|-----|--------|
| F5.2 / Q-008 | P1 | QuantLab **1,684 LOC** | `QuantLabPanel.tsx` | Split into 5 tabs | typecheck + smoke |
| F5.3 / Q-019 | P1 | backtest page 887 LOC | `app/backtest/page.tsx` | Extract components | smoke |
| F-NEW | P1 | KLineChart 1,014 LOC | `components/KLineChart.tsx` | Plugin registry | visual regression |
| F5.5–F5.10 | P2/P3 | tokens, ARIA, DRY | various | Incremental | smoke |

### Security — P0/P3

| ID | Pri | Problem | Evidence | Fix | Verify |
|----|-----|---------|----------|-----|--------|
| Q-039-NEW | P0 | Auth regex bug | `lib/auth.ts:124` `/[ -]/` | `/[\x00-\x1f\x7f]/` | new test file |
| Q-040-NEW | P0 | CSP Report-Only + unsafe-inline | `next.config.js` | Enforce + nonces | curl headers |
| Q-029 | P2 | `hostname:'**'` | `next.config.js:65` | Explicit allowlist | `npm run build` |
| F7.2 / Q-023 | P1 | Error leak in `reliability.ts` | `lib/api/reliability.ts:50` | sanitize | Q-023 |
| F7.3 / Q-015 | P1 | Ticker fuzz absent | API routes | property test | Q-015 |
| F7.4 / Q-036 | P3 | CSRF on POST | backtest, trading-agents | CSRF middleware | Q-036 |
| F7.5 / Q-037 | P3 | Bridge secret compare | `bridgeClient.ts` | `timingSafeEqual` | Q-037 |

### Testing / CI — P0/P1

| ID | Pri | Problem | Evidence | Fix | Verify |
|----|-----|---------|----------|-----|--------|
| Q-001 | P0 | CI is typecheck-only | `.github/workflows/ci.yml` | Add test/benchmark/check:ci | inspect |
| F8.6 / Q-022 | P1 | Coverage not enforced | `vitest.config.ts` | Run coverage in CI + expand include | Q-022 |
| F8.4 / Q-020 | P1 | No API integration tests | `app/api/` | Route tests | Q-020 |
| F8.1 | P1 | Hot paths untested | chain, warehouse, dataLoader, auth | Module tests | Q-006 done, Q-017, Q-018, Q-039-NEW |
| F8.2 / Q-027 | P2 | No component tests | missing dir | RTL setup | Q-027 |
| F8.3 / Q-047-NEW | P1 | No mutation testing | absent | Stryker | Q-047-NEW |

### Portfolio / Risk — P1/P2

| ID | Pri | Problem | Evidence | Fix | Verify |
|----|-----|---------|----------|-----|--------|
| Q-002 | P1 | Portfolio invariants not in baseline | `portfolio-backtest-results.json` exists | Append §2 to invariants doc (Q-014) | inspect |
| Q-028 | P2 | No portfolio page | no `app/portfolio/` | Dashboard | Q-028 |
| Q-046-NEW | P1 | No portfolio Greeks | absent | Aggregate Δ Γ ν θ ρ | Q-046-NEW |

### Institutional analytics — NEW Phase 15 (P0/P1/P2)

| ID | Pri | Capability | Citation |
|----|-----|------------|----------|
| Q-041-NEW | P0 | GARCH(1,1) conditional volatility | Engle (1982); Bollerslev (1986) |
| Q-042-NEW | P0 | HMM 3-state regime detector | Hamilton (1989); Guidolin & Timmermann (2007) |
| Q-043-NEW | P1 | ScenarioEngine | Jorion (2006) ch.7 |
| Q-044-NEW | P2 | 5-factor attribution | Carhart (1997); Fama-French (2015) |
| Q-045-NEW | P1 | Tail-risk hedging alerts | Bhansali (2014) |

---

## Priority backlog summary

After 2026-05-23 reconciliation: **50 tasks** total (Q-001 → Q-050-NEW).

| Priority | Pending | Examples |
|----------|---------|----------|
| **P0** | 7 | Q-001 CI · Q-005 rate limit · Q-009 enhanced WR · Q-039-NEW auth regex · Q-040-NEW CSP · Q-041-NEW GARCH · Q-042-NEW HMM |
| **P1** | 17 | FRED RFR · QuantLab split · portfolio Greeks · scenario engine · mutation testing |
| **P2** | 11 | Component tests · warehouse tests · ML client tests · portfolio dashboard · factor attribution |
| **P3** | 3 | CSRF · contrast · oosRatio |

Full machine list: `workspace/IMPROVEMENT_BACKLOG.json`.
Detailed plan: `reviews/PHASE-15-PLAN.md`.

---

## Do-not-regress invariants

Source: `reviews/invariants-baseline.md` (re-baselines in S1 / Q-014).

| Invariant | Floor (2026-05-23) | Notes |
|-----------|-------------------|-------|
| Aggregate benchmark WR | **≥ 56.35%** (re-freeze post-FRED) | CI hard-block **< 55.85%** when Q-001 wires it |
| Test count | **≥ 798** (was 279 frozen; re-baseline via Q-014) | `npm run test` |
| Test files | **≥ 48** (was 21 frozen) | |
| TODO/FIXME/HACK in lib/app/components | **0** (2 TODO in `constants.ts` only, intentional) | Accept |
| Silent empty catch | **0** | Was 4; now clean (Q-012 done) |
| `Math.random` in lib | **1** (`reliability.ts` jitter) | Document (intentional) |
| QuantLabPanel LOC | **1,684** | Target ≤ 500 (S3 / Q-008) |
| backtest page LOC | **887** | Target ≤ 200 (S3 / Q-019) |
| KLineChart LOC | **1,014** | Target ≤ 500 (S3) |
| engine.ts LOC | **807** | Target ≤ 600 (S3 / P15-NEW-10) |
| signals.ts LOC | **681** | Target ≤ 600 (S3) |
| Indicator SSOT | `indicators.ts` | `technicals.rsi` duplicate (Q-032) |
| `any` casts | 5 sites documented | No new without reviewer ack |

---

## Phased roadmap (Phase 15 — supersedes Phase A/B/C)

See `reviews/PHASE-15-PLAN.md` for full sprint plan with team tracks + acceptance criteria + risk register.

### Sprint S1 — Security P0 + Phase 14 carry-over (~5 days)

- Q-039-NEW (auth regex P0) · Q-040-NEW (CSP enforcing P0) · Q-001 (CI) · Q-029 (hostname) · Q-014 (rebaseline) · Q-015 (ticker fuzz) · Q-022 (coverage gate) · Q-023 (sanitize) · F4.3/Q-005 prep · P15-NEW-7 (SSE timers)

### Sprint S2 — Quant + Data Platform (~6 days)

- Q-004 (FRED RFR) · Q-021 (B&H dividends) · Q-005 (Vercel KV) · Q-009 (enhanced flag) · Q-016 (ATR forming bar) · Q-041-NEW (GARCH) · Q-050-NEW (crypto WS primary) · Q-017 (warehouse tests) · Q-018 (dataLoader tests)
- **Triggers WR baseline re-freeze.**

### Sprint S3 — God-component decomp + Scenarios (~10 days)

- Q-008 (QuantLab) · Q-019 (backtest page) · F-NEW (KLineChart) · F-NEW (crypto/btc page) · P15-NEW-10 (engine.ts walkForward) · Q-043-NEW (scenarios) · Q-045-NEW (tail-risk) · Q-046-NEW (portfolio Greeks) · F5.5 (design tokens) · F5.6 (ARIA) · Q-031 (dataLoader path) · Q-032 (RSI SSOT) · Q-007 (AGENTS.md) · Q-034 (Loop 1 doc) · Q-047-NEW (Stryker)

### Sprint S4 — HMM + Factor + Testing depth (~8 days)

- Q-042-NEW (HMM) · Q-044-NEW (factor attribution) · Q-025 (piecewise RSI) · Q-027 (component tests) · Q-020 (API integration) · Q-028 (portfolio page) · Q-030 (ML client) · Q-048-NEW (Polygon dispatcher) · Q-036/Q-037 (CSRF + timing-safe) · Q-035 (contrast) · Q-038 (oosRatio) · Q-049-NEW (hook lifecycle tests)

---

## Handoff for Claude Code

Execute in order. Log VERIFY A–F per `AGENT.md`. Mark backlog `status: "done"` + `completed_at` + `notes_<date>` only after verify passes.

**Default first task: Q-039-NEW (auth regex P0)**.

1. **Auth regex (Q-039-NEW)** — `lib/auth.ts:124`
   `npm run test -- __tests__/lib/auth.test.ts` · `npm run typecheck`

2. **CI gate (Q-001)** — `.github/workflows/ci.yml`
   `npm run test` · `npm run benchmark` · `npm run check:ci`

3. **CSP enforcing (Q-040-NEW)** — `next.config.js`
   `npm run build` · `curl -I` headers

4. **Hostname whitelist (Q-029)** — `next.config.js:65`
   `npm run build` · smoke test image loads

5. **Invariants re-baseline (Q-014)** — `reviews/invariants-baseline.md` §3 → 798 / 48 files
   `npm run test`

6. **Sanitize errors (Q-023)** — `lib/api/reliability.ts:50`
   `npm run test`

7. **Coverage gate (Q-022)** — `vitest.config.ts` + ci.yml
   `npm run test:coverage`

8. **FRED RFR (Q-004 / F1.4 / F3.9)** — `lib/quant/constants.ts`, `engine.ts`, `chain.ts`
   `npm run test` · `npm run benchmark` · **trigger WR re-baseline**

9. **B&H dividends (Q-021 / F1.5)** — `lib/backtest/engine.ts`
   `npm run benchmark` · `npm run test -- __tests__/backtest/engine.test.ts`

10. **Vercel KV rate-limit (Q-005)** — `lib/api/rateLimit.ts`, `.env.template`
    `npm run test -- __tests__/api/rateLimit.test.ts`

11. **GARCH sidecar (Q-041-NEW)** — `quant_framework/garch.py`, `app/api/conditional-vol/[ticker]/route.ts`
    `python -m pytest quant_framework/` · `curl /api/conditional-vol/SPY`

12. **QuantLab split (Q-008)** — `components/stock/QuantLabPanel.tsx`
    `npm run typecheck` · `npm run check:smoke:local`

13. **Backtest page split (Q-019)** — `app/backtest/page.tsx`
    `npm run typecheck` · `npm run check:smoke:local`

14. **Scenario engine (Q-043-NEW)** — `lib/scenarios/engine.ts`, `app/risk/scenarios/page.tsx`
    `npm run test -- __tests__/scenarios/`

15. **HMM regime (Q-042-NEW)** — `quant_framework/regime_hmm.py`
    `python -m pytest quant_framework/` · `npm run benchmark`

---

## Key metrics table

| Metric | Value |
|--------|-------|
| Canonical floor WR | **56.35%** |
| Canonical run WR | **57.05%** |
| Enhanced WR | **52.63%** |
| Enhanced vs baseline | **−3.72 pp** (improving from −5.81pp on 05-21) |
| Vitest | **798 / 48 files** |
| Open findings | **33 / 90** |
| Backlog tasks pending | **38 / 50** |
| CI | typecheck only |
| Worktree | merged via PR #16 (commit `7321b54`) |
| Phase 15 sprint duration | ~6 weeks (5+6+10+8 days) |

---

## References

- **`reviews/PHASE-15-PLAN.md`** — canonical Phase 15 plan
- `AGENT.md` / `AGENTS.md` (Q-007 will reconcile)
- `reviews/invariants-baseline.md` (Q-014 will re-baseline)
- `reviews/findings-ledger.csv` (90 rows, 33 open)
- `reviews/PHASE-14-CRITIQUE-LOG.md` (138 historical findings)
- `reviews/PHASE-14-REMEDIATION-ROADMAP.md` (historical roadmap)
- `workspace/IMPROVEMENT_BACKLOG.json` (50 tasks; reconciled 2026-05-23)
- `workspace/CLAUDE_CODE_INSTRUCTIONS.md` (quick start)
- `workspace/SESSION_STATE.json`

---

*Maintain this file, the backlog JSON, and `reviews/PHASE-15-PLAN.md` together when priorities shift. The plan is the canonical source; this file is the snapshot summary.*
