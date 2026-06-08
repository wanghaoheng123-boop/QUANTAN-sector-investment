# Quant/Algorithm Review — 2026-06-04

Reviewer: senior quant researcher (read-only)
Scope: `lib/backtest/`, `lib/quant/`, `lib/portfolio/`, `scripts/` quant entry points, `quant_framework/garch.py`. Focus on Cursor's PR #41 (commit `27186af`).

## Severity legend
- **P0** correctness bug — affects signal, fill, PnL, or attribution math.
- **P1** significant bias / methodology weakness — degrades stat validity, may not corrupt numbers in production today.
- **P2** cleanup / quality / dead code / dup.

> NOTE on PR #41 T+1 verification: The trade-level T+1 logic in both `core.ts` and
> `portfolioBacktest.ts` is correct: signal computed at bar `idx` close, fill at
> `idx+1` open; signal / panic / time / max-DD exits all route through T+1; intraday
> stop / profit-target fills correctly use resting-order semantics via
> `evaluateStopHit`. Cursor's fix is real and complete.

---

## P0 Findings (correctness)

### [P0-1] `lib/portfolio/factorAttribution.ts:33-42` — minimum-N guard far too small
The OLS regression has **6 parameters** (intercept + MKT/SMB/HML/MOM/QMJ) yet the guard
`if (n < FACTOR_NAMES.length + 5)` only requires `n < 10`. That leaves at best 4
residual dof. With 4 dof, the OLS β estimates are statistically meaningless (β SE
explodes ~√(σ²/(n-p)) blows up), R² is upward biased, and the model can overfit
arbitrarily. Industry minimum for monthly Fama-French is 36 obs; for daily,
≥120 (Cochrane *Asset Pricing* 2005, p245). Reported loadings on small samples
will appear plausible but are noise. Recommended: require `n ≥ 60` (12 weeks daily)
and even then report adjusted R² and t-stats — see P0-2.

