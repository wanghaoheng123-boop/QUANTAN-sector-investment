# QUANTAN — Agent Context & Project Memory

> **For any AI agent (Claude Code, Cursor, Windsurf, Copilot, etc.) picking up this project.**
> Read this file first. It contains everything needed to continue development without re-analysing the codebase.

---

## Project Overview

**QUANTAN** is a quantitative trading & investment intelligence platform built with Next.js 14 + TypeScript.  
Goal: >80% selective signal accuracy across all market conditions. Bloomberg-like functionality, accessible.

**Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · yahoo-finance2 · Vitest · lightweight-charts

---

## Institutional backtest, optimization, and QA charter (2026)

**Purpose.** Make the equity simulator/backtest the honest center of the product: preset-driven workflows, bounded optimization, walk-forward discipline, options-aware **guards** (not alpha promises), and reproducible audit metadata.

**Success metrics (statistical, not dollar).** Stable OOS vs IS behavior on toy and real series; bounded iteration counts respected; typecheck + Vitest + signal benchmark green; no secrets in structured logs; latency within documented caps.

**Non-goals.** No guaranteed returns; no autonomous “supervisor” trading agents in runtime; no import of unvetted third-party “profit strategies” (see `docs/EXTERNAL_STRATEGY_VETTING.md`).

**Review loop.** Design note → implementation → tests (`npm run test`, `npm run benchmark`, `npm run benchmark:optimizer`) → CI → staging → human sign-off. Rollback = revert config schema defaults and disable new fusion flags.

**Ownership / ops cadence.** Engineering owns code + CI; product owns copy/disclaimers; weekly review of optimizer defaults and Yahoo rate-limit incidents; monthly methodology review of walk-forward assumptions.

**Owner:** Trader/investor building quant platform. Values backtesting rigor, institutional-grade analysis, and continuous improvement. Familiar with options Greeks, dark pools, gamma exposure, sector rotation.

---

## 7-Phase Upgrade Plan — Status

| Phase | Name | Status | Branch / Commit |
|-------|------|--------|-----------------|
| 1 | Testing & Validation Foundation | ✅ COMPLETE | commit `eec5b30` |
| 2 | Signal Engine Hardening | ✅ COMPLETE | merged via PR #3 |
| 3 | Options & Flow Data | ✅ COMPLETE | branch `claude/pedantic-morse` (PR pending) |
| 4 | Advanced Analytics | ✅ COMPLETE | branch `claude/pedantic-morse` (PR pending) |
| 5 | Data Infrastructure | ✅ COMPLETE | main / workspace |
| 6 | Portfolio & Risk Management | ✅ IN PROGRESS (MVP shipped) | `lib/portfolio/*`, `/portfolio` |
| 7 | Continuous Optimization | ✅ IN PROGRESS (MVP shipped) | `scripts/nightly-backtest.ts`, workflow, `/monitor`, `lib/optimize/gridSearch.ts`, `POST /api/optimize` |

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

### Phase 3 (branch: claude/pedantic-morse)
- `lib/options/greeks.ts` — Black-Scholes, Greeks, Newton-Raphson IV
- `lib/options/chain.ts` — Yahoo `options()` wrapper + greeks enrichment (r = 5.25%)
- `lib/options/sentiment.ts` — P/C ratios, max pain
- `lib/options/gex.ts` — GEX per strike, dealer flip point
- `lib/options/flow.ts` — unusual flow (vol > 3× OI), near-ask sentiment
- `app/api/options/[ticker]/route.ts` — 5-min cached endpoint
- `components/options/` — OptionsChainTable, GexChart, MaxPainGauge, FlowScanner
- **Options tab** added to `/stock/[ticker]` (lazy-loaded)
- 4 test files in `__tests__/options/`

### Phase 4 (branch: claude/pedantic-morse)
- `lib/quant/intermarket.ts` — correlations vs SPY/^VIX/UUP/TLT (63d + 252d), risk_on/risk_off/mixed regime
- `lib/quant/sectorRotation.ts` — momentum (40×3mo + 30×6mo + 30×12mo − 1mo crash filter) + RSI mean-reversion boost
- `app/api/sector-rotation/route.ts` — 1hr cached endpoint
- `components/SectorRotationPanel.tsx` — sector heatmap grid, OW/UW signals
- `ml/` — Python FastAPI sidecar (RandomForest + XGBoost + LogReg ensemble, walk-forward 500d train / 60d predict)
- `lib/ml/client.ts` + `app/api/ml/[ticker]/route.ts` — graceful TS proxy
- 2 new test files

