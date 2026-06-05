# Structure & Architecture Review — 2026-06-04

> Reviewer: automated structural agent. Read-only pass; no files modified.
> Tool: madge 8.x (210 TS/TSX files processed, 126 warnings — all Next.js dynamic-import noise).

## Severity legend

- **P0** — Broken / cyclic / immediate risk
- **P1** — Maintainability risk; high churn or SSOT violation
- **P2** — Cleanup / cosmetic

---

## Architecture Map

QUANTAN is a Next.js 15 app-router project (~34 k LOC TypeScript) split into three
logical domains:

1. **Trading UI** — `app/` pages (dashboard, stock, sector, backtest, MA-deviation, crypto,
   portfolio, risk, options, heatmap, desk) + `components/` (KLineChart, DarkPoolPanel,
   QuantLabPanel, BacktestTabs, options widgets, crypto panels).
2. **Quant engine** — `lib/quant/` (indicators SSOT, technicals, regime, BTCindicators,
   volatility, Kelly, multi-TF, DCF, correlation…) + `lib/backtest/` (core, engine,
   signals, exitRules, portfolioBacktest, dataLoader, executionModel, benchmarkLabel) +
   `lib/optimize/` (gridSearch, sectorProfiles, parameterSets).
3. **Infrastructure** — `lib/api/` (CSRF, rate-limit, reliability, sanitize, marketHours),
   `lib/auth/`, `lib/data/` (warehouse.ts SQLite, providers, Bloomberg bridge),
   `lib/portfolio/`, `lib/scenarios/`, `lib/security/`.

Parallel Python trees (`quant_framework/`, `ml/`, `multi_agent_factor_mining/`, root
`*.py`, `src/example.py`) are **standalone** — they have no TypeScript imports and are not
part of the Next.js build. They are coherent analysis scripts that share no module
boundary with the TS app; `src/example.py` is a one-file stub that appears orphaned.

Top-level `lib/*.ts` loose files (20 files) serve as domain adapters and thin config
modules; most are legitimately separate (chartEma, chartYahoo, format, sectors, crypto),
but several have categorisation issues discussed below.

**Directory tree summary (abbreviated):**
```
app/
  api/(30+ route handlers)
  (pages): page.tsx sector/[slug] stock/[ticker] ma-deviation backtest
            portfolio risk heatmap crypto/btc desk commodities briefs
  auth/ layout.tsx error.tsx
components/
  KLineChart.tsx               (1039 lines — chart god file)
  backtest/  crypto/  options/  risk/  stock/quantlab/
lib/
  quant/      (indicators.ts SSOT, 15 sub-modules)
  backtest/   (10 files, 2895 lines total)
  portfolio/  (8 files)
  data/       (warehouse, providers, bloomberg)
  api/        (security/middleware helpers)
  optimize/   (3 files)
  options/    (5 files)
  (20 loose top-level .ts files)
types/        (next-auth.d.ts only)
hooks/        (useLiveQuote, useLiveQuotes, useWatchlist, useErrorToast…)
```

---

## Circular Dependencies

**Result: ZERO circular dependencies confirmed.**

Initial run `npx madge --circular --extensions ts,tsx lib app components` processed 210
files but emitted 126 "Skipped" warnings for files imported via the `@/` TypeScript path
alias. Madge cannot resolve `@/` aliases without tsconfig, so those files' import graphs
were absent from the initial scan.

Re-run with `--ts-config tsconfig.json` resolved all aliases, processed **216 files with
zero warnings and zero cycles**. The no-cycle finding is solid.

---

## Dead Code / Unused Exports

### Confirmed dead modules (zero non-self import references, verified across app/ lib/ components/ scripts/ __tests__/)

| File | Lines | Notes |
|------|-------|-------|
| `lib/tickerNormalize.ts` | ~20 | Exported `canonicalizeTickerCase`. Comment says it was renamed from `normalizeTicker` in Phase 14 wave 24, but **no file imports it** after the rename. Either callers were deleted or the rename was never wired up. P1 — misleading exported symbol sitting around. |
| `lib/qa/dataValidator.ts` | ~80 | Exports `DataQualityIssue`, `DataQualityReport`, validator fns. Zero imports outside itself. P2 orphan. |
| `lib/qa/signalTracker.ts` | ~80 | Exports `TrackedSignal`, signal logging. Zero imports. P2 orphan. |
| `lib/portfolio/riskParity.ts` | ~120 | Exports `rollingVols`, ERC algorithm. Zero imports in TS tree. P2 orphan. |
| `lib/optimize/parameterSets.ts` | ~100 | **NOT dead** — imported by `scripts/optimize-grid.ts` and `scripts/portfolio-backtest.ts`. madge's `lib app components` scan missed the `scripts/` tree. Module is correctly used by CLI optimization runners. |

