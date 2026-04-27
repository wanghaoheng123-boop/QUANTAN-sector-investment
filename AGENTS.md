# QUANTAN — Agent Context & Project Memory

> **For any AI agent (Claude Code, Cursor, Windsurf, Copilot, etc.) picking up this project.**
> Read this file first. It contains everything needed to continue development without re-analysing the codebase.

---

## Project Overview

**QUANTAN** is a quantitative trading & investment intelligence platform built with Next.js 14 + TypeScript.  
Goal: >80% selective signal accuracy across all market conditions. Bloomberg-like functionality, accessible.

**Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · yahoo-finance2 · Vitest · lightweight-charts

**Owner:** Trader/investor building quant platform. Values backtesting rigor, institutional-grade analysis, and continuous improvement. Familiar with options Greeks, dark pools, gamma exposure, sector rotation.

---

## 7-Phase Upgrade Plan — Status

| Phase | Name | Status | Branch / Commit |
|-------|------|--------|-----------------|
| 1 | Testing & Validation Foundation | ✅ COMPLETE | commit `eec5b30` |
| 2 | Signal Engine Hardening | ✅ COMPLETE | merged via PR #3 |
| 3 | Options & Flow Data | ✅ COMPLETE | branch `claude/pedantic-morse` |
| 4 | Advanced Analytics | ✅ COMPLETE | branch `claude/pedantic-morse` |
| 5 | Data Infrastructure | ✅ COMPLETE | branch `claude/loving-banach` |
| 6 | Portfolio & Risk Management | ✅ COMPLETE | branch `claude/loving-banach` |
| 7 | Continuous Optimization | ✅ COMPLETE | branch `claude/loving-banach` |
| 8 | Benchmark Fix + Optimization Loops (1-3) | 🔲 INFRASTRUCTURE READY | Run scripts to execute |
| 9 | Stock-by-Stock Analysis Report | ✅ COMPLETE | `docs/archive/QUANTAN_ANALYSIS_REPORT.md` |
| 10 | Cleanup + P1 Audit | ✅ COMPLETE | merged via PR #6, PR for branch `fix/dead-ema-and-progress-audit` |

---

## Phase 10 — Cleanup, Audit & P1 Closure (April 2026)

### What was done
- **PR #6 (cleanup):** removed 9 dead files, archived 6 historical specs to `docs/archive/`
- **Audit pass:** reviewed every "remaining bug" claim in the now-archived `progress.md`. Result:
  - ❌ "Split-adjusted prices" — **stale claim, not a bug**. yahoo-finance2's `chart()` returns split-adjusted close in `q.close` by default. Verified by sampling NVDA (10:1 split 2024-06-10) and TSLA (3:1 split 2022-08-25) — prices show smooth continuity across splits, not raw $1200→$120 jumps.
  - ❌ "Kelly formula is dead code" — **stale claim, not dead**. `lib/quant/kelly.ts` is imported in 8 places (live route, QuantLab, signals, engine, scripts, tests).
  - ✅ "EMA seeding bug in technicals.ts" — was real but in dead code (the `ema` named export in technicals.ts had zero callers). Fixed by **deleting** the dead buggy function (commit `7fc76ff`); canonical `ema`/`emaFull` from `indicators.ts` remain the source of truth.
  - ✅ "BTC regime classification missing" — was real. Added `btcRegime()` in `lib/quant/btc-indicators.ts` returning STRONG_BULL / BULL / NEUTRAL / BEAR / STRONG_BEAR / EUPHORIA / CAPITULATION with confidence derived from ATR%. 7 unit tests.
  - ✅ "SPY relative strength missing" — was real. Added `relativeStrengthVsBenchmark()` in `lib/quant/relativeStrength.ts` computing ratio (ticker/SPY) over 1m/3m/6m windows. 6 unit tests.
  - ✅ "No automated data refresh" — was real. Added `.github/workflows/refresh-data.yml` running weekly Sunday 22:00 UTC.

