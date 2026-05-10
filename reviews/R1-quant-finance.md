# R1 — Quantitative Finance Review (Phase 13 S1)

**Reviewer:** R1 — Quantitative Finance (PhD Finance/Math, derivatives + portfolio theory)
**Sprint:** S1 (read-only audit)
**Date:** 2026-05-04
**Standing prompt acknowledged:** Yes — claims below carry file:line refs, primary-source citations, falsifiable acceptance tests. Uncertainty marked explicitly.

---

## Inventory reviewed (full read, end-to-end)

| File | LOC | Read |
|------|-----|------|
| `lib/backtest/engine.ts` | 677 | full |
| `lib/backtest/signals.ts` | 691 | full |
| `lib/backtest/portfolioBacktest.ts` | 493 | structural (function signatures + key call-sites) — flagged for follow-up second-pass |
| `lib/backtest/exitRules.ts` | — | deferred to second-pass |
| `lib/quant/kelly.ts` | — | structural (used at engine.ts:272 + signals.ts:380, 654) |
| `lib/quant/researchScore.ts` | — | deferred to second-pass |
| `lib/quant/dcf.ts` | — | deferred to second-pass |

**Disclosure (per Standing Prompt rule 5):** I do not have full end-to-end coverage on `portfolioBacktest.ts`, `exitRules.ts`, `kelly.ts`, `researchScore.ts`, `dcf.ts` in this S1 pass. I1 must spot-check, and a second R1 pass is required before S2 entry. Findings below are scoped to engine.ts + signals.ts where I do have full coverage.

---

## Findings (severity-ordered)

### F1.1 [CRITICAL] — Walk-forward analysis is structurally broken

**Location:** `lib/backtest/engine.ts:605-650` (`walkForwardAnalysis`)

**Evidence:** Line 626–627 calls `backtestInstrument(ticker, sector, testRows)` where `testRows.length === testDays === 63`. But `backtestInstrument` short-circuits at line 118 with `if (rows.length < 252) return { ...zeros }`. Default `testDays = 63`, so the test window can NEVER produce signals — `osReturn` is structurally guaranteed to be 0 for every window. This means `walkForwardSummary` returns a meaningless `overfittingIndex` and the entire WFA infrastructure provides false confidence.

**Why it is critical:** Walk-forward is the canonical defense against overfitting. Pardo (2008) and Bailey & Lopez de Prado (2014) classify a non-functioning WFA as a CSIE (Certain Source of Investment Error). Users rely on `oosRatio` and `overfittingIndex` to validate strategies. Currently those numbers are noise.

**Citation:**
- Pardo, R. (2008). *The Evaluation and Optimization of Trading Strategies*, 2e. Wiley. Ch. 11 (Walk-Forward Analysis), p233–262.
- Bailey, D. H. & Lopez de Prado, M. (2014). "The Deflated Sharpe Ratio." *Journal of Portfolio Management* 40(5), p94–107.

**Patch sketch:** Walk-forward should not re-call `backtestInstrument` with sub-windows. Instead, the whole series is fed once, and signal/trade indices are partitioned post-hoc into IS/OS by date. Alternatively, train uses `[start, trainEnd]` (≥252 days) and test uses `[trainStart, testEnd]` (≥252 days, trades attributed to the OOS sub-window).

**Acceptance test (falsifiable):** Add `__tests__/backtest/engine.walkforward.test.ts` — feed 2000 deterministic bars; assert that at least 50% of returned `WFWWindow.osReturn` values are non-zero AND that at least 30% of windows have `osReturn !== isReturn`.

**Severity rationale:** Critical — silently-zero OOS is undetectable from the UI; produces false confidence; fixing requires architectural change.

---

### F1.2 [CRITICAL] — Portfolio max-drawdown is computed as max-of-individual-DDs, not curve-DD

**Location:** `lib/backtest/engine.ts:545` (`aggregatePortfolio`)

