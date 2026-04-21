---
name: QUANTAN Architecture Reference
description: File map, AI model roles, data flow, and invariants — read before editing any file in the QUANTAN repo
type: project
---

# QUANTAN Architecture Reference

**Why:** Agents picking up QUANTAN need to navigate a large codebase quickly. This file maps purpose → file path for the most important modules.

**How to apply:** Read this before editing any file. Always check the invariant list at the bottom.

---

## Critical File Map

| Purpose | File |
|---|---|
| Backtest engine (primary) | `lib/backtest/engine.ts` |
| Signal generation | `lib/backtest/signals.ts` |
| Data loading for backtest | `lib/backtest/dataLoader.ts` |
| Enhanced backtest + sector | `lib/backtest/enhancedBacktest.ts` |
| Options gamma / GEX | `lib/quant/optionsGamma.ts` |
| DCF valuation | `lib/quant/dcf.ts` |
| Research score 0–100 | `lib/quant/researchScore.ts` |
| Canonical indicators | `lib/quant/indicators.ts` |
| Technical indicators (legacy) | `lib/quant/technicals.ts` |
| Market maker analysis | `lib/quant/marketMakerAnalysis.ts` |
| Price floor/ceiling | `lib/quant/priceFloorCeiling.ts` |
| Sector rotation | `lib/quant/sectorRotation.ts` |
| Multi-timeframe | `lib/quant/multiTimeframe.ts` |
| Volume profile | `lib/quant/volumeProfile.ts` |
| Intermarket correlations | `lib/quant/intermarket.ts` |
| Regime detection | `lib/quant/regimeDetection.ts` |
| Investment frameworks | `lib/quant/frameworks.ts` |
| Kelly criterion | `lib/quant/kelly.ts` |
| Data warehouse schema | `lib/data/warehouse.ts` |
| Yahoo provider | `lib/data/providers/yahoo.ts` |
| FRED macro provider | `lib/data/providers/fred.ts` |
| Provider chain | `lib/data/providers/index.ts` |
| Portfolio tracker | `lib/portfolio/tracker.ts` |
| Risk parity | `lib/portfolio/riskParity.ts` |
| Grid search optimizer | `lib/optimize/gridSearch.ts` |
| Walk-forward optimizer | `lib/optimize/walkForwardGrid.ts` |
| Sector definitions | `lib/sectors.ts` |
| Data verification helper | `lib/research/dataVerification.ts` |
| Strategy config DSL | `lib/strategy/strategyConfig.ts` |
| Options income (paper) | `lib/options/income/paperIncome.ts` |
| Options filter | `lib/strategy/optionsFilter.ts` |
| Options greeks | `lib/options/greeks.ts` |
| Options chain | `lib/options/chain.ts` |
| Options sentiment | `lib/options/sentiment.ts` |
| Options GEX | `lib/options/gex.ts` |
| Options flow | `lib/options/flow.ts` |
| Nightly backtest script | `scripts/nightly-backtest.ts` |
| Benchmark check | `scripts/benchmark-signals.mjs` |
| Agent context doc | `AGENTS.md` |

---

## AI Model Roles

| Model | Role | When to use |
|---|---|---|
| `claude-opus-4-7` | Brain / Orchestrator | Strategic decisions, hypothesis generation, research synthesis, quality gate, report prose |
| `claude-sonnet-4-6` | Executor | Code generation, algorithm implementation, API development |
| `claude-haiku-4-5` | Fast Processor | Data pipelines, batch processing, quick validation, real-time signals |

---

## Data Flow

```
External Sources → lib/data/providers/ → lib/data/warehouse.ts (SQLite)
                                       → lib/backtest/dataLoader.ts → lib/backtest/engine.ts

Current providers:
  - Yahoo Finance (primary)  → lib/data/providers/yahoo.ts
  - Polygon.io (optional)    → lib/data/providers/polygon.ts
  - Alpha Vantage (optional) → lib/data/providers/alphavantage.ts
  - FRED (macro)             → lib/data/providers/fred.ts

Phase 8 additions:
  - Stooq (30Y OHLCV)        → lib/data/providers/stooq.ts
  - CBOE (VIX history)       → lib/data/providers/cboe.ts
  - NBER (recession dates)   → lib/data/providers/nber.ts
  - SEC EDGAR (13F)          → lib/data/providers/edgar.ts
  - CFTC (COT)               → lib/data/providers/cftc.ts
```

---

## Benchmark Baseline (Never Break)

- 56 instruments: 55 GICS sector stocks + BTC
- Win rate: **56.35%** actual · **55%** hard floor
- Run `npm run benchmark` after ANY change to `lib/backtest/` or `lib/quant/`

---

## Test & Verification Commands

```bash
npm run test                # vitest (80% coverage target)
npm run test:types          # tsc --noEmit
npm run benchmark           # win rate floor check
npm run benchmark:optimizer # grid search smoke test
npm run verify:logic        # indicator math correctness
npm run verify:indicators   # SMA/EMA/RSI/MACD tolerance < 1e-4
npm run nightly             # scheduled backtest run
npm run migrate:warehouse   # JSON → SQLite migration
```

---

## Invariants (Never Break)

1. `npm run benchmark` ≥ 55% win rate after every code change
2. No paid APIs in core (`POLYGON_API_KEY`, `ALPHAVANTAGE_API_KEY` optional via env)
3. `tsc --noEmit` must pass — no `any` in quant modules
4. Next-day execution model — signals at close, execute at next open (no lookahead)
5. 11 bps transaction costs per side (22 bps round-trip)
6. SQLite via Node 22.5+ built-in `node:sqlite` only (no `better-sqlite3`)
7. All novel analytics annotated via `createVerification()` from `lib/research/dataVerification.ts`
8. Update `AGENTS.md` when any phase completes
9. Windows dev environment — Unix bash paths in scripts; vitest may need `.cmd`