### Standing notes for future agents
- **Trust the code, not `progress.md`.** That file (now in `docs/archive/`) had multiple stale claims about "remaining bugs" that turned out to be already-fixed or already-handled. Always grep before fixing.
- **DeepSeek v4 Pro** is wired via MCP (`mcp__deepseek__chat_completion`). A user-level hook at `~/.claude/settings.json` enforces `model: "deepseek-v4-pro"` only — Flash fallback is hard-blocked at the harness level. Use Pro for analysis offload; Opus for architecture and final code review.
- **CI deploys automatically:** push to `main` → Vercel auto-deploys to https://quantan.vercel.app
- **Weekly data refresh** runs automatically; if you need a manual refresh, trigger `Weekly Data Refresh` workflow via GitHub Actions UI.

---

## What Has Been Built

### Phase 1 (commit eec5b30)
- Vitest with 80% coverage thresholds
- `lib/quant/indicators.ts` — canonical indicator source (SMA, EMA, RSI, MACD, BB, ATR, ADX, OBV, VWAP, StochRSI)
- 10 test files in `__tests__/`
- `scripts/benchmark-signals.mjs` — baseline: **56.35% win rate**
- `lib/qa/dataValidator.ts`, `lib/qa/signalTracker.ts`

### Phase 2 (merged PR #3)
- `lib/quant/multiTimeframe.ts` — daily→weekly/monthly aggregation, alignment score −3..+3
- `lib/quant/regimeDetection.ts` — vol20/vol60 ratio, ADX trend, strategy hint
- `lib/quant/volumeProfile.ts` — POC, Value Area High/Low
- `lib/backtest/signals.ts` — `enhancedCombinedSignal()` with 7-factor weighted scoring, regime-adaptive weights
- 187 tests passing

### Phase 3 (current branch)
- `lib/options/greeks.ts` — Black-Scholes, Greeks, Newton-Raphson IV
- `lib/options/chain.ts` — Yahoo `options()` wrapper + greeks enrichment (r = 5.25%)
- `lib/options/sentiment.ts` — P/C ratios, max pain
- `lib/options/gex.ts` — GEX per strike, dealer flip point
- `lib/options/flow.ts` — unusual flow (vol > 3× OI), near-ask sentiment
- `app/api/options/[ticker]/route.ts` — 5-min cached endpoint
- `components/options/` — OptionsChainTable, GexChart, MaxPainGauge, FlowScanner
- **Options tab** added to `/stock/[ticker]` (lazy-loaded)
- 4 test files in `__tests__/options/`

### Phase 4 (current branch)
- `lib/quant/intermarket.ts` — correlations vs SPY/^VIX/UUP/TLT (63d + 252d), risk_on/risk_off/mixed regime
- `lib/quant/sectorRotation.ts` — momentum (40×3mo + 30×6mo + 30×12mo − 1mo crash filter) + RSI mean-reversion boost
- `app/api/sector-rotation/route.ts` — 1hr cached endpoint
- `components/SectorRotationPanel.tsx` — sector heatmap grid, OW/UW signals
- `ml/` — Python FastAPI sidecar (RandomForest + XGBoost + LogReg ensemble, walk-forward 500d train / 60d predict)
- `lib/ml/client.ts` + `app/api/ml/[ticker]/route.ts` — graceful TS proxy
- 2 new test files

**Current test count: 266 passing · TypeScript clean**

---

## Phase 5–7 Complete — What Was Built in Branch `claude/loving-banach`

### Phase 5 (Data Infrastructure) — Pre-existing + confirmed complete
- `lib/data/providers/` — types.ts, yahoo.ts, polygon.ts, alphavantage.ts, fred.ts, index.ts
- `lib/data/warehouse.ts` — SQLite warehouse with better-sqlite3

### Phase 6 (Portfolio & Risk)
- `lib/portfolio/tracker.ts` — position model, CRUD, localStorage persistence
- `lib/portfolio/var.ts` — Historical VaR/CVaR (95%/99%, 1d/10d), Kupiec backtesting, marginal VaR
- `lib/portfolio/riskParity.ts` — inverse-vol weighting, ERC (Maillard-Roncalli), correlation-adjusted Kelly
- `lib/portfolio/diversification.ts` — correlation matrix, Herfindahl index, sector exposure
- `lib/portfolio/stressTest.ts` — GFC 2008, COVID 2020, Rate Shock 2022, Dot-com 2000, Q4 2018

