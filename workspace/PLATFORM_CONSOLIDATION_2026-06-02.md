# QUANTAN — Platform Consolidation, Optimization & Inspection-Readiness Roadmap — 2026-06-02

**Author:** Claude Code (Opus 4.8). **Baseline:** `main` @ `de9a3d5` (deployed to Vercel production, smoke PASS).
**Purpose:** Single authoritative reconciliation of the platform's verified state + the optimization/refactor
backlog, sequenced for owner-greenlit execution. **This doc indexes and supersedes the scattered coordination
docs** (`INSPECTION_PROGRAM_2026-05-30`, `coordination/*`, inspection waves 5–10) for go-forward planning —
read this first.

> **Honest framing.** This is a mature, multiply-inspected, green, deployed codebase. The remaining work is a
> small set of *deliberate, sequenced* refactors and a few owner decisions — **not** a mass rewrite. Manufacturing
> broad refactors here adds risk to a working system for diminishing returns. Each item below is scoped to ship as
> its own reviewable PR; **no merge without owner sign-off** (merges = production deploys).

---

## 1. Verified health (baseline `de9a3d5`)

| Check | Result | Evidence |
|-------|--------|----------|
| Typecheck (`tsc --noEmit`) | ✅ PASS | CI on `de9a3d5` |
| Unit/integration tests | ✅ ~1000 pass / 17 skip / 0 fail | CI `test` job |
| Coverage gates (L80 / B70 / F80 / S80) | ✅ PASS | CI `coverage` job |
| Benchmark floor (net label WR ≥ 53.29%) | ✅ PASS — **54.34% net** | CI `benchmark` job |
| Production build + deploy | ✅ Ready | Vercel deploy `de9a3d5` |
| Production smoke | ✅ `/`=200, `/api/sector-rotation`=200, `/api/analytics/AAPL`=200 | live `quantan.vercel.app` |

**Conclusion: the platform is healthy and green. No blocking issues. No action required to maintain stability.**

---

## 2. Shipped this cycle (2026-06-02) — already merged to `main`

| PR | Finding(s) | Effect |
|----|-----------|--------|
| #36 | D4-1 (X-API-Key bypass), D4-3 (rate limits) | fail-closed `isValidApiKey` auth + rate-limit gaps |
| #40 | CSRF client gap | browser LLM "Run" sends `x-quantan-csrf` (403 → fixed) |
| #41 | D2-1/2/5/6/7, D1-1, D3-2, D3-9 | **honest portfolio-sim re-baseline (WR 54.66→48.37, look-ahead removed)**, `core.ts` extraction (breaks engine↔walkForward cycle), BTC page decomp, chart-indicator SSOT (`chartEma.ts`), multivariate factor attribution, GARCH MLE fallback |
| #42 | Q-063 (partial) | backtest Win-Rate cost/fill disclosure + LiveSignalsPanel caveat |
| #43 | D5-1 | warehouse path filters non-finite OHLC (mirrors JSON path) |

Prior cycles already merged: #27 (D5-2 fixture guard), #28 (D5-10 engine T+1 exit symmetry), #29 (D2-3 cost SSOT),
#31 (PR-A1 API reliability), #32 (PR-A2 a11y), #37 (D1-3 dead mockData prune), #38 (D2-4 docstring + tracker).

**Of the 52 D1–D5 inspection findings, the HIGH-severity NEW items (D4-1 security, D2-1 look-ahead, D1-1 circular
dep) are all resolved.** Algorithm consolidation is complete: `resolveBacktestSignal()` is the SSOT across CI /
engine / portfolio / live / enhanced paths, pinned by `__tests__/backtest/signalParity.test.ts` (see
`lib/backtest/SIGNAL_SSOT.md`).

---

## 3. Open backlog — sequenced, severity-ranked, bucketed

### 3a. Owner DECISIONS required (no correct default — agent must not choose silently)
- **D5-5 (MED, data) — Yahoo `null O/H/L → close` substitution** (`lib/data/providers/yahoo.ts:39-41`). A valid
  close with null OHLC becomes a **flat candle** (O=H=L=C, ~0 true range) → **understates ATR** and ATR-derived
  stops. **Options:** (a) *filter* the partial bar (skip it — coherent with #43's warehouse filter and the existing
  `close<=0` guard; recommended); (b) keep + flag; (c) document only. Does **not** move the benchmark (CI uses JSON
  fixtures, not live Yahoo) — affects the live desk only. **→ Owner picks; agent ships the chosen variant as a PR.**

### 3b. Bucket-B REFACTORS — propose as individual reviewable PRs, owner greenlights one at a time
God-file decomposition (LOC on `de9a3d5`). Each is low-risk *mechanically* but cross-file and behavior-must-be-
identical, so each is its own PR with before/after parity verification:

