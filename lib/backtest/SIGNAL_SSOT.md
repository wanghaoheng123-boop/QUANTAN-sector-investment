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

## Tests

`__tests__/backtest/signalParity.test.ts` — same bars → same `action` from benchmark helper, resolver, and live adapter.