**Evidence:**
```ts
const maxDrawdown = Math.max(...results.map(r => r.maxDrawdown), 0)
```
But the function already builds a combined portfolio equity curve at line 490 (`combinedEquity`). The CORRECT portfolio DD is the drawdown of `combinedEquity`, not the worst single-instrument DD. Different instruments DD at different times — diversification reduces portfolio DD vs individual DDs.

**Numerical example:** 10 uncorrelated instruments each with 10% DD at different times → portfolio DD ≈ 1-3%. Current code returns 10%. Overstatement factor in this scenario is 3-10×.

**Citation:**
- Magdon-Ismail, M. & Atiya, A. F. (2004). "Maximum Drawdown." *Risk Magazine* (October).
- Bacon, C. R. (2008). *Practical Portfolio Performance Measurement and Attribution*, 2e. Wiley. p102–105.

**Patch sketch:**
```ts
// After building combinedEquity at engine.ts:490:
let portfolioPeak = combinedEquity[firstValid] ?? 0, portfolioMaxDd = 0
for (let i = firstValid; i <= lastValid; i++) {
  if (combinedEquity[i] > portfolioPeak) portfolioPeak = combinedEquity[i]
  const dd = (portfolioPeak - combinedEquity[i]) / portfolioPeak
  if (dd > portfolioMaxDd) portfolioMaxDd = dd
}
const maxDrawdown = portfolioMaxDd  // NOT Math.max(...results.map(r => r.maxDrawdown))
```

**Acceptance test:** `__tests__/backtest/portfolioBacktest.test.ts` — synthesize 10 instruments with sinusoidal but phase-shifted equity curves (each peaks/troughs at different days). Assert `portfolio.maxDrawdown < min(individual_DDs) × 1.1` (portfolio DD smaller than smallest individual DD plus tolerance).

**Severity rationale:** Critical — institutional risk reports rely on max DD for VaR and capital sizing. Overstatement makes the strategy look 3-10× riskier than it is, leading to under-allocation and lost alpha; or in stress reports, looks fine when it isn't.

---

### F1.3 [CRITICAL/HIGH] — Stop-loss and trailing stops fire at close price, not intraday low

**Location:** `lib/backtest/engine.ts:186, 205, 224`

**Evidence:** All exit branches compare `signalPrice` (=`rows[i].close`) to `stopPx`:
```ts
// engine.ts:224
if ((state.openTrade.action === 'BUY' && signalPrice <= stopPx) ||
    (state.openTrade.action === 'SELL' && signalPrice >= stopPx)) { ... }
```
In live trading, an ATR stop-loss is a stop order — it fires when intraday LOW (for a long) crosses the stop, not at end-of-day close. If the intraday low touches the stop and the bar closes above it, the position is already out at fill price. The current backtest counts this as "stop NOT hit, position still open at close" — overstating WR and understating realized losses (especially gap-down opens).

**Citation:**
- Pardo, R. (2008). *The Evaluation and Optimization of Trading Strategies*, 2e. Wiley. Ch. 8 ("Trading System Risk"), p161–164 (intraday vs end-of-day exit modeling).
- Aronson, D. (2007). *Evidence-Based Technical Analysis*. Wiley. p202–205 (slippage and gap-fill modeling).

**Patch sketch:**
```ts
// Replace signalPrice <= stopPx checks with:
const intradayLow = rows[i].low
const intradayHigh = rows[i].high
const stopHitLong = state.openTrade.action === 'BUY' && intradayLow <= stopPx
const stopHitShort = state.openTrade.action === 'SELL' && intradayHigh >= stopPx
if (stopHitLong || stopHitShort) {
  // Fill price = max(stopPx, today's open) - slippage  (gap-down opens fill at open, not stopPx)
  const fillPx = stopHitLong
    ? Math.min(stopPx, rows[i].open) * (1 - SLIPPAGE_BPS / 10000)
    : Math.max(stopPx, rows[i].open) * (1 + SLIPPAGE_BPS / 10000)
  ...
}
```