### Phase 7 (Continuous Optimization)
- `lib/optimize/gridSearch.ts` — walk-forward grid search (70% IS / 30% OOS), aggregation
- `lib/optimize/parameterSets.ts` — Loop 1 (768 combos), Loop 2 (288 combos), Loop 3 exit params
- `lib/optimize/sectorProfiles.ts` — 11 GICS sector profiles with differentiated gate configs
- `lib/backtest/exitRules.ts` — ATR-adaptive stops, profit-taking, trailing stops, panic exit, time exit
- `lib/backtest/portfolioBacktest.ts` — multi-instrument engine (max 10 positions, correlation-adjusted)
- `scripts/benchmark-enhanced.ts` — TypeScript benchmark using actual `enhancedCombinedSignal()`

### Signal Improvements (Optimization Loop 1/2 infrastructure)
- `lib/backtest/signals.ts` — Added: `isGoldenCross()`, `hasPositiveMomentum()`, `detectBullishDivergence()`,
  `detectVolumeClimax()`, `isMACompression()`, `SectorGateConfig` interface
- `enhancedCombinedSignal()` updated to accept `sectorGates?: SectorGateConfig` (8th parameter)
  with gate logic: golden cross filter, momentum filter, RSI divergence bonus (+0.15),
  volume climax bonus (+0.20), MA compression bonus (+0.10), per-sector threshold overrides

### Analysis Report
- `QUANTAN_ANALYSIS_REPORT.md` — Complete per-stock analysis (55 stocks + BTC), 11 sector deep dives,
  root cause analysis, market condition matrix, AI agent optimization directives JSON block

### New npm scripts
```bash
npm run benchmark:enhanced    # scripts/benchmark-enhanced.ts (Phase 2 baseline)
npm run optimize:grid         # scripts/optimize-grid.ts (Loop 1 — TO CREATE)
npm run portfolio:backtest    # scripts/portfolio-backtest.ts (Loop 3 — TO CREATE)
```

## What To Build Next: Phase 8 — Run Optimization Loops

### IMMEDIATE: Scripts to create for running the loops

1. **`scripts/optimize-grid.ts`** — Runs Loop 1 grid search:
   ```typescript
   import { gridSearch, aggregateGridResults } from '../lib/optimize/gridSearch'
   import { LOOP1_GRID } from '../lib/optimize/parameterSets'
   // Load all 56 instruments, run gridSearch on each, aggregate results
   // Save to scripts/optimization-results-loop1.json
   ```

2. **`scripts/portfolio-backtest.ts`** — Runs Loop 3 portfolio simulation:
   ```typescript
   import { runPortfolioBacktest } from '../lib/backtest/portfolioBacktest'
   // Load instruments, run multi-stock portfolio backtest
   // Save to scripts/portfolio-backtest-results.json
   ```

3. **Update `scripts/benchmark-enhanced.ts`** — Apply sector profiles (Loop 2):
   ```typescript
   import { getProfileForTicker } from '../lib/optimize/sectorProfiles'
   // Pass profile as sectorGates argument to enhancedCombinedSignal()
   ```

## ── ORIGINAL Phase 5 Plan (for reference — now complete) ──

### [ORIGINAL] Phase 5 — Data Infrastructure

### 5.1 Provider Abstraction (`lib/data/providers/`)
```
lib/data/providers/
  types.ts       — DataProvider interface: fetchDaily(), fetchQuote(), isAvailable()
  yahoo.ts       — Wraps existing yahoo-finance2 usage (refactor existing code)
  polygon.ts     — Polygon.io free tier (5 calls/min)
  alphavantage.ts — AlphaVantage (25/day free tier)
  fred.ts        — FRED macro data (Fed Funds rate, CPI, GDP, unemployment)
  index.ts       — Factory: Yahoo → Polygon → AlphaVantage fallback chain
```

### 5.2 SQLite Data Warehouse
- `lib/data/warehouse.ts` — `better-sqlite3` connection + schema
- Tables: `candles(ticker, date, open, high, low, close, volume)`, `quotes(ticker, price, updated_at)`, `meta(key, value)`
- `scripts/migrate-json-to-sqlite.ts` — one-time migration from `scripts/backtestData/`
- Update `lib/backtest/dataLoader.ts` to read from SQLite when available, fallback to JSON
- **New dep:** `better-sqlite3`, `@types/better-sqlite3`

