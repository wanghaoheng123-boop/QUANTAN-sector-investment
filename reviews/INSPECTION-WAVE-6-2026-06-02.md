# Inspection Wave 6 — Signal path audit (2026-06-02)

## Consumers traced

| Path | Entry | SSOT function | Status |
|------|-------|---------------|--------|
| CI benchmark | `scripts/benchmark-signals.ts` | `resolveBacktestSignal` | ✅ Unified |
| Single-instrument engine | `lib/backtest/core.ts` | `resolveBacktestSignal` | ✅ Unified |
| Portfolio sim | `lib/backtest/portfolioBacktest.ts` | `resolveBacktestSignal` | ✅ Unified |
| Live desk API | `lib/backtest/liveSignal.ts` → route | `resolveBacktestSignal` | ✅ Unified |
| Enhanced (opt-in) | `QUANTAN_USE_ENHANCED_SIGNAL=1` | `enhancedCombinedSignal` | ⚠️ Off in prod; parity tested when flag set |

## Parity tests

`__tests__/backtest/signalParity.test.ts` — benchmark label helper ≡ direct resolve ≡ live adapter on AAPL fixture.

## Documentation

`lib/backtest/SIGNAL_SSOT.md` — canonical reference.

## Gaps (Q-063 partial)

UI copy still uses generic "win rate" in some panels — label audit deferred to Wave 7 browser QA.

## Backlog

Q-059–Q-062 marked **done** in IMPROVEMENT_BACKLOG.json (2026-06-02).
