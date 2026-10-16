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

import { SECTORS } from '@/lib/sectors'
import { DEFAULT_CONFIG } from './signalTypes'
import {
  DEFAULT_EXECUTION_COSTS,
  costBpsPerSide,
  roundTripCostPct,
} from './executionModel'
import {
  BACKTEST_WARMUP_BARS,
  ENGINE_MAX_HOLD_DAYS,
  FIRST_DIP_FLOOR_PCT,
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
  ? REGIME_PATH_POSITION_FRACTION.half
  : REGIME_PATH_POSITION_FRACTION.full

/**
 * The first allocation, on the starting capital. `core.ts` rounds shares DOWN,
 * so an instrument priced above this cannot open its first position at all —
 * Q-105 red-team R1: BTC skipped all 167 regime BUY bars this way, while the
 * copy said "a fixed 15% per BUY".
 */
const FIRST_ALLOCATION = DEFAULT_CONFIG.initialCapital * POSITION_FRACTION

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
    `No new position otherwise: price at or above the 200-day SMA, or a dip of up to ${FIRST_DIP_FLOOR_PCT}% ` +
    'that fails the slope or proximity test. Confidence is a fixed label per zone and outcome (RSI below 35 ' +
    'raises it only on a buyable mild dip); the production path applies no confidence threshold.'],
  ['SELL Signal',
    `Dips deeper than ${FIRST_DIP_FLOOR_PCT}% that fail the slope or proximity test are labelled SELL ` +
    '(HOLD while the SMA slope cannot yet be measured). The label is shown for information only and does ' +
    'not close positions (retired as an exit on 2026-07-11).'],
  ['Exit',
    `Time exit only: once ${ENGINE_MAX_HOLD_DAYS} daily bars have passed since a position's fill, it closes at the next open. ` +
    'There is no stop-loss, no trailing stop and no profit target (all retired on 2026-07-11). ' +
    'A position still open when the data ends is closed at the final close.'],
  ['Drawdown Breaker',
    `If this instrument's equity falls ${pct(DEFAULT_CONFIG.maxDrawdownCap)}% or more from its peak, ` +
    'the open position closes at the next open. The peak then resets to the equity after that exit, so ' +
    'later drawdowns are measured from there (or from any new high after it), not from the old peak. ' +
    'There is no cooldown: the next BUY can open on the following bar.'],
  ['Position Sizing',
    `${pct(POSITION_FRACTION)}% of the instrument's cash at entry, rounded down to whole shares. A BUY whose ` +
    'allocation cannot buy one share is skipped, so an instrument priced above ' +
    `$${FIRST_ALLOCATION.toLocaleString('en-US')} cannot open its first position. An instrument whose every BUY ` +
    'is unaffordable this way is excluded from the portfolio figures and named on the page; one with no BUY ' +
    'signal at all stays in, because holding cash is a strategy result. This is not a Kelly ' +
    'calculation; only the research-only enhanced path computes one.'],
  ['Transaction Costs', TX_COST_RULE],
] as const

/** The one-line strategy summary under the /backtest header. */
export const ENGINE_SUMMARY: ReadonlyArray<readonly [string, string]> = [
  ['Strategy', 'Regime dip-buy vs 200-day SMA (resolveBacktestSignal; enhanced path is research-only)'],
  ['Capital', `$${DEFAULT_CONFIG.initialCapital.toLocaleString('en-US')} per instrument`],
  ['Exit', `${ENGINE_MAX_HOLD_DAYS}-bar time exit, no stop-loss`],
  ['Position size', `${pct(POSITION_FRACTION)}% of cash, whole shares`],
  ['Drawdown breaker', `${pct(DEFAULT_CONFIG.maxDrawdownCap)}% per instrument`],
] as const

// ENGINE_ONE_LINE (the landing CTA's rule clause) was removed by the Q-133
// red-team (F5): the landing page is static and cannot know which signal path
// ran, so it stated the regime-only sizing unconditionally. The rules now live
// only on /backtest, gated by the response's signalPath (Q-134).

/**
 * Q-139 — the backtest universe, COUNTED from the list `/api/backtest`
 * iterates (every sector's topHoldings, then BTC), never written down. The
 * copy said "56 instruments" in four places and "56 currently-listed S&P
 * large-caps plus BTC" in a fifth: 55 stocks plus BTC is 56, so one of the two
 * phrasings was always wrong.
 */
export const UNIVERSE_STOCK_COUNT = SECTORS.reduce((n, s) => n + s.topHoldings.length, 0)
export const UNIVERSE_SECTOR_COUNT = SECTORS.length

/**
 * Q-139 — what the backtest is, for the landing page. It was "5Y walk-forward
 * backtest": walk-forward means re-fitting on rolling windows and this engine
 * fits nothing; and the history is no longer a fixed five years since the
 * window start was pinned (Q-102).
 */
export const BACKTEST_SCOPE_LINE =
  `Single-pass backtest with no look-ahead over ${UNIVERSE_STOCK_COUNT} large-cap stocks in ` +
  `${UNIVERSE_SECTOR_COUNT} GICS sectors plus BTC, on daily history after a ${BACKTEST_WARMUP_BARS}-bar warm-up`

/**
 * Q-134 — which signal path the rules on this page describe, and which one a
 * response actually ran. Every rule above describes the regime-only path,
 * because production runs it by default; but `QUANTAN_USE_ENHANCED_SIGNAL=1`
 * switches the engine to the enhanced path with every test green, and the BUY,
 * HOLD and sizing rows would then be false. `/api/backtest` now says which path
 * produced its numbers, and the page shows these rules only when they match.
 */
export type SignalPath = 'regime-only' | 'enhanced'
export const DESCRIBED_SIGNAL_PATH: SignalPath = 'regime-only'

/** The rules to render for a response, or null when they would not describe it. */
export function rulesForPath(path: SignalPath | undefined): typeof ENGINE_RULES | null {
  return path === DESCRIBED_SIGNAL_PATH ? ENGINE_RULES : null
}

/** What to say instead of rules that do not apply. */
export function rulesMismatchNote(path: SignalPath | undefined): string {
  return path === 'enhanced'
    ? 'These results come from the research-only enhanced signal path, so the regime-only rules this page ' +
      'documents do not describe them. See lib/backtest/signals.ts (enhancedCombinedSignal) for its rules.'
    : 'This response does not say which signal path produced it, so no rule set is shown as describing it.'
}