### Live-dormant modules (not dead, but gated off)

| Module | Flag | Notes |
|--------|------|-------|
| `lib/backtest/signals.ts::enhancedCombinedSignal()` | `QUANTAN_USE_ENHANCED_SIGNAL` | OFF in prod (`featureFlags.ts`). The 223-line function body is live code exercised in dev/test and benchmark runs. Keep flagged but not dead code per se. |
| `lib/backtest/signals.ts` (lines 1–21 re-exports: `sma, ema, rsi, macdFn, atr, bollinger`) | — | These re-exports exist so old callers can `import {sma} from './signals'`. Worth verifying no caller still does — if none, remove re-exports to tighten the module boundary. |

### Partially-orphaned lib/quant/ modules

madge reports the following as orphans but they **are** imported indirectly through API route files (which madge treats as roots, not leafs):

- `lib/quant/buildFundamentalsPayload.ts` — imported by `app/api/fundamentals/[ticker]/route.ts`.
- `lib/quant/garchClient.ts` — imported by `app/api/crypto/btc/route.ts` (verify).
- `lib/quant/regimeDetection.ts`, `lib/quant/sectorRotation.ts`, `lib/scenarios/engine.ts` — active.

The madge orphan list for `lib/` is inflated by Next.js route-entry-point semantics and is **not** reliable as a dead-code list. Manual grep verification was used above.

### `src/example.py`

One-line Python stub (`src/example.py`) — purely orphaned. No TS reference, no Python runner reference. P2 delete candidate.

---

## God-File Decomposition Plans

### 1. `components/KLineChart.tsx` — 1039 lines

**Current responsibilities (too many):**

1. Type declarations (`KLineIndicatorFlags`, `VisKey`, `INDICATOR_DEFS` type, `Candle`, `Timeframe`).
2. Private thin-adapter functions for indicators (`calcEMA`, `calcRSI`, etc.) — these are correct: they delegate to `lib/quant/indicators.ts` (Phase 13 S2 fix documented). 7 functions, ~50 lines.
3. Indicator preset → visibility mapping (`buildVisFromProps`) — duplicates logic in `lib/chartEma.ts:buildVisFromIndicatorPreset`. **(P1 SSOT violation, see SSOT section.)**
4. Chart lifecycle — async `createChart` + subscription mount effect (lines 355–646, ~290 lines).
5. Data update effect — incremental vs full-reset candle logic (lines 648–847, ~200 lines).
6. In-chart legend / indicator toggle controls (lines 880–950, ~70 lines).
7. JSX render — layout, time-frame bar, price header, legend, sub-charts (lines 850–1039, ~190 lines).

**Verdict:** Needs split. The component is doing chart lifecycle management + data binding + rendering + keyboard shortcuts + sub-chart coordination in one file.

**Proposed extraction:**
- `lib/chartEma.ts` already owns the EMA config SSOT. Move `buildVisFromProps` inline logic there too (or confirm the existing `buildVisFromIndicatorPreset` is the same).
- Extract `components/KLineChartCore.ts` or a `hooks/useKLineChart.ts` custom hook that owns all the `useRef`/`useEffect` imperative chart API calls (chart mount, series creation, resize observer, crosshair subscription). ~350 lines.
- Keep `KLineChart.tsx` as a thin wrapper: props validation + data → hook + JSX render. Target ~300 lines.
- The sub-chart refs (RSI, MACD, ATR chart APIs) could become a `useSubCharts` hook within `hooks/useSubCharts.ts`, but this is optional phase-2 splitting.

### 2. `lib/backtest/signals.ts` — 735 lines

**Current responsibilities:**