**Test count (as of Phases 3 & 4): 266 passing · TypeScript clean**

### Phase 5 (Data Infrastructure)
- `lib/data/providers/types.ts` — `DataProvider`, `ProviderDailyBar`, `ProviderQuote`
- `lib/data/providers/yahoo.ts` — Yahoo Finance wrapper (`chart`, `quote`)
- `lib/data/providers/polygon.ts` — Polygon aggregates + last trade (optional `POLYGON_API_KEY`, ~12s throttle for free tier)
- `lib/data/providers/alphavantage.ts` — daily + global quote (optional `ALPHAVANTAGE_API_KEY`)
- `lib/data/providers/fred.ts` — `fetchFredObservations()` (optional `FRED_API_KEY`)
- `lib/data/providers/index.ts` — `getEquityDataProvider()` chain: **Polygon → Alpha Vantage → Yahoo**
- `lib/data/warehouse.ts` — schema helpers + `readCandles` / `listWarehouseTickers` (DB-agnostic interface)
- `scripts/migrate-json-to-sqlite.mjs` — JSON `scripts/backtestData/*.json` → SQLite (uses Node **22.5+** built-in `node:sqlite`; run `npm run migrate:warehouse`). On Google Drive / synced folders SQLite may lock — write the DB to a **local path** and set `QUANTAN_SQLITE_PATH` there.
- `lib/backtest/dataLoader.ts` — when `QUANTAN_SQLITE_PATH` points at an existing file, loads candles from SQLite (via `node:sqlite` when available); else JSON. No network.
- `app/api/stream/[ticker]/route.ts` — SSE quote stream (Yahoo every 15s)
- `app/api/analytics/[ticker]/route.ts` — uses `getEquityDataProvider()` for history + quote
- `types/node-sqlite.d.ts` — light typings for `node:sqlite` when `@types/node` lags

---

## What To Build Next: Phase 6 — Portfolio & Risk

```
lib/portfolio/
  tracker.ts         — positions, cash, unrealized PnL (localStorage MVP)
  riskParity.ts      — inverse-volatility weighting, iterative risk parity
  diversification.ts — correlation matrix, Herfindahl concentration index
  stressTest.ts      — GFC 2008, COVID 2020, Rate Shock 2022 scenarios
app/portfolio/page.tsx — Portfolio dashboard
```

---

## Phase 7 — Continuous Optimization (after Phase 6)

```
scripts/nightly-backtest.ts      — Fetch latest data, run 56-instrument backtest, alert if win rate < 55%
.github/workflows/nightly-backtest.yml — Scheduled CI
lib/strategy/strategyConfig.ts   — Strategy DSL: merge/validate, presets, toBacktestConfig (shared by simulator, backtest, optimize)
lib/strategy/optionsFilter.ts    — Options snapshot fetch + conservative filter/fusion for equity paths
lib/optimize/gridSearch.ts       — Bounded grid search; walk-forward–scored variants
lib/optimize/executeOptimize.ts  — Serverless-bounded optimize orchestration
lib/infra/runAudit.ts            — traceId, audit blocks, structured run logging
lib/infra/rateLimit.ts           — Client key + rate limits on simulator/backtest/optimize routes
app/api/optimize/route.ts        — POST bounded parameter search
app/api/optimize/job/route.ts    — Async job id + polling for long optimize runs
app/monitor/page.tsx             — Rolling 30d win rate, signal heatmap, data quality scores
```

---

## Key Architecture Facts

### Running Tests & Verification
```bash
npm install           # first time — node_modules may not exist in a fresh worktree
npm run test          # vitest run (__tests__/**/*.test.ts)
npm run test:types    # tsc --noEmit
npm run typecheck     # same as test:types
npm run benchmark     # scripts/benchmark-signals.mjs (win rate must stay >= 55%)
npm run benchmark:optimizer  # synthetic bounded grid + walk-forward smoke (tsx)
npm run migrate:warehouse   # optional: build SQLite from scripts/backtestData (Node 22.5+)
```

> **Windows note:** If `npm run test` fails with "not recognized", use `node_modules/.bin/vitest.cmd run` directly.

### Environment variables (Phase 5)
| Variable | Purpose |
|----------|---------|
| `POLYGON_API_KEY` | Polygon.io (optional; chain tries before Yahoo) |
| `ALPHAVANTAGE_API_KEY` | Alpha Vantage (optional) |
| `FRED_API_KEY` | FRED macro series for `fetchFredObservations()` |
| `QUANTAN_SQLITE_PATH` | Absolute path to SQLite warehouse file for `dataLoader` |

