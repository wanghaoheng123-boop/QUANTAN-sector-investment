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
 * TODO Phase 13 S3: replace with `getRiskFreeRate(periodStart, periodEnd)`
 * pulling DGS3MO from FRED for the actual backtest period.
 */
export const BACKTEST_RFR_ANNUAL = 0.04

/**
 * Risk-free rate for Black-Scholes option pricing (annualized,
 * continuously compounded).  Used by `lib/options/chain.ts:fetchOptionsChain`.
 *
 * TODO Phase 13 S3: replace with tenor-matched rate from FRED's
 * Treasury yield curve (DGS3MO for ≤90d, DGS1 for ≤1y, DGS2 for ≤2y).
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