1. Re-export of canonical indicators (`sma, ema, rsi, macdFn, atr, bollinger`) — P1 coupling.
2. Loop-1 signal helpers (`piecewiseRsiScore`, `isGoldenCross`, `hasPositiveMomentum`, `detectBullishDivergence`, `detectVolumeClimax`, `isMACompression`, `sma200DeviationPct`, `sma200Slope`, `priceWasNearSmaRecently`) — lines 35–195.
3. Regime signal logic (`regimeSignal`, `DipSignal`, `RegimeSignal`) — lines 196–305.
4. Config types (`BacktestConfig`, `DEFAULT_CONFIG`, `ConfirmSignal`, `CombinedSignal`) — lines 308–355.
5. Enhanced weighted-confluence signal (`enhancedCombinedSignal` + weight profiles + helpers) — lines 364–698, ~335 lines. This is the largest single block and is feature-flagged off in prod.
6. `resolveBacktestSignal` dispatch function — lines 700–735.

**Verdict:** The file is a signal-domain monolith. Not incoherent but over-large.

**Proposed extraction:**
- `lib/backtest/signalHelpers.ts` — the 9 scalar/boolean helper functions (piecewiseRsiScore…priceWasNearSmaRecently). ~160 lines.
- `lib/backtest/regimeSignal.ts` — `regimeSignal` + `DipSignal`/`RegimeSignal` types. ~110 lines.
- `lib/backtest/signalTypes.ts` — interfaces only (`BacktestConfig`, `DEFAULT_CONFIG`, `ConfirmSignal`, `CombinedSignal`, `EnhancedCombinedSignal`, `WeightedConfirm`). ~60 lines.
- `lib/backtest/enhancedSignal.ts` — `enhancedCombinedSignal` + weight profiles + local helpers (`clamp`, `volumeZoneScore`, `volRegimeScore`). ~350 lines.
- Keep `signals.ts` as a thin orchestrator: imports from the above, exports `resolveBacktestSignal` + re-exports for the public API. ~50 lines.
- **Remove the re-export of canonical indicators** (line 22: `export { sma, ema, rsi, macdFn, atr, bollinger }`) — these belong in `lib/quant/indicators.ts` only.

### 3. `lib/quant/indicators.ts` — 667 lines

**Current responsibilities:**

1. Type definitions: `OhlcBar`, `OhlcvBar`.
2. SMA (array + latest), EMA (array + full + latest), RSI, MACD, Bollinger, TR, ATR, OBV, VWAP, stochRSI, Wilder smoothing, ADX, daily returns, max-drawdown, Sharpe, Sortino.
3. All pure math, well-organized.

**Verdict:** Large but **cohesive** — this is the canonical SSOT and should remain consolidated. The only split worth considering is separating the *risk/performance metrics* (maxDrawdown, Sharpe, Sortino — lines 572–667) into `lib/quant/performanceMetrics.ts`. This would make the indicators.ts more purely "technical indicator primitives" vs "portfolio performance stats." Currently a P2 cosmetic split, not urgent.

### 4. `lib/backtest/portfolioBacktest.ts` — 657 lines

**Current responsibilities:**

1. T+1 exit price resolution.
2. `PortfolioConfig`, `DEFAULT_PORTFOLIO_CONFIG`, `PortfolioTrade`, `PortfolioBacktestResult` type definitions.
3. `runPortfolioBacktest` (single 508-line function, lines 137–644) — the bulk.
4. Private `emptyResult`.

**Verdict:** `runPortfolioBacktest` is a god *function* inside a file that otherwise has sensible structure. The function handles: position sizing (Kelly), entry logic, stop-loss/ATR logic, exit evaluation (time/signal/panic/maxDD), drawdown tracking, trade log accumulation, performance metrics, and result object construction.

**Proposed extraction:**
- `lib/backtest/positionManager.ts` — position sizing, entry price resolution, stop-price computation.
- `lib/backtest/performanceRollup.ts` — post-loop metrics (Sharpe, Sortino, max-DD, win-rate computation from trade log).
- Keep `portfolioBacktest.ts` as the orchestration loop (~150 lines after extraction).

### 5. `app/stock/[ticker]/page.tsx` — 638 lines

**Verdict:** Single Next.js page with one exported component. It has a lot of fetch effects and local state but is structurally acceptable. The `QuantLabPanel` already does the heavy quant lifting. Could extract a `useStockPageData` hook but this is P2.

