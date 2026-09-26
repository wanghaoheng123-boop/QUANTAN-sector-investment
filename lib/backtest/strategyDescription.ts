/**
 * Q-105 — what the /backtest surfaces tell the user the engine does, derived
 * from the constants the engine trades on.
 *
 * Until this module, three surfaces described a strategy `backtestInstrument`
 * had not run since 2026-07-11: an ATR-adaptive stop-loss and a trailing stop
 * (retired in D2), "SELL → exit full position" (retired in D4), tiered Half-Kelly
 * sizing and "≥2 confirms" (the research-only enhanced path; production runs
 * the regime-only path), and a 55% confidence minimum (the default is 50, and
 * the production path never reads it). None of them mentioned the time exit —
 * the only position-level exit the engine actually has. Every number a user
 * read beside those rules (win rate, drawdown, return) was produced by a
 * different rulebook from the one printed next to it.
 *
 * Scope: this describes `backtestInstrument` (`core.ts`) on its production
 * default path — the engine behind `/api/backtest`. It does NOT describe
 * `portfolioBacktest.ts`, which still carries ATR-stop machinery behind its
 * `exit` config. If `QUANTAN_USE_ENHANCED_SIGNAL` is ever switched on in
 * production, the BUY, HOLD and sizing rows below stop being true; that is a
 * named residual, not a solved problem.
 *
 * Imports only leaf modules: this is rendered by client components.
 */

import { DEFAULT_CONFIG } from './signalTypes'
import {
  DEFAULT_EXECUTION_COSTS,
  costBpsPerSide,
  roundTripCostPct,
} from './executionModel'
import {
  ENGINE_MAX_HOLD_DAYS,
  MIN_SMA200_SLOPE,
  NEAR_SMA200_PCT,
  REGIME_PATH_POSITION_FRACTION,
} from './strategyConstants'

/** A fraction as a percentage string without float noise: 0.15 → "15". */
export function pct(fraction: number): string {
  return String(Math.round(fraction * 10_000) / 100)
}

/**
 * The production default is half-Kelly (`DEFAULT_CONFIG.halfKelly`), which on
 * the regime-only path selects a FIXED fraction — not a Kelly computation.
 */
const POSITION_FRACTION = DEFAULT_CONFIG.halfKelly
  ? REGIME_PATH_POSITION_FRACTION.halfKelly
  : REGIME_PATH_POSITION_FRACTION.fullKelly

/**
 * UX-14. The Transaction Costs row was the hardcoded string
 * "~11bps round-trip (IBKR: $0.005/sh + 0.05% spread + 0.5bps slippage)".
 * 11 bps is the PER-SIDE cost, so that row halved the modelled friction — and
 * it contradicted app/backtest/page.tsx, which states "≈22 bps (11 bps/side)"
 * correctly, on the same screen. The itemisation was wrong too (0.5 bps
 * slippage vs the model's 2).
 *
 * Derived from lib/backtest/executionModel.ts — the SSOT — so the copy cannot
 * drift from the model again. No constant changed; only the sentence that
 * describes them.
 */
export const TX_COST_RULE =
  `${costBpsPerSide()} bps per side ` +
  `(${DEFAULT_EXECUTION_COSTS.spreadBpsPerSide} bps spread + ` +
  `${DEFAULT_EXECUTION_COSTS.slippageBpsPerSide} bps slippage + ` +
  `${DEFAULT_EXECUTION_COSTS.commissionBpsPerSide} bps commission/fees), ` +
  `charged at entry AND exit — ` +
  `≈${Math.round(roundTripCostPct() * 10_000)} bps round-trip.`

/** The Strategy Rules grid on the /backtest Overview tab. */
export const ENGINE_RULES: ReadonlyArray<readonly [string, string]> = [
  ['Signal Path',
    'Production runs the regime-only classifier (resolveBacktestSignal). The weighted-confluence ' +
    '"enhanced" path is switched off in production and used for research only.'],
  ['BUY Signal',
    `Close below its 200-day SMA, with that SMA up more than ${pct(MIN_SMA200_SLOPE)}% over the last ` +
    `20 bars, and price no more than ${NEAR_SMA200_PCT}% below the SMA at some bar of those 20. ` +
    'Observed at the close, filled at the next open. One position per instrument at a time.'],
  ['HOLD',
    'No new position otherwise: price at or above the 200-day SMA, or a dip that fails the slope or ' +
    'proximity test. RSI changes the confidence shown on a signal, but the production path applies no ' +
    'confidence threshold.'],
  ['SELL Signal',
    'Deeper dips that fail the slope or proximity test are labelled SELL. The label is shown for ' +
    'information only and does not close positions (retired as an exit on 2026-07-11).'],
  ['Exit',
    `Time exit only: a position closes ${ENGINE_MAX_HOLD_DAYS} daily bars after its fill, at the next open. ` +
    'There is no stop-loss, no trailing stop and no profit target (all retired on 2026-07-11). ' +
    'A position still open when the data ends is closed at the final close.'],
  ['Drawdown Breaker',
    `If this instrument's equity falls ${pct(DEFAULT_CONFIG.maxDrawdownCap)}% or more from its peak, ` +
    'the open position closes at the next open.'],
  ['Position Sizing',
    `A fixed ${pct(POSITION_FRACTION)}% of capital per BUY. This is not a Kelly calculation; only the ` +
    'research-only enhanced path computes one.'],
  ['Transaction Costs', TX_COST_RULE],
] as const

/** The one-line strategy summary under the /backtest header. */
export const ENGINE_SUMMARY: ReadonlyArray<readonly [string, string]> = [
  ['Strategy', 'Regime dip-buy vs 200-day SMA (resolveBacktestSignal; enhanced path is research-only)'],
  ['Capital', `$${DEFAULT_CONFIG.initialCapital.toLocaleString('en-US')} per instrument`],
  ['Exit', `${ENGINE_MAX_HOLD_DAYS}-bar time exit, no stop-loss`],
  ['Position size', `fixed ${pct(POSITION_FRACTION)}% of capital`],
  ['Drawdown breaker', `${pct(DEFAULT_CONFIG.maxDrawdownCap)}% per instrument`],
] as const

/** The strategy clause in the landing page's backtest call-to-action. */
export const ENGINE_ONE_LINE =
  'Regime dip-buy vs 200SMA (SSOT: resolveBacktestSignal), ' +
  `a ${ENGINE_MAX_HOLD_DAYS}-bar time exit with no stop-loss, ` +
  `and a fixed ${pct(POSITION_FRACTION)}% position size`