| Target | LOC | Note / finding |
|--------|-----|----------------|
| `lib/backtest/signals.ts` | 735 | largest; **start here** — extract regime/zone/scoring helpers behind the SSOT (behavior-identical; `signalParity` test is the guard) |
| `lib/quant/indicators.ts` | 667 | canonical indicators; split by family (trend/momentum/vol) — pure functions, well-tested |
| `app/stock/[ticker]/page.tsx` | 637 | god page — extract tab/section components (pattern proven by the #41 BTC-page decomp) |
| `lib/backtest/portfolioBacktest.ts` | 624 | just re-baselined (#41); decompose AFTER it settles |
| `app/sector/[slug]/page.tsx` | 590 | god page |
| `app/ma-deviation/page.tsx` | 569 | god page |
| `components/crypto/BtcQuantLab.tsx` | 516 | large component |
| `components/stock/quantlab/tabs/LlmTab.tsx` | 470 | **D3-8** — 20-prop drilling; co-locate `useQuantLabLlm`, memoize |

- **`lib/scenarios/engine.ts`** (Bucket-B, quant) — linear-delta → Taylor-expansion P&L. **Design work**, agree scope first.

### 3c. WON'T-FIX / deliberate (verified — do NOT "fix")
- **D1-5 — `lib/quant/technicals.ts` (291 LOC).** Confirmed a **deliberate thin re-export adapter** over
  `indicators.ts` (returns single "latest value" forms; documented as backward-compatible API). 6 importers. Wave 10
  already judged "thin delegate acceptable" — **correct; close this, don't migrate.**
- **D1-4 — portfolio lib (`var/riskParity/stressTest/diversification`)** prod-orphaned but tracked under Q-011/Q-028
  (dashboard feature, not dead code). No action until that feature lands.
- **D1-6 — `eslint-disable` w/o eslint config.** Audited & documented (`workspace/D1-6-eslint-audit-2026-06-02.md`);
  the 4 `exhaustive-deps` suppressions reviewed — no real stale-closure bugs. Decision: install `eslint-config-next`
  OR delete the vestigial disables — low priority.

### 3d. Owner / infra-only (agent cannot execute — needs credentials/authority)
- Install `arch` / `hmmlearn` in the ML sidecar → enables GARCH/regime **MLE** (currently EWMA / vol-ratio fallback).
- Flip `QUANTAN_CSP_ENFORCE=1` after the 7-day clean Report-Only window.
- Polygon: legal opinion + optional $199/mo plan.
- Wire `@axe-core/cli` into CI (stub at `.github/workflows/a11y-axe.yml`).
- `reviews/findings-ledger.csv` full row-by-row sync (monthly owner pass).
- Tracker honesty: `IMPROVEMENT_BACKLOG.json` Q-063-NEW = "partial" — accurate (cost disclosure shipped #42; the
  public "20-day-label WR" *label* was deliberately NOT auto-authored — owner product decision).

---

## 4. Inspection & performance readiness (functions + perf checks)

**Function-level test scaffolding already in place** (this is what an inspection runs against):
- ~1000 vitest tests / 84 files; coverage gates enforced in CI on `lib/{quant,backtest,qa,options,api,data,portfolio,optimize,ml}` + `hooks`.
- Signal correctness: `signalParity.test.ts` (live ≡ engine ≡ CI), indicator unit tests (RSI/ATR/EMA/MACD/Bollinger/Sharpe/Sortino/ADX/Kelly/correlation), `benchmark` floor gate.
- Reliability: rate-limit, sanitize (+fuzz), CSRF, dataLoader (incl. the new non-finite guards), market-hours.

**Coverage gaps (staged backfill, `vitest.config.ts` exclude list) — the inspection's function-coverage TODO:**
`hooks/useLiveQuote(s).ts`, `useLivePrices/useDialogA11y/useWatchlist.ts`, `lib/data/warehouse.ts` + `bloomberg/**`,
`lib/data/providers/{yahoo,polygon,alphavantage}.ts`, `lib/ml/**`, `lib/optimize/gridSearch.ts`,
`lib/quant/{frameworks,buildFundamentalsPayload}.ts`. Each is excluded for a documented reason (native bindings /
HTTP fixtures / long-running). **Closing these one-at-a-time is the cleanest "prepare for function inspection" work.**

**Performance notes (known, acceptable, not regressions):**
- `/api/backtest` GET aggregates 56 instruments (~20s cold) — cached 1h; POST recompute rate-limited 3/min.
- `npm run portfolio:backtest` ~121s (offline/CI script, not a request path).
- Grid search (`lib/optimize/gridSearch.ts`) long-running — run offline. Live request paths (chart/quote/sector
  rotation/analytics) are wrapped in retry+timeout (#31) and per-route caches.

---

## 5. Recommended next steps (owner)
1. **Decide D5-5** (filter / keep / document) → agent ships the PR.
2. **Greenlight the first decomposition** — recommend `lib/backtest/signals.ts` (behavior pinned by `signalParity`)
   → agent opens a behavior-identical review PR. Then proceed down §3b one PR at a time.
3. Execute the §3d infra/owner items at your discretion.
4. Close D1-5 / D1-4 / D1-6 as deliberate/tracked (no code change).

**Definition of "done" for this consolidation pass:** health verified (✅), findings reconciled into this single
roadmap (✅), safe surface shipped (#36/#40/#41/#42/#43 — exhausted; D1-5 confirmed won't-fix), open decisions +
sequenced refactors surfaced for owner greenlight (this doc). The next refactor is an owner-greenlit, one-PR-at-a-time step.
