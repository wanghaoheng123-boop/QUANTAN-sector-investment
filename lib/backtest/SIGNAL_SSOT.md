# Signal SSOT (single source of truth)

**Canonical resolver:** `resolveBacktestSignal()` in `lib/backtest/signals.ts`

All production paths must call this function (directly or via thin adapters). Do not duplicate `regimeSignal` + `bullishCount` or inline dip-buy rules in routes or `.mjs` benchmarks.

## Routing

| `QUANTAN_USE_ENHANCED_SIGNAL` | `NODE_ENV` | Path |
|-------------------------------|------------|------|
| `1` / `true` | any | `enhancedCombinedSignal()` + optional `sectorGates` |
| `0` / `false` | any | `regimeSignal()` only (production default) |
| unset | `production` | regime-only |
| unset | `development` / `test` | enhanced (research parity in dev) |

**CI canonical benchmark** forces `QUANTAN_USE_ENHANCED_SIGNAL=0` in `scripts/benchmark-signals.ts` so the gate matches Vercel production.

## Consumers (must use SSOT)

| Consumer | Entry |
|----------|--------|
| Backtest engine | `lib/backtest/engine.ts` → `resolveBacktestSignal` |
| Live signals API | `lib/backtest/liveSignal.ts` → `buildLiveInstrumentSignal` |
| Canonical benchmark | `scripts/benchmark-signals.ts` |
| Portfolio sim | `lib/backtest/portfolioBacktest.ts` |
| Engine simulation costs | `lib/backtest/engine.ts` → `executionModel.ts` (`TX_COST_*` derived) |
| Enhanced research only | `scripts/benchmark-enhanced.ts` → `enhancedCombinedSignal` (explicit, not SSOT) |
| Grid search (fast path) | `lib/optimize/gridSearch.ts` inline simplified signal — **not** SSOT; research only |

## Label metrics (benchmark)

20-day forward return win/loss uses `lib/backtest/benchmarkLabel.ts` + `lib/backtest/executionModel.ts` for **net** returns after round-trip costs. This is a **label** metric, not full `engine.ts` simulation.

## Backtest universe & survivorship (NEW-Q-1, inspection 2026-06-30)

Backtest/benchmark universe: **55 currently-listed large-cap names** (sector-ETF top holdings, see
`lib/sectors.ts`) plus **BTC** = **56 instruments total**, as of the latest data snapshot
(`scripts/backtestData/*.json`; the 4 macro series TLT/UUP/TNX/IRX are filtered out of the WR).

Because the set contains only names that survive today, it is subject to **survivorship bias** —
delisted, merged, or failed tickers are excluded — which tends to **overstate** historical win rates
and returns versus a true point-in-time universe. Published figures (e.g. the ~55.9% net benchmark
win rate) are **research backtest estimates, not a realized track record**. A survivorship-free
evaluation would require point-in-time index constituents (a separate data project).

## Tests

`__tests__/backtest/signalParity.test.ts` — same bars → same `action` from benchmark helper, resolver, and live adapter.
