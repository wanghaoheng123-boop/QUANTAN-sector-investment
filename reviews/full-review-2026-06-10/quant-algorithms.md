# Quant/Algorithm Layer — Deep Correctness Review (2026-06-10)

Reviewer: Claude (senior quant-finance code review agent)
Base commit: `6945e34` (main, post 2026-06-04 inspection remediation, post PR #53 SSOT + PR #55 signals split)
Status: IN PROGRESS — findings appended incrementally.

## Scope

- `lib/backtest/**` — engine.ts, signals.ts (+ split files signalHelpers.ts / signalTypes.ts / regimeSignal.ts), core.ts, portfolioBacktest.ts, gates.ts
- `lib/optimize/**` — gridSearch.ts, sectorProfiles.ts
- `lib/indicators*`, `lib/chartEma.ts`, `lib/scenarios/**`, `lib/portfolio/**`, `lib/crypto/**` (btc-indicators SSOT re-exports, PR #53)
- `__tests__/` for the above — test-quality assessment (pinned numbers vs invariants; look-ahead immunity)

## Specific verifications (prior remediation claims)

1. `aggregatePortfolio` (lib/backtest/engine.ts): common-window end-alignment + 252/365 annualization fix
2. `gridSearch.ts`: inert grid dimensions collapsed; OOS-selection-bias documentation adequacy
3. signals.ts split: behavior preservation, circular imports, dead re-exports
4. `lib/crypto` calcMVRV / calcS2FPrice re-export SSOT — single source?
5. Known-open items (characterize only): survivorship bias in data universe; scenarios Taylor-expansion limitation; Phase-11 enhanced-signal stack dormant behind featureFlags

## Severity / confidence legend

- P0 live-prod broken · P1 wrong results / money-relevant math · P2 quality/robustness · P3 nit
- Confidence: high / medium / low

---

## Findings

### Batch 1 — engine.ts, core.ts, signals split, exitRules.ts, executionModel.ts

#### V1 — VERIFIED: aggregatePortfolio end-alignment + 252/365 annualization fix is correct (with one new edge case, see F-2)
`lib/backtest/engine.ts:78-147`. The remediation (commit `2856db4`) is real: curves are combined
end-aligned over the common `minLen` window (`offset = curve.length - minLen`, engine.ts:102-105),
no forward-padding, and `annDays` is 365 if any constituent's `tradingDaysPerYear()` is 365, else
252 (engine.ts:85). Sharpe/Sortino use per-bar returns of the combined curve with `rf/annDays` and
`sqrt(annDays)` (engine.ts:141-145); max-DD is computed on the combined curve (engine.ts:116-124).
Mixed-calendar (crypto 7d vs equity 5d) residual is honestly documented at engine.ts:75-77.
Confidence: high.

#### F-1 (P1, high) — aggregatePortfolio: one short-history instrument silently zeroes the whole portfolio summary
`lib/backtest/engine.ts:78-96` + `lib/backtest/core.ts:210-221`. `backtestInstrument` returns a
stub result with `equityCurve: [initialCapital]` (length 1) whenever an instrument has
`rows.length < 252` (core.ts:217). `aggregatePortfolio` filters only `equityCurve.length > 0`
(engine.ts:78), so the stub passes and drags `minLen` to 1. Since the combine block requires
`minLen > 30` (engine.ts:96), the entire portfolio degenerates: `totalReturn = 0`,
`annualizedReturn = 0`, `finalCapital = 0`, `initialCapital = 0`, Sharpe/Sortino `null`, and
`alpha = 0 − bnhAvg` (a spurious large negative). One recently-listed ticker in an otherwise
healthy multi-year portfolio wipes the portfolio summary to zeros — and reports "finalCapital $0"
to the `/api/backtest` consumer. Pre-remediation the bar-index combine was wrong differently but
did not have this cliff. Fix direction: filter to `equityCurve.length > 30` (or exclude stub
results with `totalTrades === 0 && days < 252`) before taking the min, and document the exclusion
in the response. Need-to-verify: whether the API route pre-filters short-history tickers (checked
below — see F-1a note in Batch 2).

#### F-2 (P2, high) — alpha compares mismatched windows after the common-window fix
`lib/backtest/engine.ts:153-154`. `truePortfolioReturn` is measured over the common (min-length)
window, but `bnhAvg` averages each instrument's `bnhReturn` over its FULL per-instrument history
(`computeBuyAndHoldReturn(rows)` over all rows, core.ts:408). When curve lengths differ, `alpha`
subtracts a long-window B&H from a short-window portfolio return — apples-to-oranges. The
end-alignment remediation fixed the portfolio side but left the benchmark side on the old window.
Fix direction: compute B&H over the same end-aligned common window (needs dated curves or per-bar
closes in the result).

#### F-3 (P2, high) — trailing-stop logic: activation uses same-bar close, fill uses same-bar low (intra-bar look-ahead), and the stop never ratchets
`lib/backtest/core.ts:276-305`. The "raise stop to breakeven after +2×ATR" branch gates on
`profitFromEntry = (signalPrice − entry)/entry` where `signalPrice = rows[i].close` (core.ts:280),
then immediately calls `evaluateStopHit(rows[i], trailStopPx, …)` which fills using the SAME bar's
low/open (core.ts:289). In live trading you can only raise a stop after observing the close; the
raised stop becomes active on bar i+1. As written, a wide-range bar whose close is ≥ +2ATR but
whose low dipped to breakeven+0.5% books an exit that was not orderable — residual look-ahead
(small but systematically favorable: converts intraday round-trips into protected scratches).
Additionally the raise is NOT persisted: `highestPriceAfterEntry` is updated (core.ts:278) but
never used in the trail condition — `profitFromEntry` uses the current close, so if price falls
back below the +2ATR threshold the breakeven stop silently de-activates (no ratchet). The stored
peak field is decision-dead. Same structure applies to the 4×ATR lock branch (core.ts:297-304).
Confidence: high on mechanics; medium on materiality (requires wide-range bars).

#### F-4 (P2, high) — trade pnlPct (and thus winRate/profitFactor) is gross of the 22 bps round-trip cost
`lib/backtest/core.ts:171-175`. `closePosition` computes `pnlPct = (fill − entry)/entry` while the
11 bps/side fees are applied only to capital (`netProceeds`, core.ts:169-170; entry-side at
core.ts:351-352). Equity/returns/Sharpe are net (correct), but `winRate`, `profitFactor`,
`avgTradeReturn`, and every reported per-trade `pnlPct` are gross-of-cost: a trade closing +15 bps
gross is counted as a WIN though it lost money net. The CI WR floor and the published 48.37%
re-baseline therefore measure gross win rate. Not new to the split, but unreported in prior
reviews. Fix direction: subtract `2*TX_COST_PCT_PER_SIDE` (and entry slippage already embedded in
entryPrice) inside `closePosition`, then re-baseline WR floor. Confidence: high.

#### V2 — VERIFIED: signals.ts split (PR #55) is behavior-preserving; no circular imports; no broken import path
Mechanical verification (whitespace-normalized function-body diff of `872d465^:signals.ts` vs the
four current files): all 16 functions — `piecewiseRsiScore`, `isGoldenCross`,
`hasPositiveMomentum`, `detectBullishDivergence`, `detectVolumeClimax`, `isMACompression`,
`sma200DeviationPct`, `sma200Slope`, `priceWasNearSmaRecently`, `regimeSignal`, `clamp`,
`volumeZoneScore`, `volRegimeScore`, `deviationLabel`, `enhancedCombinedSignal`,
`resolveBacktestSignal` — IDENTICAL; `DEFAULT_CONFIG` and all 4 `WEIGHT_PROFILES` rows identical
(weights each sum to 1.0, re-checked by hand). `madge --circular` over lib/backtest+lib/quant+
lib/optimize: 0 cycles. All 6 external importers (`core.ts`, `liveSignal.ts`, `benchmarkLabel.ts`,
`portfolioBacktest.ts`, `scripts/benchmark-enhanced.ts`, 3 test files) still import from
`signals.ts` and every name they use is re-exported. Confidence: high.

#### F-5 (P3, high) — split residue: dead code + dead re-exports + newly-public internals
(a) `deviationLabel` in `lib/backtest/regimeSignal.ts:14-18` is defined and never called — it was
already dead pre-split and was carried over. (b) `regimeSignal.ts:23-76` newly EXPORTS the
previously-private `clamp`, `WEIGHT_PROFILES`, `volumeZoneScore`, `volRegimeScore` (needed by
signals.ts, but they are now public API surface with zero external consumers). (c) Re-exports in
`signals.ts:30-53` of `isGoldenCross`, `hasPositiveMomentum`, `detectBullishDivergence`,
`detectVolumeClimax`, `isMACompression`, `priceWasNearSmaRecently`, and types `DipSignal`/
`RegimeSignal`/`WeightedConfirm` have no external consumer (grep across lib/app/components/
scripts/__tests__) — kept deliberately for path stability, but they are dead surface. (d)
`signalTypes.ts:9` re-exports `OhlcBar`/`OhlcvBar`, creating a third import surface for those
types beside `lib/quant/indicators` (the exact pattern structure review P1-06 removed for
indicator functions). All nits; no behavior impact.

#### F-6 (P2, medium) — SSOT violation: sma200DeviationPct / sma200Slope duplicated in technicals.ts
`lib/backtest/signalHelpers.ts:139-160` vs `lib/quant/technicals.ts:93-105`. Two identical
implementations of both functions (independently verified line-by-line — currently byte-equivalent
logic). `BtcQuantLab.tsx` imports from technicals, the backtest engine from signalHelpers. The
regime zone thresholds (+20/+10/0/−10/−20/−30) are ALSO duplicated in `technicals.ts:160-166` vs
`regimeSignal.ts:125-172`. Nothing pins the two copies together (no sync test found for these,
unlike the crypto MVRV pair). A future tweak to one side silently forks BTC-lab vs backtest regime
classification. Fix direction: re-export from one canonical module, as done for calcVWAP/MVRV.

#### F-7 (P3, high) — stale zone doc-comments survive in regimeSignal.ts
`lib/backtest/regimeSignal.ts:90` says "FIRST_DIP: -10% to -5%" but the code branch (line 142,
`dev >= -10` after `dev >= 0` was handled) covers −10% to 0%. Same stale "-10 to -5" comment at
line 142's docstring sibling (line 90 in the header block). Cosmetic only — the 2026-06-04 P2
"stale doc comments in signals.ts" survived the split by being copied verbatim.

#### N-1 (note) — evaluateStopHit / checkExitConditions verified correct
`lib/backtest/exitRules.ts:140-163`: trigger/fill semantics for all 4 side×kind combos are
correct, including gap-through fills at open (worse for stops, better for targets) and the
`level <= 0`/non-finite guards. Exit priority ordering (stop > panic > signal > target > trail >
time, exitRules.ts:215-257) resolves same-bar stop+target conflicts conservatively in favor of the
stop. `atrAdaptiveStop` excludes the still-forming entry bar (exitRules.ts:86). 22 bps round-trip
cost model SSOT (`executionModel.ts:16-23`, 5+2+4 bps/side ×2) consistent with
`TX_COST_BPS_PER_SIDE` in core.ts:15. Confidence: high.

### Batch 2 — portfolioBacktest.ts, walkForward.ts, dataLoader.ts, liveSignal.ts, benchmarkLabel.ts, /api/backtest route

#### F-1a (P1, high — confirms F-1 is LIVE) — /api/backtest inclusion gate (≥100 rows) does not match the engine stub gate (<252 rows)
`app/api/backtest/route.ts:75-77,86-88` includes any instrument with `rows.length >= 100` in
`results`, but `backtestInstrument` returns a length-1 equity-curve stub for anything `< 252` rows
(core.ts:210-221). Therefore any ticker with 100–251 candles (recently listed, or a partially
backfilled warehouse entry) produces a stub that — per F-1 — collapses `minLen` to 1 in
`aggregatePortfolio` and zeroes the ENTIRE live portfolio block (totalReturn 0, finalCapital 0,
alpha = −bnhAvg). The two gates must agree (route should use ≥ 252, or the aggregator must drop
stubs). This is the highest-impact NEW finding of this review. Confidence: high.

#### F-8 (P2, high) — portfolio engine: T+1 exits are booked one bar early in the equity curve (one-bar look-ahead in daily returns)
`lib/backtest/portfolioBacktest.ts:320-345` + `resolvePortfolioExitFillPrice` (lines 45-56). For
signal/panic/time exits the fill price is correctly TOMORROW's open (`rows[barIdx+1].open`), but
the capital credit, trade booking, and position removal all happen on TODAY's loop iteration
(`capital += …` line 345; `equityHistory.push(finalEquity)` line 523). Equity at bar `di`'s close
therefore embeds bar `di+1`'s open price — `dailyReturns[di]` contains one-bar-ahead information,
and the position is not marked overnight. Trade-level PnL is unaffected (fills are correct), but
Sharpe/Sortino/VaR/maxDD on the portfolio curve are computed from a return series with a
systematic one-bar timing shift on every T+1 exit. Same pattern in the circuit breaker
(lines 491-515: next-open fill credited same-bar). The single-instrument engine (core.ts) has the
identical timing convention (closePosition pushes equity on the signal bar) — consistent, but both
shift the exit MTM a bar early. Materiality: small per exit (close→open gap), nonzero in
aggregate. Confidence: high on mechanics, medium on materiality.

#### F-9 (P2, high) — entry-side slippage double-count: 2 bps charged twice on every entry
`lib/backtest/core.ts:236,344,351-352` and `lib/backtest/portfolioBacktest.ts:32,452,459-460`.
Entry fill = `nextOpen * (1 + 2bps)` AND the per-side cost (11 bps) charged on the cost basis
already INCLUDES `slippageBpsPerSide: 2` (`executionModel.ts:18`). So entry friction is
effectively 13 bps/side against a documented 11, and the "22 bps round-trip" headline is really
~24 bps on entries. `netPnlPctFromPrices` (portfolioBacktest.ts:59-64) compounds the same way
(entryPrice already slipped + `entryAllIn = entryPrice * (1 + 11bps)`). Direction is conservative
(understates performance), but the cost model SSOT claim is inaccurate and the engine/label
benchmark are inconsistent (benchmarkLabel's `netReturnAfterCosts` charges exactly 22 bps, no
extra 2). Either drop ENTRY_SLIPPAGE_BPS or set `slippageBpsPerSide: 0`. Confidence: high.

#### F-10 (P2, high) — winRate/pnl conventions diverge between the two engines
Per-trade `pnlPct` is GROSS of costs in the single-instrument engine (core.ts:171-173, see F-4)
but NET of 2×11 bps in the portfolio engine (`netPnlPctFromPrices`, portfolioBacktest.ts:59-64,
used at 341, 508, 545). Meanwhile portfolio `pnlDollar` (line 342) is GROSS while its sibling
`pnlPct` is NET — the same trade record carries inconsistent dollar vs percent PnL (a +0.1%
gross / −0.1% net trade shows positive pnlDollar and negative pnlPct). Win rates from the two
engines are not comparable, and the trade ledger is internally inconsistent. Confidence: high.

#### F-11 (P2, medium) — maxHoldDays counted in unified-calendar days, not instrument trading days
`lib/backtest/portfolioBacktest.ts:235,316,464` + `exitRules.ts:252-255`. `entryIdx`/`currentIdx`
passed to `checkExitConditions` are indices into the UNION date axis of all instruments
(`dates` includes weekends whenever BTC is in the universe). For an equity position in a mixed
crypto+equity portfolio, `holdDays = di − entryIdx` accrues ~7 days/week, so
`maxHoldDays: 20` becomes ~14 equity trading days — time exits fire ~30% early, and behavior
differs between pure-equity and mixed universes for the same config. Confidence: high mechanics,
medium impact (depends on whether BTC is included in the live call — it is, route.ts:82-88).

#### F-12 (P3, high) — walkForward.ts hardcodes 252-day annualization and rf/252 for all instruments
`lib/backtest/walkForward.ts:56-69`. `annualized()` uses `days/252` and `windowSharpe` uses
`getRiskFreeRateSync()/252`, `sqrt(252)` regardless of instrument — the F1.6 crypto-365 fix was
applied to core.ts/engine.ts/portfolioBacktest.ts but not here. For BTC walk-forward windows,
IS/OS annualized returns are overstated (exponent 252/365 too aggressive) and window Sharpe is
~17% understated. `oosRatio` mostly cancels the bias (same factor in numerator/denominator), so
the headline overfitting diagnostic is fine — display values are not. Also `walkForwardSummary`
(line 211-212) averages null Sharpes as 0, dragging averages toward zero. Confidence: high.

#### F-13 (P3, medium) — benchmarkLabel: NaN exitPrice would silently count as a LOSS
`lib/backtest/benchmarkLabel.ts:91-102,135-145`. `entryPrice` is finite-guarded but `exitPrice`
is not; a NaN exit makes `grossReturn` NaN which passes the `== null` checks (NaN ≠ null) and then
`NaN > 0 === false` books a loss and poisons `avgReturn20d`. dataLoader's finite-filter makes this
unreachable from the canonical loaders today; it is a latent guard gap if rows ever arrive from
another source. Also note the label benchmark enters at next CLOSE (line 91) while the engine
enters at next OPEN — a documented-nowhere convention drift between the two WR measurements.
Confidence: high on code, low on reachability.

#### F-14 (P3, high) — dead/odd code in portfolioBacktest.ts and engine API
(a) `dayPnl` (portfolioBacktest.ts:239,346) is written, never read — dead. (b) `LivePosition.capital`
(line 127, set at 475) is never consumed. (c) `aggregatePortfolio`'s second parameter
`initialCapital` (engine.ts:41) is entirely unused — the route passes `100_000` (route.ts:91) into
a black hole; returned `initialCapital` is the combined first-bar equity instead. (d)
`avgConcurrentPositions` divides `concurrentSum` (accumulated only for di ≥ 220) by ALL
`dates.length` (line 636) — systematically understated. (e) The mission named
`lib/backtest/gates.ts`: no such file exists anywhere in the repo (gate logic lives in
`signalTypes.ts` `SectorGateConfig` + `sectorProfiles.ts`); noting to prevent phantom-scope
confusion. Confidence: high.

#### N-3 (note) — portfolio engine items verified clean
- Correlation tape (F1.7) is genuinely wired: per-bar prior-close returns, 63-bar window, seeded
  for the first 25 bars to avoid Kelly fail-closing at start (portfolioBacktest.ts:177-208,
  241-256, 425-438). No look-ahead (uses idx−1→idx return of the CURRENT bar's close — available
  at the close when the signal is computed).
- Zero-share partial-exit skip (lines 337-339) correct.
- Kelly on bankroll, concentration cap on equity (F1.18, lines 445-451) correct per Thorp.
- Mark-to-market with `lastKnownClose` forward-fill (F1.19) correct, including circuit-breaker
  fallback chain close→lastKnown→entry (line 497).
- VaR gates (≥100 bars for 95%, ≥250 for 99%, lines 620-628) reasonable; sign convention
  (positive VaR for losses) consistent with `varMetrics` consumers.
- `getRiskFreeRateSync(365)` tenor call (line 582) is the documented 1-y tenor selector, divided
  by `annualizationDays` once — no double-divide.
- dataLoader non-finite row filters on both warehouse and JSON paths (dataLoader.ts:63-95) match
  the D5-1 remediation claim.

#### N-2 (note, P3) — annualization window includes the 200-bar warmup
`lib/backtest/core.ts:401-407`: `years = rows.length / annualization` counts the 200-bar
cash-only warmup, while the equity curve (and Sharpe) start at bar 200. Defensible ("strategy was
in cash"), conservative direction; `excessReturn` (core.ts:465) similarly compares a
warmup-dragged strategy against full-window B&H. Documenting, not flagging.

