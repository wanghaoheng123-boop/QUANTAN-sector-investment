/**
 * Canonical numerical constants used across the quant layer.
 *
 * Phase 13 S2 (F1.4 partial fix): Risk-free rates were hardcoded at 9
 * separate call sites with two different values (0.04 in the backtest
 * layer, 0.0525 in options pricing). This file centralizes them so the
 * eventual migration to a FRED-backed `getRiskFreeRate()` becomes a
 * single-line change.
 *
 * Reference rates:
 *   • US 3-Month Treasury (DGS3MO) — typical short-dated options input
 *   • US 1-Year Treasury (DGS1)    — multi-year backtest average proxy
 *   • Federal Funds upper bound    — short-rate proxy (~5.25% as of mid-2024)
 *
 * Choosing a single value across a 5Y backtest:
 *   2021: ~0.05%, 2022: ~2.5%, 2023: ~5.0%, 2024: ~5.25%, 2025: ~4.0%
 *   Geometric mean ≈ 2.8%; arithmetic mean ≈ 3.4%. We use 4.0% as a
 *   conservative round number near the recent regime; downstream Sharpe
 *   is mildly sensitive to this choice (±50bps shifts Sharpe by ~0.05).
 *
 * For options pricing on short-dated contracts, the prevailing spot rate
 * matters more than a multi-year mean. We retain the higher 5.25% for
 * options to reflect 2024-2025 short-rate conditions.
 */

/**
 * Risk-free rate for backtest Sharpe/Sortino calculations (annualized).
 * Used by `lib/backtest/engine.ts` and `lib/backtest/portfolioBacktest.ts`.
 *
 * Phase 14 (Q1-H-2): The hard-coded 0.04 (4%) value was stale relative to
 * the prevailing 2026 short-rate regime (US 10Y ~4.5%, 3M T-bill ~4.5%).
 * Sharpe is sensitive to RFR (~50bps shifts Sharpe by ~0.05), so a stale
 * value persistently understates risk-adjusted return. Bumped default to
 * 0.045 (4.5%) and exposed an env override so deployments can pin a
 * different value without code change.
 *
 * Phase 15 Q-052-NEW (LANDED 2026-05-24): the tenor-matched FRED helper
 * `getRiskFreeRate(tenorDays)` now lives in `lib/quant/riskFreeRate.ts` and
 * is wired through `engine.ts`, `portfolioBacktest.ts`, and `chain.ts`.
 * Production activation requires `QUANTAN_FRED_PREWARM=1` in the deploy env
 * (off by default for test/CI/benchmark reproducibility). When unset, the
 * sync accessor falls back to BACKTEST_RFR_ANNUAL below — so this constant
 * still functions as the authoritative fallback.
 *
 * Override via env: BACKTEST_RFR_ANNUAL=0.052 (decimal, not percent).
 */
const RFR_ANNUAL_OVERRIDE = (() => {
  const raw = process.env.BACKTEST_RFR_ANNUAL
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0.2) {
    // Reject obviously invalid values (negative, or > 20% — likely a
    // percent-not-decimal mistake). Fall back to default silently;
    // logging here would spam at module-init across every route.
    return null
  }
  return parsed
})()

export const BACKTEST_RFR_ANNUAL = RFR_ANNUAL_OVERRIDE ?? 0.045

/**
 * Risk-free rate for Black-Scholes option pricing (annualized,
 * continuously compounded). Used by `lib/options/chain.ts:fetchOptionsChain`
 * as the FALLBACK when the FRED-backed `getRiskFreeRateSync(daysToExpiry)`
 * has a cold cache (Phase 15 Q-052-NEW LANDED 2026-05-24).
 *
 * Tenor routing (per `lib/quant/riskFreeRate.ts:SERIES_BY_TENOR`):
 *   ≤90d   → DGS3MO   (fallback = OPTIONS_RFR_ANNUAL, this constant)
 *   ≤365d  → DGS1     (fallback = BACKTEST_RFR_ANNUAL above)
 *   ≤730d  → DGS2     (fallback = BACKTEST_RFR_ANNUAL above)
 *    >730d → DGS10    (fallback = BACKTEST_RFR_ANNUAL above)
 *
 * Set `QUANTAN_FRED_PREWARM=1` in production to fetch the real rates at
 * module init. When unset (tests, CI, canonical benchmark), this constant
 * is what the options pricer uses.
 */
export const OPTIONS_RFR_ANNUAL = 0.0525

/**
 * Default Minimum Acceptable Return (MAR) for Sortino ratio.
 *
 * Sortino & van der Meer (1991) used MAR = risk-free rate; modern
 * practitioners often use MAR = 0 (any negative return = downside).
 * The canonical `sortinoRatio()` accepts both (configurable via param);
 * this is the documented default.
 */
export const DEFAULT_SORTINO_MAR_DAILY = 0

/**
 * Standard equities trading-day count per year (for annualization of
 * Sharpe/Sortino/vol). Use 365 for crypto via per-instrument override.
 */
export const TRADING_DAYS_EQUITIES = 252
export const TRADING_DAYS_CRYPTO = 365

/**
 * Day-count basis for options time-to-expiry (calendar days).
 * Hull (2017) op cit. p385 uses calendar; some venues use trading days
 * (252) for theta annualization. The codebase uses calendar throughout.
 */
export const OPTIONS_DAYS_PER_YEAR = 365

/**
 * Standard transaction-cost assumption per side (basis points).
 * Captures: ~5 bps spread (large-cap US equity) + ~5 bps slippage +
 * ~1 bp commission. Round-trip = 22 bps. Calibrate higher (15-30 bps
 * per side) for less-liquid instruments.
 */
export const DEFAULT_TX_COST_BPS_PER_SIDE = 11
