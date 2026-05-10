# AI Memory: Gotchas, Learnings & References
#
# Purpose: Store non-obvious findings, useful snippets, and external references.
# Any AI should:
#   - Read this file to avoid repeating past mistakes.
#   - Append new entries with date and context.
#   - Link to relevant code files or external docs.
#
# ─────────────────────────────────────────────────────────────

## Gotchas (Project-Specific Pitfalls)

### yahoo-finance2 returns single object for 1 ticker, array for multiple
- `yahooFinance.quote('AAPL')` returns object, `yahooFinance.quote(['AAPL','MSFT'])` returns array.
- Always normalize: `Array.isArray(result) ? result : [result]`
- Hit in `app/api/prices/route.ts` — single ticker caused `.map()` crash.

### Wilder smoothing != EMA smoothing for ATR
- `indicators.ts` uses Wilder: `alpha = 1/period` (slower smoothing)
- `btc-indicators.ts` used EMA: `alpha = 2/(period+1)` (faster response)
- Must use the same method for consistent ATR values across the system.
- Fixed in Phase 12 — btc-indicators now uses Wilder smoothing.

### Kelly fraction should be applied to total equity, not cash
- In portfolio backtest, `capital * KellyFraction` undersizes positions when other positions are open.
- Correct: `currentEquity * KellyFraction`
- Fixed in `lib/backtest/portfolioBacktest.ts`.

### .fill() shares object references in JavaScript
- `new Array(n).fill({...})` creates ONE object, all elements point to it.
- Mutating any element mutates all. Use `.fill(null).map(() => ({...}))` instead.
- Hit in `btc-indicators.ts` calcMACD — benign but misleading.

## Useful References
- Black-Scholes: verified against Hull 10th Ed., Chapter 15
- Kelly Criterion: `f* = (bp - q) / b` where b = avgWin/avgLoss
- Wilder's RSI: uses smoothed average (alpha=1/period), not standard EMA
- GEX formula: `(callOI - putOI) * gamma * S^2` (the 100*0.01 factors cancel)
- Max Pain: strike that minimizes total option-writer payout
- Kupiec test: LR = -2 * ln((1-p)^(T-n) * p^n / ((1-n/T)^(T-n) * (n/T)^n)) ~ χ²(1)

## External Resources
- moomoo desktop app — reference for trading UI/UX
- TradingView — charting interaction patterns
- SpotGamma — GEX visualization reference
- FRED API — macro data (Fed Funds, CPI, GDP)