### 6. `app/sector/[slug]/page.tsx` — 591 lines

Same pattern as stock page — one component with multiple fetch effects and local state. P2.

### 7. `app/page.tsx` — 585 lines (Dashboard homepage)

Has 14+ `useMemo` calls. Inner `fetchPrices` effect. `formatUtcDateTime` private function that belongs in `lib/format.ts`. The `signals` derived state builds on `buildSessionSignalsFromQuotes` — correct layering. P2 housekeeping.

### 8. `app/ma-deviation/page.tsx` — 569 lines

Contains three private sub-components (`DeviationBar`, `SlopeChip`, `SkeletonRow`) inline. These should be extracted to `components/ma-deviation/` for testability. Main `MADeviationPage` component is ~440 lines of table + sort logic. P2.

### 9. `components/crypto/BtcQuantLab.tsx` — 516 lines

Uses `calcRSI`, `calcEMA`, `calcMACD`, `calcBollingerBands`, `calcVWAP`, `calcATR`, `calcStochastic` imported from `lib/crypto.ts` (adapter layer). Structurally OK: one BTC-specific tab panel. Could extract metric computation into a custom hook. P2.

---

## SSOT Violations / Duplication

### [P1] `lib/crypto.ts` duplicates `lib/quant/btc-indicators.ts` for `calcMVRV` and `calcS2FPrice`

Both files export identically-implemented `calcMVRV(price, realizedCap)` and `calcS2FPrice(totalS2F)`. The comment in `lib/crypto.ts` says "matching btc-indicators.ts SSOT" but re-exports are missing (unlike `calcVWAP` which is correctly re-exported via `export { calcVWAP } from './quant/btc-indicators'`).

**Caller analysis (including tests and scripts):** `__tests__/quant/cryptoIndicators.test.ts` imports `calcMVRV` and `calcS2FPrice` from *both* sources (`calcMVRV as calcMVRV2` / `calcS2F2`) and asserts they return identical results. This is a deliberate sync test that would break if either copy diverges.

**Correct recommendation:** `lib/crypto.ts` should re-export from `lib/quant/btc-indicators.ts` rather than re-implementing — the same pattern already used for `calcVWAP`. The sync test would then trivially pass (same function). No code paths in `app/` or `components/` call `calcMVRV` or `calcS2FPrice` directly; they are only used in the metrics API route (via `lib/quant/btc-indicators.ts` internally) and in the test. The inline implementations in `lib/crypto.ts` should be replaced with:
```ts
export { calcMVRV, calcS2FPrice } from './quant/btc-indicators'
```

### [Clarification] `lib/chartEma.ts` does NOT duplicate EMA computation from `lib/quant/indicators.ts`

`lib/chartEma.ts` is a **configuration module only**: it exports constants (`CHART_EMA_PERIODS`, `CHART_EMA_COLORS`), type aliases (`ChartEmaKey`, `ChartEmaPeriod`), and preset-to-flag helpers (`buildVisFromIndicatorPreset`, `tradingDefaultEmaFlags`, etc.). It contains no EMA arithmetic. All EMA computation is in `lib/quant/indicators.ts` (`ema`, `emaFull`), and `chartEma.ts` does not duplicate it. The separation is clean. ✓

### [Clarification] `lib/backtest/portfolioBacktest.ts` helpers vs `lib/backtest/core.ts`

`portfolioBacktest.ts` has two private helpers unique to portfolio-level execution:
- `resolvePortfolioExitFillPrice` — T+1 exit logic (portfolio-specific)
- `netPnlPctFromPrices` — round-trip cost-inclusive P&L computation

`core.ts` has `closePosition` which handles single-instrument state. These are **not duplicates** — different function signatures, different purposes. No cross-file helper duplication. ✓

### [P1] `KLineChart.tsx:buildVisFromProps` vs `lib/chartEma.ts:buildVisFromIndicatorPreset`

`buildVisFromProps` (lines 148–177 in KLineChart) maps prop shape → `Record<VisKey, boolean>`. `buildVisFromIndicatorPreset` in `lib/chartEma.ts` maps an indicator preset string → the same record shape. The two are not identical in signature, but there is duplicated switch-like conditional logic. The SSOT for indicator preset→vis mapping should live in `lib/chartEma.ts` only; KLineChart should call it.