### API Route Pattern (canonical)
```typescript
// See app/api/analytics/[ticker]/route.ts (uses getEquityDataProvider) or chart route (Yahoo direct)
import { NextResponse } from 'next/server'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const symbol = yahooSymbolFromParam(params.ticker)
  try {
    // ... fetch data ...
    return NextResponse.json(data, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } })
  } catch (e) {
    return NextResponse.json({ error: 'Failed', details: String(e) }, { status: 502 })
  }
}
```

### Key Shared Utilities
| File | Key Exports |
|------|-------------|
| `lib/quant/indicators.ts` | `OhlcBar`, `OhlcvBar`, `rsiLatest()`, `smaArray()`, `emaArray()`, `macdArray()`, `atrArray()`, `adxArray()`, `bbArray()` |
| `lib/quant/relativeStrength.ts` | `correlation()`, `logReturns()`, `alignCloses()` |
| `lib/sectors.ts` | `SECTORS[]`, `SECTOR_ETFS[]` |
| `lib/quant/yahooSymbol.ts` | `yahooSymbolFromParam()` |
| `lib/backtest/dataLoader.ts` | `loadStockHistory()`, `availableTickers()` |
| `lib/data/providers/index.ts` | `getEquityDataProvider()`, `fetchFredObservations()` |
| `lib/data/warehouse.ts` | `readCandles()`, `warehouseTickerKey`, `WAREHOUSE_ENV_PATH` |
| `lib/options/chain.ts` | `EnrichedChain`, `EnrichedContract`, `CallOrPut`, `fetchOptionsChain()` |
| `lib/options/greeks.ts` | `blackScholesPrice()`, `greeks()`, `impliedVolatility()` |
| `lib/quant/sectorRotation.ts` | `sectorScores()`, `momentumScore()`, `meanReversionBoost()` |
| `lib/quant/intermarket.ts` | `analyzeIntermarket()`, `classifyRegime()` |
| `lib/strategy/strategyConfig.ts` | `StrategyConfig`, `mergeStrategyConfig`, `validateStrategyConfig`, `toBacktestConfig`, presets, schema version helpers |
| `lib/strategy/optionsFilter.ts` | `fetchOptionsMetrics`, `applyOptionsFilter`, `applyOptionsSignalFusion` (simulator / backtest) |
| `lib/infra/runAudit.ts` | `newTraceId`, `buildRunAudit`, `configHashFromObject`, `logRunEvent` |
| `lib/infra/rateLimit.ts` | `clientKeyFromRequest`, `rateLimitHit` |
| `lib/infra/apiBase.ts` | `apiUrl()` — browser-side base URL for `/api/*` calls |
| `lib/auth.ts` | `getAuthOptions()` — NextAuth configuration (Google/GitHub when env set) |

### Test Pattern
```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from '@/lib/path/to/module'
describe('module', () => {
  it('does X', () => { expect(myFunction(args)).toBeCloseTo(expected, 4) })
})
```

### Benchmark Baseline
- 56 instruments (11 GICS sectors × 5 stocks + BTC)
- Baseline win rate: **56.35%** (saved in `scripts/benchmark-results.json`)
- **Hard floor: 55%** — if win rate drops below this after a change, revert or fix

---

## Important Constraints for All Agents

1. **No speculative abstractions** — only build what the phase requires
2. **No extra error handling** for impossible cases — trust TypeScript + framework guarantees
3. **Benchmark guard** — always run `npm run benchmark` after touching `lib/backtest/` or `lib/quant/`
4. **Windows environment** — use Unix bash paths in scripts; vitest binary may need `.cmd` extension
5. **Yahoo Finance is free tier** — no paid APIs in core code; paid providers go in `lib/data/providers/` with graceful fallback to Yahoo
6. **SQLite warehouse** — uses Node built-in `node:sqlite` (Node **22.5+**) when `QUANTAN_SQLITE_PATH` is set; no `better-sqlite3` npm dependency
7. **TypeScript strict** — `tsc --noEmit` must pass before committing
8. **Update this file** when a phase completes — change status from 🔲 to ✅ and add what was built

---

## Updating This File

When you complete a phase or significant milestone:
1. Update the status table above
2. Add a summary under "What Has Been Built"
3. Update "What To Build Next" to the next phase
4. Update the "File Last Updated" line below

---

## File Last Updated
2026-04-19 · Institutional backtest charter + optimizer/simulator QA extensions shipped · Phase 6 (Portfolio & Risk) continues