### 5.3 SSE Streaming (works on Vercel — no WebSockets needed)
- `app/api/stream/[ticker]/route.ts` — Server-Sent Events, polls Yahoo every 15s during market hours
- Client uses `EventSource` API
- Broadcasts: price updates, signal changes

### Phase 5 Implementation Order
1. `lib/data/providers/types.ts` — interface definition
2. `lib/data/providers/yahoo.ts` — refactor existing yahoo calls
3. `lib/data/providers/index.ts` — factory + fallback chain
4. `lib/data/warehouse.ts` + schema migration
5. Update `lib/backtest/dataLoader.ts`
6. Add Polygon, AlphaVantage, FRED providers
7. SSE streaming endpoint

---

## Phase 6 — Portfolio & Risk (after Phase 5)

```
lib/portfolio/
  tracker.ts        — positions, cash, unrealized PnL (localStorage MVP)
  riskParity.ts     — inverse-volatility weighting, iterative risk parity
  diversification.ts — correlation matrix, Herfindahl concentration index
  stressTest.ts     — GFC 2008, COVID 2020, Rate Shock 2022 scenarios
app/portfolio/page.tsx — Portfolio dashboard
```

---

## Phase 7 — Continuous Optimization (after Phase 6)

```
scripts/nightly-backtest.ts     — Fetch latest data, run 56-instrument backtest, alert if win rate < 55%
.github/workflows/nightly-backtest.yml — Scheduled CI
lib/optimize/gridSearch.ts       — Walk-forward parameter grid search (70% in-sample, 30% OOS)
app/monitor/page.tsx             — Rolling 30d win rate, signal heatmap, data quality scores
```

---

## Key Architecture Facts

### Running Tests
```bash
npm install           # first time only — worktree has no node_modules
npm run test          # vitest run (Windows: node_modules/.bin/vitest.cmd run)
npm run typecheck     # tsc --noEmit
npm run benchmark     # scripts/benchmark-signals.mjs
```

### API Route Pattern
```typescript
// See app/api/analytics/[ticker]/route.ts for the canonical pattern
import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'
// ...
return NextResponse.json(data, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } })
```

### Key Shared Utilities
| File | Exports |
|------|---------|
| `lib/quant/indicators.ts` | `OhlcBar`, `OhlcvBar`, `smaArray`, `emaArray`, `rsiArray`, `rsiLatest`, `macdArray`, `atrArray`, `adxArray`, `obvArray`, `bbArray`, `stochRsiArray` |
| `lib/quant/relativeStrength.ts` | `correlation()`, `logReturns()`, `alignCloses()` |
| `lib/sectors.ts` | `SECTORS`, `SECTOR_ETFS` |
| `lib/quant/yahooSymbol.ts` | `yahooSymbolFromParam()` |
| `lib/backtest/dataLoader.ts` | `loadStockHistory()`, `availableTickers()` |

### Test Pattern
```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from '@/lib/...'
describe('myModule', () => {
  it('does X', () => { expect(myFunction(...)).toBeCloseTo(expected, 4) })
})
```

### Benchmark Baseline
- 56 instruments (11 GICS sectors × 5 stocks + BTC)
- Baseline win rate: **56.35%**
- Win rate must not drop below **55%** after any change (`npm run benchmark`)

---

## Important Constraints

1. **No speculative abstractions** — only build what the phase requires
2. **No extra error handling** for impossible cases — trust TypeScript + framework guarantees
3. **Benchmark guard** — always run `npm run benchmark` after touching signal/backtest code
4. **Windows environment** — use Unix bash paths in scripts; vitest binary is `node_modules/.bin/vitest.cmd`
5. **Yahoo Finance only** — no paid data APIs in core code; paid providers go in `lib/data/providers/` with graceful fallback

---

## File Last Updated
2026-04-12 · Branch: claude/loving-banach · Phases 5–7 complete · Analysis report generated · Optimization infrastructure ready