### [P1] `DEFAULT_TX_COST_BPS_PER_SIDE = 11` exists in BOTH `lib/quant/constants.ts` (line 110) AND is computed via `costBpsPerSide(DEFAULT_EXECUTION_COSTS)` in `lib/backtest/core.ts` (resolves to 11)

The `lib/quant/constants.ts` version is never imported anywhere — zero hits in `app/`, `lib/`, `components/`, `scripts/`, and `__tests__/`. `lib/backtest/executionModel.ts` is the genuine SSOT for cost constants; `lib/backtest/core.ts` correctly delegates to it. The orphaned `DEFAULT_TX_COST_BPS_PER_SIDE` in `constants.ts` should be removed. P1.

### [P1] `OhlcvRow` defined in BOTH `lib/backtest/core.ts` (line 18) AND `lib/backtest/dataLoader.ts` (line 13) + re-exported via `engine.ts`

Both extend `OhlcBar` with `{ time: number; volume: number; dividend?: number }` — identical shape. `portfolioBacktest.ts` imports from `dataLoader.ts`; `engine.ts` re-exports `OhlcvRow` from `core.ts` (via `export type { OhlcvRow, Trade, BacktestResult } from './core'`). Both shapes are structurally identical and the type is the canonical row format for the warehouse. One should be removed and the other re-exported. Recommend: keep in `dataLoader.ts` (the file that *creates* rows), have `core.ts` import and re-export from `dataLoader.ts`.

### [P2] `lib/backtest/engine.ts` imports `TX_COST_BPS_PER_SIDE, TX_COST_PCT_PER_SIDE` from `lib/backtest/core.ts`

These are derived constants (`costBpsPerSide(DEFAULT_EXECUTION_COSTS)`) re-exported from `core.ts`. The SSOT chain is: `executionModel.ts → core.ts → engine.ts`. One indirection too many; engine.ts should import directly from `executionModel.ts`.

### [P2] Hardcoded `252` (trading days) throughout `lib/backtest/`

`lib/backtest/engine.ts` (lines 99, 127–131), `walkForward.ts` (lines 57, 67–68, 120, 127), `benchmarkLabel.ts` (line 125) all use literal `252`. `lib/quant/constants.ts` exports `TRADING_DAYS_EQUITIES = 252` but it's never imported by these files. `lib/backtest/core.ts` exports `tradingDaysPerYear()` which returns 252 for equities. These should consistently import `TRADING_DAYS_EQUITIES` from `lib/quant/constants.ts` or `tradingDaysPerYear()` from `core.ts`.

### [P1] `lib/backtest/signals.ts` re-exports canonical indicators — and has live callers

Line 22: `export { sma, ema, rsi, macdFn, atr, bollinger }` — these are the canonical functions from `lib/quant/indicators.ts` re-exported via signals.ts. Two production callers rely on this:
- `lib/backtest/core.ts` line 7: `import { resolveBacktestSignal, DEFAULT_CONFIG, atr, ... } from './signals'`
- `lib/backtest/liveSignal.ts` line 6: `import { resolveBacktestSignal, rsi, macdFn, atr, bollinger } from './signals'`

This creates an unintended "signals.ts is also an indicators hub" dependency chain. The re-exports should be removed from `signals.ts`, and `core.ts` and `liveSignal.ts` should be updated to import `atr`, `rsi`, `macdFn`, `bollinger` directly from `@/lib/quant/indicators`.

### [P2] `types/next-auth.d.ts` is the only file in `types/`

`OhlcBar`, `OhlcvBar`, and all domain types live inline in their respective lib files (correct pattern per the OhlcBar SSOT PR 3a032ab). The `types/` directory exists only for the NextAuth session augmentation. Not a violation; note for clarity.

---

## Layering & Dependency-Direction Issues

### Verdict: Layering is generally clean.