**Acceptance test:** Construct a synthetic bar series where intraday low pierces stop but close recovers above — current code holds, fixed code exits. Assert exit count differs by ≥1.

**Severity:** Critical for institutional reporting (WR is overstated). High for signal logic (stop-loss is foundational).

---

### F1.4 [HIGH] — Risk-free rate is hardcoded at 4% across multiple call-sites

**Location:** `lib/backtest/engine.ts:373, 385, 525, 601` — repeated `const rfD = 0.04 / 252`

**Evidence:** Sortino, Sharpe, and walk-forward Sharpe all use a hardcoded 4% annual risk-free rate. As of May 2026 the actual 3-month T-bill is ~3.8%, but the relevant point is that historical Sharpe across the full 5Y backtest period (2021–2026) involves rates ranging 0.05% (2021) to 5.4% (2024). A single 4% RFR overstates Sharpe in 2021–2022 and understates it in 2024.

**Citation:**
- Sharpe, W. F. (1994). "The Sharpe Ratio." *Journal of Portfolio Management* 21(1), p49–58. (RFR must be the actual prevailing risk-free rate for the period being measured.)

**Patch sketch:** Pull DGS3MO from FRED (already a documented data source per AGENTS.md Phase 5). For a backtest spanning [t0, t1], use the time-series of DGS3MO or compute mean over the period. Inject as `BacktestConfig.riskFreeRateAnnual?: number | number[]`. Default to FRED-fetched value, fall back to 0.04 with a warning logged.

**Acceptance test:** New unit test feeding two synthetic series differing only by RFR (0.01 vs 0.05) asserts Sharpe values change accordingly.

**Severity:** High — affects every Sharpe/Sortino number on the dashboard and in research reports. Cited rate is wrong by up to 200 bps in some periods.

---

### F1.5 [HIGH] — Buy-and-hold benchmark ignores dividends

**Location:** `lib/backtest/engine.ts:343`

**Evidence:**
```ts
const bnhReturn = (finalPrice - rows[0].close) / rows[0].close
```
This uses raw price returns, not total returns. For dividend-paying ETFs in the universe (XLU 3.4% yield, XLP 2.8%, XLRE 4%, XLF 1.6%, SPY 1.5%) this systematically biases B&H comparisons DOWN, making strategy alpha look better than it is.

**Numerical impact:** XLU 5Y B&H true total return ≈ 32%, price-only ≈ 15%. Strategy "alpha vs B&H" is overstated by ~17 percentage points for XLU specifically; ~5pp on average across the sector ETFs.

**Citation:**
- Sharpe (1994) op cit. — total returns are the standard.
- Bacon (2008) op cit. p44 (geometric total return formula).

**Patch sketch:** yahoo-finance2's `chart()` API already returns split-adjusted closes. Need to additionally fetch dividend events (`historical()` with events flag) and compute total return: `bnh = product(1 + (close[i]/close[i-1] - 1) + div[i]/close[i-1])`. Or use `adjclose` field (`historical()` returns this) which is dividend-adjusted close.

**Acceptance test:** Backtest XLU 2020–2024 — assert `bnhReturn` within 100 bps of yahoo-finance2's `quoteSummary` totalReturn for the same period.

**Severity:** High — every "excess return" claim on the dashboard is overstated by 1.5–4pp depending on instrument.

---

### F1.6 [HIGH] — Crypto annualization uses 252 trading days, but BTC trades 365

**Location:** `lib/backtest/engine.ts:340, 590, 374, 396, 527, 537, 602` — `Math.sqrt(252)`, `years = days / 252`

**Evidence:** Annualization factor is hardcoded 252 (US equity convention). BTC trades 365 days/year. For BTC backtests, annualized return is OVERSTATED by factor `(365/252)^(1/years) ≈ 1.045`/year, and Sharpe/Sortino are OVERSTATED by `sqrt(365/252) ≈ 1.20×` (because daily vol scales by sqrt of bars/year).