### [P0-2] `lib/portfolio/factorAttribution.ts` — no standard errors, t-stats, or near-collinearity diagnostics
`FactorAttribution` (lines 18-25) exposes loadings + alpha + raw R² only. There is
no way for a consumer to know whether `loadings.SMB = 0.4` is significant or noise.
The normal-equations solve in `olsMultivariate` (80-113) squares the design-matrix
condition number, which is the textbook failure mode for OLS with correlated
factors. `solveLinearSystem` (116-144) only fails when the pivot magnitude is
`< 1e-12` — far below the threshold for ill-conditioned `X'X`. Drops only literally
zero-variance columns (lines 86-91); does not detect near-collinearity (e.g.
QMJ ≈ -HML during a value/quality rotation). Recommended: switch to a QR or SVD
solve, report cond(X'X), compute β SE via `σ²·diag(X'X)⁻¹`, surface t-stats and
adjusted R². Without this, the attribution output is decorative.

### [P0-3] `lib/portfolio/factorAttribution.ts:33-48` — positional tail-slice alignment, not date alignment
`n = min(assetReturns.length, ...factor lengths)`, then both `y` and `X` are
constructed by slicing the **last `n` elements** of each series:
`assetReturns.slice(-n)` and `factors[name][factors[name].length - n + i]`.
This silently assumes every series shares the same calendar end and that the
slices land on the same dates. If, for example, an asset's series ends Friday but
a factor series ends Wednesday, the regression will pair the asset's Friday-bar
return with the factor's Wednesday return and step backward. There is no `date[]`
input. For research dashboards this is the most likely bug-in-the-wild because
production data feeds have asynchronous staleness. Recommended: take parallel
`Date[]` (or epoch ints), inner-join, then regress.

### [P0-4] `lib/backtest/engine.ts:80-89, 99, 131` — `aggregatePortfolio` portfolio equity curve / Sharpe are bar-index aligned, not date aligned, and Sharpe is hardcoded 252
`combinedEquity[i] += i < curve.length ? curve[i] : lastVal` (line 87). Two
instruments with different histories are combined by **bar index** — not date —
and the shorter curve is forward-padded by its terminal value, injecting a flat
zero-volatility tail into the combined equity. The portfolio Sharpe (line 129),
Sortino (131), maxDD (lines 102-110), and "true" portfolio return (98) are then
read off this misaligned curve. Equity calendar is hardcoded `/ 252` (line 99) and
`Math.sqrt(252)` (line 129), so a crypto + equity portfolio reports SPY-calendar
annualization even when half the constituents trade 7 days/week. Severity depends
on which call paths read this — but `aggregatePortfolio` is exported from
`engine.ts` (line 40) and is the legacy public surface; if any UI / report still
calls it, the headline portfolio Sharpe is wrong. Recommended: build a
calendar-aligned combined equity using the same union-of-dates pattern as
`runPortfolioBacktest`, and call `tradingDaysPerYear` per leg.

### [P0-5] `lib/backtest/signals.ts:454, enhancedCombinedSignal` — `yieldCurveGate` declared and documented but never applied
Line 454 of `SectorGateConfig` defines `yieldCurveGate?: boolean` with a doc
comment "If true, apply yield-curve penalty for Financials." The portfolio config
builder at `portfolioBacktest.ts:226` explicitly notes `// SectorProfile doesn't
expose yieldCurveGate explicitly — Financials inherits via a reasonable default
at the call site if needed.`, but **no consumer of the gate exists in
`enhancedCombinedSignal`** (search of lines 477-697 turns up zero references after
the type declaration). Result: Financials sectors silently pass through a code
path that documentation claims is gated. Either the gate must be implemented or
removed; today it is a phantom control.

## P1 Findings (bias / methodology)

### [P1-1] `lib/backtest/core.ts:165-185` vs `lib/backtest/portfolioBacktest.ts:59-64` — win-rate / profit-factor are **gross** in `core.ts`, **net** in `portfolioBacktest.ts`
`core.ts::closePosition` computes `pnlPct = (fillPrice - entryPrice) / entryPrice`
(line 171-173), credits txCost to `capital` separately (170-176) — i.e. **gross**
pnlPct used for `tradeWins/tradeLosses` and `grossProfit/grossLoss` accumulators
(lines 174-175), and consequently `winRate` / `profitFactor` (lines 427-428).
`portfolioBacktest.ts::netPnlPctFromPrices` (59-64) applies per-side cost to
**both** entryAllIn and exitNet — i.e. WR/PF are **net** of costs. So the two
backtest engines report metrics on different cost conventions, and a trade that
is +5 bps gross but −17 bps net counts as a "win" in `backtestInstrument` and a
"loss" in `runPortfolioBacktest`. The PR-41 memory note ("54.66% → 48.37% WR after
T+1 fix") needs to be qualified by which engine it came from. Recommended:
canonicalise on net-of-cost WR (institutional standard), document the change in
`invariants-baseline.md`, and re-baseline tests.

### [P1-2] `lib/backtest/portfolioBacktest.ts:582` and `lib/backtest/core.ts:438, 449, 587` — daily RFR units depend on `getRiskFreeRateSync()` signature
`portfolioBacktest.ts` line 582: `const rfD = getRiskFreeRateSync(365) / annualizationDays`.
`core.ts` line 438 and 449: `getRiskFreeRateSync() / annualization` (no arg).
`engine.ts` line 127: `getRiskFreeRateSync() / 252`. If `getRiskFreeRateSync(arg)`
already converts to a per-period rate when `arg` is set, the portfolioBacktest
call is doing a double-divide and rfD is two orders of magnitude too small (Sharpe
biased high). If `arg` selects the tenor (e.g. DGS1 vs DGS3M) and returns an
annualized yield, the call is correct. **Have not yet read `lib/quant/riskFreeRate.ts`** —
this needs to be checked in the next pass (see "What I did NOT cover"). If the
double-divide hypothesis holds, this is a P0 — promote.

### [P1-3] `lib/backtest/portfolioBacktest.ts:555-557` — portfolio annualization mode is "365 if ANY constituent is crypto, else 252"
Line 555: `const annualizationDays = tickers.some(t => tradingDaysPerYear(t, sectorMap[t] ?? '') === 365) ? 365 : 252`.
A mixed equity + crypto portfolio will be annualized at 365, deflating the
**equity portion** of the returns by sqrt(365/252) ≈ 20% on the Sharpe, and
inflating the year-count in the CAGR formula. Calendar-day annualization is
appropriate only for instruments that actually accrue on weekends. A correct
approach is to compute a portfolio-level "trading days observed" count from the
combined equity series itself, or compute per-leg annualized returns and combine
by weight. The current code biases all mixed portfolios toward worse-looking
metrics on the equity side and better-looking on the crypto side.

### [P1-4] `lib/backtest/signals.ts:580-594` — bullish-divergence / volume-climax / MA-compression bonuses only fire when `sectorGates` is provided
Lines 581-594 are gated `if (sectorGates) { ... }`. So whenever a caller passes
no sectorGates (e.g. tickers absent from `SECTOR_PROFILES` in
`runPortfolioBacktest` — see lines 213-233 of portfolioBacktest), the three
reversal bonuses are **inert** — they neither add nor subtract from the score
ensemble. The detection functions still run for the gated path. The behavior is
sector-conditional rather than universal, which is fine if intended but is a
silent capability cliff: a non-mapped ticker silently loses 3 signal boosters.
Recommended: surface the gating explicitly in the trade reason string, or apply
the bonuses unconditionally and put the gate at a higher level if regime-sensitive.

### [P1-5] `lib/backtest/portfolioBacktest.ts:344-346, 517-523` — proceeds from T+1 exit booked into **today's** equity
On a signal exit at bar `i`, `exitPrice = nextOpen` (line 322 via
`resolvePortfolioExitFillPrice`), and `capital += (exitShares * exitPrice - exitTxCost)`
(line 345). The end-of-loop equity computation (line 517-523) then uses
`currentTime = dates[di]` (today's date) to look up MTM prices for remaining open
positions — but the closed leg has already been credited at *tomorrow's* open.
Result: the equity curve for date `di` mixes today's MTM with tomorrow's exit
fill. Trade-level PnL is correct (the cash credited matches the realized fill);
the 1-bar smear affects only the equity-curve/daily-return series and therefore
Sharpe/Sortino in a small way. Recommended: book the exit into `dates[di+1]`'s
equity, not `dates[di]`'s.

### [P1-6] `lib/backtest/portfolioBacktest.ts:194-208` — correlation tape seed uses unified-date `dates` index, but per-ticker `priceIndex` may return null on missing dates → silent skip
The seed loop (lines 191-208) is meant to pre-populate `tickerDailyReturns[t]`
with 25 bars before the `di = 220` start. It iterates the unified `dates` array
and looks up each date in the per-ticker `priceIndex`. If a ticker has fewer than
220 bars or has a gap during the seed window, the seed will be shorter than
`CORR_SEED_BARS` — but the code does not check this. The first call to
`maxCorrelationVsPeers(candidateReturns, peerReturns, 20)` (line 432) would then
fail-closed only if the helper enforces the min-window; if it returns a value
on `length < 20`, the early-cycle correlation is computed on too few obs and
shrinks Kelly toward zero or fail-closed. The remediation comment at lines 184-189
correctly identifies this as a bug fixed in wave 6; verify
`maxCorrelationVsPeers` actually enforces `length >= 20`. (Cross-file verification
needed — `lib/quant/correlation.ts` not yet read.)

## P2 / Quality findings

### [P2-1] `lib/backtest/signals.ts:533-545` — large block comment references RSI score formula `(50 - rsi14) / 50`, but code uses `piecewiseRsiScore`
The audit-comment block at 522-545 walks through bugs in `rsiScore = (50 - rsi14) / 50`
that have since been replaced by the piecewise Wilder mapping at lines 35-41.
Stale documentation — drop the obsolete formula reference and keep the clamp /
homogeneity rationale.

### [P2-2] `lib/backtest/signals.ts:344-354` — commented-out legacy `combinedSignal` doc block
Lines 344-354 narrate the removal of the legacy `combinedSignal`. After two more
phases of clean-up this can move to a CHANGELOG. Keeping the rationale is fine
but the file is the SSOT, not the change-log.

### [P2-3] `lib/backtest/portfolioBacktest.ts:155-156` — date set is built from epoch seconds without timezone check
`dateSet` is built from `row.time` (epoch seconds). If any data source emits UTC
timestamps and another emits exchange-local, the `Array.from(dateSet).sort()`
still works but date-pairings can be silently off by one bar across data feeds.
Recommended: assert all `time` values are noon-UTC of the trading day on
`dataLoader.ts` ingestion.

### [P2-4] `lib/backtest/signals.ts:404` — "honest WR metrics" doc reference
Plain-text reference to `SIGNAL_SSOT.md` without a path; reviewers cannot follow
the citation. Use a relative path or remove.

---

## Files inspected so far (with LOC)

| File | LOC | Notes |
| --- | --- | --- |
| `lib/backtest/portfolioBacktest.ts` | 657 | T+1 entry+exit correctness verified; metric-net convention diverges from `core.ts`. |
| `lib/backtest/core.ts` | 467 | T+1 fully wired; WR/PF use **gross** pnlPct. |
| `lib/backtest/signals.ts` | 735 | `enhancedCombinedSignal` review complete; `yieldCurveGate` is dead config. |
| `lib/backtest/engine.ts` | 168 | `aggregatePortfolio` mis-aligned by bar index, hardcoded 252. |
| `lib/portfolio/factorAttribution.ts` | 144 | Min-N too small, no SE/t-stat, positional alignment, no cond-no check. |

---

## What I did NOT cover yet (will be filled in next passes)

- `lib/featureFlags.ts` — **HIGH PRIORITY**: `useEnhancedCombinedSignal()`. If
  it defaults `false` in production, the enhanced 7-factor signal is research-only.
- `lib/quant/riskFreeRate.ts` — to disambiguate `getRiskFreeRateSync(365)` vs
  `getRiskFreeRateSync()` semantics (drives P1-2 promotion).
- `lib/backtest/executionModel.ts` — `perSideCostPct` / `costBpsPerSide` actual
  bps; confirm the ~11 bps / 22 bps round-trip claim.
- `lib/quant/correlation.ts` — `maxCorrelationVsPeers`, `correlationAdjustedKelly`.
- `lib/quant/indicators.ts` (667 LOC) — SSOT for SMA/EMA/RSI/MACD/ATR/Bollinger,
  Sortino. Numerical-stability + look-ahead audit.
- `lib/backtest/walkForward.ts`, `liveSignal.ts`, `gates.ts`, `dataLoader.ts`,
  `exitRules.ts`, `executionModel.ts`.
- `lib/quant/` adapters: `optionsGamma`, `priceFloorCeiling`, `marketMakerAnalysis`,
  `enhancedBacktest`, `btc-indicators.ts`.
- `lib/portfolio/tracker.ts` and remaining portfolio files.
- `scripts/` quant entry points.
- `quant_framework/garch.py` (Cursor's MLE fallback).
- `lib/backtest/gates.ts` Phase-11 macro gates and the parkinson vol formula.
- Test files: `__tests__/backtest/portfolioBacktest.test.ts`,
  `__tests__/portfolio/factorAttribution.test.ts`.