1. **No lib → app inverted dependencies found.** `grep -rn "from.*app/" lib/` returns zero hits.
2. **No UI component imports server-only code.** `lib/api/reliability.ts` imports `next/server` (a server runtime), but it is only imported by `app/api/` route handlers — never by `components/` or `app/` pages.
3. **`lib/trading-agents-config.ts`** has a comment "Do NOT import next/server here — this file is also imported by client components." This is a correct guard; the file itself only imports client-compatible things.
4. **`lib/auth/apiKey.ts`** and `lib/auth.ts` — used by API routes, not by UI components. Clean.
5. **App pages import deep lib internals directly** (e.g., `app/stock/[ticker]/page.tsx` imports `lib/options/chain`, `lib/options/gex`, `lib/options/flow`). This is acceptable in Next.js app-router architecture where pages own their data-fetching; there is no "service layer" abstraction needed here.
6. **`components/DarkPoolPanel.tsx`** imports `lib/sectors.ts` and `lib/format.ts` — both are pure data helpers, no server runtime. Fine.

One minor note: `app/sector/[slug]/page.tsx` and `app/stock/[ticker]/page.tsx` both import `lib/mockData.ts` (for `generateDarkPoolPrints`). Mock data leaking into production pages is a P2 concern if real dark-pool data becomes available — this function is currently a stub that returns randomized prints. The `lib/mockData.ts` import should eventually be removed when real data lands.

---

## Config Sprawl Assessment

| File | Status |
|------|--------|
| `next.config.js` | Clean. PWA wrapper, security headers, scoped image allowlist. CSP in report-only mode (noted as intentional). |
| `vercel.json` | Minimal and correct (region, framework, build command). |
| `tsconfig.json` | Standard Next.js config; `strict: true`; `@/*` path alias. No conflicts. |
| `vitest.config.ts` | Well-structured; per-file `@vitest-environment jsdom` pragma pattern. Coverage thresholds set. Exclude list has inline rationale. |
| `stryker.conf.mjs` | Targets `lib/quant/**`, `lib/backtest/**`, `lib/options/**`. Threshold 70% break. Coherent with vitest config. |
| `tailwind.config.js` | Not read; assumed standard. |
| `postcss.config.js` | Not read; assumed standard. |

No conflicting settings found between configs.

---

## Python / Non-TypeScript Tree Assessment

| Path | File count | Assessment |
|------|-----------|------------|
| `quant_framework/` | 9 files | Standalone Python backtest/analysis framework. Coherent module: `data_engine`, `strategy`, `backtest`, `analysis`, `garch`, `regime_hmm`, `deploy`. Has `test_analytics.py`. No TS wiring — independent research tooling. |
| `ml/` | 4 files | FastAPI ML sidecar (`server.py`, `ensemble.py`, `features.py`). Called by `lib/ml/client.ts` over HTTP. Clean separation. |
| `multi_agent_factor_mining/` | 5 files | Multi-agent factor mining framework. Standalone. No TS integration found in current code. |
| `alpha_miner.py`, `options_asia.py`, etc. (root `*.py`) | 5 files | Research/utility scripts. No TS integration. |
| `src/example.py` | 1 file | Single Python stub, no content. **Orphaned.** |

The Python trees are not incoherent — `ml/` has a defined HTTP sidecar interface (`lib/ml/client.ts`). `multi_agent_factor_mining/` and `quant_framework/` are research trees that happen to live in the same repo. The repo could benefit from a monorepo-style separation (`services/ml/`, `research/quant_framework/`) but this is P2.

---

## P0 / P1 / P2 Findings Summary

### P0 — None

No circular dependencies, no broken imports, no inverted lib→app dependencies.

### P1 — Maintainability Risk