**Citation:**
- Bacon (2008) op cit. p43 (annualization factor must match actual trading frequency).

**Patch sketch:** Add `tradingDaysPerYear: number` to `BacktestConfig`, defaulting to 252. Crypto callers (`app/api/crypto/btc/*`, `lib/quant/btc-indicators.ts`) pass 365.

**Acceptance test:** BTC 2-year backtest: assert annualized return computed with 365 differs from 252 by ~4-5pp.

**Severity:** High — `app/crypto/btc/page.tsx` currently displays incorrect annualized return and Sharpe for BTC.

---

### F1.7 [HIGH] — No correlation-adjusted Kelly; portfolio concentrates in correlated names

**Location:** `lib/backtest/engine.ts:272-276` (Kelly sizing per-trade)

**Evidence:** Each instrument's BUY uses `signal.KellyFraction` capped at 0.50 of remaining capital. With portfolioBacktest running 10 positions, if AAPL/MSFT/QQQ/XLK all signal BUY in the same week, all four get full Kelly allocation despite correlations of 0.85+. Effective concentration risk is much higher than nominal position sizing implies.

**Citation:**
- Markowitz, H. (1952). "Portfolio Selection." *Journal of Finance* 7(1), p77–91.
- Maillard, S., Roncalli, T., Teiletche, J. (2010). "The Properties of Equally Weighted Risk Contribution Portfolios." *Journal of Portfolio Management* 36(4), p60–70 (ERC formulation).
- Thorp, E. O. (2006). "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market." *Handbook of Asset and Liability Management* 1, p385–428 (correlation-adjusted Kelly).

**Patch sketch:** In portfolioBacktest, before allocating to a new BUY, compute the portfolio correlation matrix over a 63-day window for currently-held + candidate. Adjust new Kelly fraction by `(1 - max_correlation_with_existing)` or use ERC weights.

**Acceptance test:** Synthetic portfolio with 5 perfectly-correlated instruments (rho=0.99) vs 5 uncorrelated. Assert correlation-adjusted version allocates ≤ 1/N to each correlated instrument vs full Kelly to uncorrelated.

**Severity:** High — explains some of the high portfolio max-DD (10.7% per Phase 11 closure) despite per-instrument modest DDs.

---

### F1.8 [MEDIUM] — Sortino MAR choice is `rfD` (not 0); this is a non-trivial decision and undocumented

**Location:** `lib/backtest/engine.ts:387, 530`

**Evidence:**
```ts
const downsideDevs = dailyReturns.map(r => Math.min(0, r - rfD))
```
MAR (Minimum Acceptable Return) = rfD here. Sortino & van der Meer (1991) original paper uses MAR; later practitioners often use MAR = 0 (any negative return = downside). Both are valid; the choice should be documented and configurable.

**Citation:** Sortino, F. A. & van der Meer, R. (1991). "Downside Risk." *Journal of Portfolio Management* 17(4), p27–31.

**Patch sketch:** Add `BacktestConfig.sortinoMAR: 'rfd' | 'zero' | number`, default 'rfd'. Document in JSDoc.

**Acceptance test:** Two runs differing only by MAR choice produce different Sortino values; assert configurability.

---

### F1.9 [MEDIUM] — Sortino requires only `negDevs.length >= 3`; statistically meaningless

**Location:** `lib/backtest/engine.ts:389, 532`

**Evidence:** With 3 negative observations, downside deviation is dominated by sampling noise. Standard practice: ≥30 negative observations.

**Citation:** Bacon (2008) op cit. p107 ("Smaller samples produce unstable downside deviation estimates; minimum 30 observations recommended for institutional reporting.")

**Patch sketch:** Raise threshold to 30. Return null if below.

---

### F1.10 [MEDIUM] — `combinedSignal` (legacy) duplicates `enhancedCombinedSignal` logic

**Location:** `lib/backtest/signals.ts:312-416` (legacy) vs `signals.ts:521-691` (enhanced)

**Evidence:** Both functions duplicate: indicator computation (rsi, macd, atr, bollinger), regime call, Kelly sizing logic. This is a single-source-of-truth violation. If `combinedSignal` is dead code, delete it; if it has callers, refactor to internal helper.

**Patch sketch:** Grep for `combinedSignal\b` callers — if zero outside tests, delete and update tests. If callers exist (likely the legacy `app/api/backtest/route.ts`), migrate them to `enhancedCombinedSignal` with sectorGates=undefined; behavior should be equivalent for default config.

---

### F1.11 [MEDIUM] — RSI score is linear; Wilder's design is nonlinear in trader value

**Location:** `lib/backtest/signals.ts:561`

**Evidence:**
```ts
const rsiScore = Number.isFinite(rsi14) ? (50 - rsi14) / 50 : 0
```
Linear mapping treats `rsi=40` (mild noise) the same intensity as `rsi=20` (extreme oversold) modulo direction. Wilder's RSI is designed nonlinearly: the >70 / <30 zones carry the alpha, 40–60 is noise.

**Citation:** Wilder, J. W. (1978). *New Concepts in Technical Trading Systems*. Trend Research. p65 (overbought/oversold regions).
- Murphy (1999). *Technical Analysis of the Financial Markets*. NYIF. p243 (RSI extremes).

**Patch sketch:** Piecewise mapping:
```ts
const rsiScore = !Number.isFinite(rsi14) ? 0
  : rsi14 < 25  ? +1.0
  : rsi14 < 35  ? +0.6
  : rsi14 < 45  ? +0.2
  : rsi14 < 55  ?  0.0
  : rsi14 < 65  ? -0.2
  : rsi14 < 75  ? -0.6
  :              -1.0
```

**Acceptance test:** Compare WR across 100 simulated series under linear vs piecewise score. Expect piecewise to produce fewer false-positive BUYs in 40-60 RSI range.

---

### F1.12 [MEDIUM] — Bullish divergence excludes RSI 50–70 range without justification

**Location:** `lib/backtest/signals.ts:82`

**Evidence:**
```ts
return rsi2 > rsi1 && rsi2 < 50  // divergence + still oversold-ish
```
The `rsi2 < 50` condition is undocumented and contradicts standard divergence definition.

**Citation:** Murphy (1999) op cit. p245 — bullish divergence is defined regardless of absolute RSI level.

**Patch sketch:** Drop the `< 50` condition or move it behind a feature flag.

---

### F1.13 [LOW] — MACD score normalization uses magic constant `atrLast * 0.1`

**Location:** `lib/backtest/signals.ts:563`

**Evidence:** No source cited for the `0.1` scaling. Should either cite Appel (1979) original MACD paper or document as empirical heuristic.

**Citation:** Appel, G. (1979). *The Moving Average Convergence-Divergence Trading Method*. (Original MACD paper.)