| ID | File(s) | Issue |
|----|---------|-------|
| P1-01 | `lib/crypto.ts` + `lib/quant/btc-indicators.ts` | Duplicate `calcMVRV` and `calcS2FPrice` — identical bodies in both files, neither called externally. SSOT violation; the `crypto.ts` copies should delegate or be removed. |
| P1-02 | `lib/backtest/core.ts` + `lib/backtest/dataLoader.ts` | `OhlcvRow` interface defined twice with identical shape. High churn risk if the type evolves. |
| *(P1-03 retracted)* | `lib/optimize/parameterSets.ts` | Not dead — used by `scripts/optimize-grid.ts` and `scripts/portfolio-backtest.ts`. The initial madge scan omitted the `scripts/` tree. |
| P1-04 | `lib/tickerNormalize.ts` | `canonicalizeTickerCase` function — renamed in Phase 14 wave 24 from `normalizeTicker` but has zero callers. If callers were intentionally deleted this file is dead; if the rename was done without updating imports this is a functional bug. |
| P1-05 | `lib/quant/constants.ts` | `DEFAULT_TX_COST_BPS_PER_SIDE = 11` — unused duplicate of the computed constant in `lib/backtest/executionModel.ts`. Zero imports. Should be removed. |
| P1-06 | `lib/backtest/signals.ts`, `lib/backtest/core.ts`, `lib/backtest/liveSignal.ts` | `signals.ts` re-exports canonical indicators (line 22: `sma, ema, rsi, macdFn, atr, bollinger`). Two live callers (`core.ts` imports `atr`, `liveSignal.ts` imports `rsi, macdFn, atr, bollinger`) use this second entry-point. Remove re-exports from `signals.ts` and update callers to import from `@/lib/quant/indicators` directly. |
| P1-07 | `components/KLineChart.tsx` | God file at 1039 lines. Chart lifecycle (~290 lines), data update effect (~200 lines), toggle/interaction handlers, and JSX render all in one component. Concrete split plan given above. |
| P1-08 | `lib/backtest/signals.ts` | God file at 735 lines mixing signal helpers, regime logic, type defs, and the 335-line `enhancedCombinedSignal`. Split plan given above. |

### P2 — Cleanup

| ID | File(s) | Issue |
|----|---------|-------|
| P2-01 | `lib/backtest/engine.ts`, `walkForward.ts`, `benchmarkLabel.ts` | Hardcoded literal `252` (trading days) instead of `TRADING_DAYS_EQUITIES` constant. |
| P2-02 | `lib/backtest/engine.ts` | Imports `TX_COST_BPS_PER_SIDE` / `TX_COST_PCT_PER_SIDE` from `core.ts` rather than directly from `executionModel.ts` (the true SSOT). |
| P2-03 | `lib/qa/dataValidator.ts` | Zero callers in `app/`, `lib/`, `components/` or `scripts/`. Has unit tests in `__tests__/qa/dataValidator.test.ts` but is not wired into any production or CLI code path. Built but not deployed. |
| P2-04 | `lib/qa/signalTracker.ts` | Same pattern — tested in `__tests__/qa/signalTracker.test.ts` but no production/script caller. |
| P2-05 | `lib/portfolio/riskParity.ts` | Zero callers in production. Tested in `__tests__/portfolio/riskParity.test.ts` but not wired. Contains a working ERC algorithm. |
| P2-06 | `app/ma-deviation/page.tsx` | Three inline sub-components (`DeviationBar`, `SlopeChip`, `SkeletonRow`). Should be extracted to `components/ma-deviation/`. |
| P2-07 | `app/page.tsx` | `formatUtcDateTime` private function (line 39) belongs in `lib/format.ts`. |
| P2-08 | `app/sector/[slug]/page.tsx` + `app/stock/[ticker]/page.tsx` | Import `lib/mockData.ts` for `generateDarkPoolPrints`. When real darkpool data lands, these will need a clean swap-out path. |
| P2-09 | `src/example.py` | Orphaned Python stub. Delete. |
| P2-10 | `types/` directory | Only contains `next-auth.d.ts`. Not a structural problem; just note that all domain types live inline in their source modules (correct). |
| P2-11 | `lib/backtest/portfolioBacktest.ts` | `runPortfolioBacktest` is a 508-line god *function*. Split plan given above. |

---

## What I Did NOT Cover

- **Per-file export audit** for every lib module — only high-risk and dead-code candidates were spot-checked.
- **Test coverage alignment** — whether the P2 dead modules (`lib/qa/`, `lib/portfolio/riskParity.ts`) have tests that are now untethered.
- **`lib/data/warehouse.ts`** (SQLite) internals — not inspected in detail.
- **All `app/api/` route handlers** — layering spot-checked; full API surface review was out of scope for a structural pass.
- **`tailwind.config.js`** and `postcss.config.js` — not read (assumed standard).
- **`hooks/`** directory — not inspected for structural issues.
- **`lib/backtest/walkForward.ts`** internals (1 caller) — surface-checked only.
- **Python tree internal quality** — only assessed connectivity to TS layer.

---

*Findings written incrementally. Last updated: 2026-06-04.*