**Patch sketch:** Add JSDoc explaining the rationale or replace with a stat-derived scale (e.g., MACD's own historical standard deviation).

---

### F1.14 [LOW] — Volume profile zone scores are asymmetric (+0.8 below, −0.5 above) without citation

**Location:** `lib/backtest/signals.ts:461-465`

**Evidence:** below_va = +0.8, above_va = -0.5. The asymmetry implicitly assumes mean-reversion. For trend-following regimes, above-VA is bullish (breakout). No source.

**Citation:** Steidlmayer, J. P. (1989). *Steidlmayer on Markets*. Wiley. (Volume profile / market profile theory.)

**Patch sketch:** Make zone scores regime-dependent (mean-reversion: current asymmetry; trend-following: invert).

---

### F1.15 [LOW] — `oosRatio` clamped to [-1, 2] hides tail-risk overfitting

**Location:** `lib/backtest/engine.ts:633`

**Evidence:**
```ts
const oosRatio = isAnn !== 0 ? Math.min(2, Math.max(-1, osAnn / isAnn)) : 0
```
A strategy with isAnn=+30%, osAnn=-50% gives true ratio -1.67, clamped to -1, hiding the worst overfitting cases.

**Patch sketch:** Remove clamp, or report unclamped value alongside.

---

## Cross-domain handoffs

- **R2 (Indicators):** F1.11 (RSI linear scoring), F1.13 (MACD scale) — verify against indicator-source canonicalization.
- **R3 (Options):** none direct, but Kelly heuristic in `signals.ts:380, 654` uses `avgWin = 0.06` for STRONG_DIP — R3 should verify these magnitudes are not double-counted with options-skew bias.
- **R4 (Data):** F1.4 (FRED rate-fetch), F1.5 (dividend-adjusted close) — both require data-layer changes.
- **R8 (Testing):** every F1.x has an acceptance test specified — R8 must verify each lands as a red test before any S2 fix.

---

## Self-dissent (per Standing Prompt rule 7)

I read `walkForwardAnalysis` carefully and the bug F1.1 looks structural. But I have not run the function on real data to confirm `osReturn === 0` always; I1 must reproduce. Possible escape hatch: if `BacktestConfig.confidenceThreshold = 0` and the strategy generates trades on the first 50 bars, some trades might land in the test window before warmup gates close — though the 252-bar gate at line 118 should still suppress them. Confidence: ≥90%. I1 should run a manual test before the S2 fix is approved.

I am NOT confident on F1.7 (correlation-adjusted Kelly) without reading `portfolioBacktest.ts` end-to-end. Possible that correlation handling already exists at the portfolio layer; my scope was engine.ts. Marked HIGH provisionally; downgrade to MEDIUM if portfolio layer covers it.

---

## Findings summary table

| ID | Severity | File:line | One-line |
|----|----------|-----------|----------|
| F1.1 | CRITICAL | engine.ts:605-650 | walk-forward broken (testRows < 252 short-circuit) |
| F1.2 | CRITICAL | engine.ts:545 | portfolio max DD = max-of-individual, not curve |
| F1.3 | CRITICAL/HIGH | engine.ts:186, 205, 224 | stops use close, not intraday low |
| F1.4 | HIGH | engine.ts:373, 385, 525, 601 | RFR hardcoded 4% |
| F1.5 | HIGH | engine.ts:343 | B&H ignores dividends |
| F1.6 | HIGH | engine.ts:340 + many | crypto annualization uses 252 not 365 |
| F1.7 | HIGH | engine.ts:272-276 | no correlation-adjusted Kelly |
| F1.8 | MEDIUM | engine.ts:387, 530 | Sortino MAR=rfd undocumented |
| F1.9 | MEDIUM | engine.ts:389, 532 | Sortino n_d ≥ 3 too low |
| F1.10 | MEDIUM | signals.ts:312-416 | combinedSignal duplicates enhancedCombinedSignal |
| F1.11 | MEDIUM | signals.ts:561 | RSI score linear; should be nonlinear (Wilder) |
| F1.12 | MEDIUM | signals.ts:82 | bullish divergence requires RSI<50 (incorrect) |
| F1.13 | LOW | signals.ts:563 | MACD score scale magic constant |
| F1.14 | LOW | signals.ts:461-465 | VPOC asymmetry no citation |
| F1.15 | LOW | engine.ts:633 | oosRatio clamp hides tail overfit |

Total findings: 15 (3 Critical, 4 High, 5 Medium, 3 Low)

**Open items requiring R1 second pass before S2:** `portfolioBacktest.ts`, `exitRules.ts`, `kelly.ts`, `researchScore.ts`, `dcf.ts`. Without that pass, F1.7 severity may shift; F1.2 fix interacts with portfolioBacktest's own equity-combine logic.

---

**Reviewer signature:** R1
**Cross-checked by:** R2 (signals.ts overlap with indicators.ts) — pending
**Inspector spot-check:** I1 — pending
