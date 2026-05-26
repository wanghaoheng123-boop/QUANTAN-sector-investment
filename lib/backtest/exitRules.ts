/**
 * Enhanced exit rules for the backtest engine.
 *
 * Institutional-grade exits beyond simple stop-loss:
 *   1. Time-based: forced exit after maxHoldDays
 *   2. Profit-taking: exit 50% of position at target gain, trail rest
 *   3. ATR% spike exit: exit if realized volatility spikes > 3× entry ATR%
 *   4. Signal-based: exit on SELL signal from enhancedCombinedSignal
 *   5. Maximum adverse excursion (MAE): exit if single-day loss > 2× ATR
 *
 * These rules are applied in the portfolio backtest engine (portfolioBacktest.ts)
 * and optionally in the per-instrument engine.
 */

import type { OhlcBar } from '@/lib/quant/indicators'
import { atrArray } from '@/lib/quant/indicators'

export interface ExitConfig {
  /** Max calendar trading days to hold a position (default 20) */
  maxHoldDays: number
  /** Exit 50% of position when gain exceeds this (e.g. 0.08 = 8%) */
  profitTakePct: number
  /** After partial profit-take, trail remainder with this stop below entry+profitTake */
  trailingStopPct: number
  /** Exit full position if current ATR% > entryATR% * this multiple */
  panicExitAtrMultiple: number
  /** Use signal-based exits (SELL signal from enhanced signal) */
  signalBasedExit: boolean
  /** ATR-based initial stop-loss multiplier */
  atrStopMultiplier: number
}

export const DEFAULT_EXIT_CONFIG: ExitConfig = {
  maxHoldDays: 20,
  profitTakePct: 0.08,
  trailingStopPct: 0.05,
  panicExitAtrMultiple: 3.0,
  signalBasedExit: true,
  atrStopMultiplier: 1.5,
}

export type ExitReason =
  | 'signal'          // enhancedCombinedSignal returned SELL
  | 'stop_loss'       // hit ATR-based stop loss
  | 'time_exit'       // maxHoldDays reached
  | 'profit_target'   // hit profitTakePct
  | 'panic_exit'      // ATR% spiked (volatility expansion)
  | 'max_drawdown'    // portfolio-level circuit breaker
  | 'end_of_data'     // forced close at end of backtest period

export interface OpenPosition {
  ticker: string
  sector: string
  entryIdx: number
  entryPrice: number
  entryDate: string
  entryATRPct: number  // ATR% at entry (for panic exit comparison)
  stopLossPrice: number
  initialShares: number
  currentShares: number
  highestPrice: number  // for trailing stop
  partialExitDone: boolean
  confidence: number
  reason: string
  // F1.19 (Phase 13 S2): forward-filled last observed close. Used by the
  // portfolio engine to mark positions to market on bars where this ticker
  // has missing data (vendor outage, halts) instead of falling back to
  // entry price (which silently understates losses or overstates gains).
  lastKnownClose?: number
}

/**
 * Compute ATR-adaptive initial stop loss price.
 *
 * Stop = entry * (1 - max(floor, min(ceiling, ATR% * multiplier)))
 * Floors and ceilings prevent unreasonably tight/wide stops.
 */
export function atrAdaptiveStop(
  entryPrice: number,
  bars: OhlcBar[],
  multiplier = 1.5,
  floor = 0.05,
  ceiling = 0.15,
): { stopLossPrice: number; atrPct: number } {
  // F1.22: exclude the still-forming entry bar — ATR uses only completed bars.
  const completedBars = bars.length > 1 ? bars.slice(0, -1) : bars
  const atrVals = atrArray(completedBars, 14)
  const lastATR = atrVals[atrVals.length - 1]
  const atrPct = Number.isFinite(lastATR) && entryPrice > 0 ? lastATR / entryPrice : 0.05

  const stopPct = Math.min(ceiling, Math.max(floor, atrPct * multiplier))
  return {
    stopLossPrice: entryPrice * (1 - stopPct),
    atrPct,
  }
}

/**
 * Bar with O/H/L/C used for intraday-aware exit evaluation.
 * `low` and `high` are required for the F1.3 stop-loss / profit-target fix.
 */
export interface ExitBar {
  open: number
  high: number
  low: number
  close: number
}

/**
 * Canonical primitive: given a bar and a price threshold, decide whether
 * a stop/target was hit intraday and the resulting fill price.
 *
 * This factors out the (previously duplicated) logic that lived in both
 * `lib/backtest/engine.ts` and `lib/backtest/exitRules.ts`. The two paths
 * had the same close-only bug fixed in F1.3, and the same fix had to be
 * applied twice. SSOT eliminates that future-regression hazard.
 *
 * Semantics:
 *   • side='long', kind='stop':   triggered when bar.low  <= level.
 *                                 fill = level, unless bar.open <= level
 *                                 (gap-down → fill at open, worse than level).
 *   • side='long', kind='target': triggered when bar.high >= level.
 *                                 fill = level, unless bar.open >= level
 *                                 (gap-up → fill at open, better than level).
 *   • side='short', kind='stop':  triggered when bar.high >= level.
 *                                 fill = level, unless bar.open >= level
 *                                 (gap-up → fill at open, worse than level).
 *   • side='short', kind='target': triggered when bar.low  <= level.
 *                                 fill = level, unless bar.open <= level
 *                                 (gap-down → fill at open, better than level).
 *
 * Returns null if no hit. Otherwise returns the realistic fill price.
 *
 * Citation: Pardo (2008) ch. 7 — intraday breach modelling is required to
 *           avoid systematic optimism in backtest equity-curve estimates.
 */
export type ThresholdSide = 'long' | 'short'
export type ThresholdKind = 'stop' | 'target'

export function evaluateStopHit(
  bar: ExitBar,
  level: number,
  side: ThresholdSide,
  kind: ThresholdKind,
): number | null {
  if (!Number.isFinite(level) || level <= 0) return null
  if (!Number.isFinite(bar.low) || !Number.isFinite(bar.high) || !Number.isFinite(bar.open)) return null

  // For (long stop) and (short target): triggered when bar.low <= level.
  // For (long target) and (short stop): triggered when bar.high >= level.
  const triggerOnLow = (side === 'long' && kind === 'stop') || (side === 'short' && kind === 'target')
  const triggered = triggerOnLow ? bar.low <= level : bar.high >= level
  if (!triggered) return null

  // Fill rules:
  //   triggerOnLow + bar.open <= level → fill at open (gap through downward)
  //   !triggerOnLow + bar.open >= level → fill at open (gap through upward)
  //   else → fill exactly at level (limit-order assumption)
  if (triggerOnLow) {
    return bar.open <= level ? bar.open : level
  }
  return bar.open >= level ? bar.open : level
}

/**
 * Determine whether to exit a position at the current bar.
 *
 * F1.3 (Phase 13 S2) — intraday-aware exits:
 *   Previous implementation compared all price thresholds (stop, profit
 *   target, trailing stop) against the bar's close. That under-reports
 *   stop hits: when bar.low pierces the stop but bar.close recovers
 *   above it, the position is held intraday at deep loss yet the engine
 *   sees no exit. Conversely it under-reports profit-target hits when
 *   bar.high reaches target but bar.close pulls back below.
 *
 *   The corrected semantics:
 *     - Long stop:    triggered when bar.low  <= stop
 *                     fill = min(stop, bar.open) — gap-down opens fill at open
 *     - Profit target: triggered when bar.high >= target
 *                     fill = max(target, bar.open) — gap-up opens fill at open
 *     - Trailing stop: same as long-stop with trail = highestPrice × (1-tr)
 *   Close-based exits (signal, panic, time) remain at bar.close — those
 *   represent end-of-day decisions, not intraday breach.
 *
 * Caller passes the current bar plus the close (kept for back-compat
 * and because close drives signal/panic/time paths). Returns exit reason
 * and effective fill price, or null if no exit triggers.
 *
 * Citation: Pardo, R. (2008). *The Evaluation and Optimization of Trading
 *           Strategies* (2nd ed.), Wiley, ch. 7 — backtests must model
 *           intraday breach of stops to avoid systematic optimism in
 *           win-rate and drawdown estimates.
 */
export function checkExitConditions(
  position: OpenPosition,
  currentIdx: number,
  currentPrice: number,
  currentDate: string,
  currentATRPct: number,
  signalAction: 'BUY' | 'HOLD' | 'SELL',
  config: ExitConfig,
  /**
   * Current bar OHLC. Optional for back-compat: when omitted, falls back
   * to close-only behaviour (the legacy contract). Production callers
   * should always supply this; tests-only paths may omit.
   */
  currentBar?: ExitBar,
): { shouldExit: boolean; reason: ExitReason; exitPrice: number; isPartial: boolean; partialFraction: number } | null {

  // For back-compat, synthesise a bar from close-only inputs when none provided.
  const bar: ExitBar = currentBar ?? {
    open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice,
  }

  // 1. Stop loss (highest priority — checked intraday on bar.low via SSOT primitive).
  const stopFill = evaluateStopHit(bar, position.stopLossPrice, 'long', 'stop')
  if (stopFill != null) {
    return { shouldExit: true, reason: 'stop_loss', exitPrice: stopFill, isPartial: false, partialFraction: 1.0 }
  }

  // 2. ATR panic exit (volatility expansion — close-based, daily ATR is daily).
  if (config.panicExitAtrMultiple > 0 && position.entryATRPct > 0) {
    if (currentATRPct > position.entryATRPct * config.panicExitAtrMultiple) {
      return { shouldExit: true, reason: 'panic_exit', exitPrice: currentPrice, isPartial: false, partialFraction: 1.0 }
    }
  }

  // 3. Signal-based exit (end-of-day decision — close-based).
  if (config.signalBasedExit && signalAction === 'SELL') {
    return { shouldExit: true, reason: 'signal', exitPrice: currentPrice, isPartial: false, partialFraction: 1.0 }
  }

  // 4. Profit-taking (partial exit at target — checked intraday on bar.high).
  if (!position.partialExitDone) {
    const target = position.entryPrice * (1 + config.profitTakePct)
    const targetFill = evaluateStopHit(bar, target, 'long', 'target')
    if (targetFill != null) {
      return { shouldExit: true, reason: 'profit_target', exitPrice: targetFill, isPartial: true, partialFraction: 0.50 }
    }
  }

  // 5. Trailing stop (after partial exit — checked intraday on bar.low).
  if (position.partialExitDone) {
    const trailLevel = position.highestPrice * (1 - config.trailingStopPct)
    const trailFill = evaluateStopHit(bar, trailLevel, 'long', 'stop')
    if (trailFill != null) {
      return { shouldExit: true, reason: 'stop_loss', exitPrice: trailFill, isPartial: false, partialFraction: 1.0 }
    }
  }

  // 6. Time-based exit (forced close — close-based).
  const holdDays = currentIdx - position.entryIdx
  if (holdDays >= config.maxHoldDays) {
    return { shouldExit: true, reason: 'time_exit', exitPrice: currentPrice, isPartial: false, partialFraction: 1.0 }
  }

  return null
}

/**
 * Update a position's trailing indicators.
 * Call this every bar even when not exiting.
 */
export function updatePosition(position: OpenPosition, currentPrice: number): OpenPosition {
  if (currentPrice > position.highestPrice) {
    return { ...position, highestPrice: currentPrice }
  }
  return position
}

/**
 * Compute exit statistics across closed trades.
 */
export interface ExitStats {
  totalExits: number
  byReason: Record<ExitReason, number>
  avgPnLByReason: Record<ExitReason, number>
  stopLossPct: number    // fraction of exits that were stop losses
  profitTakePct: number  // fraction that were profit takes
  timeExitPct: number    // fraction that were time exits
}

export function computeExitStats(
  trades: Array<{ exitReason: ExitReason; pnlPct: number }>,
): ExitStats {
  const byReason: Record<ExitReason, number> = {
    signal: 0, stop_loss: 0, time_exit: 0,
    profit_target: 0, panic_exit: 0, max_drawdown: 0, end_of_data: 0,
  }
  const pnlByReason: Record<ExitReason, number[]> = {
    signal: [], stop_loss: [], time_exit: [],
    profit_target: [], panic_exit: [], max_drawdown: [], end_of_data: [],
  }

  for (const trade of trades) {
    byReason[trade.exitReason]++
    pnlByReason[trade.exitReason].push(trade.pnlPct)
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, x) => s + x, 0) / arr.length : 0
  const avgPnLByReason = Object.fromEntries(
    Object.entries(pnlByReason).map(([k, v]) => [k, avg(v)]),
  ) as Record<ExitReason, number>

  const n = trades.length
  return {
    totalExits: n,
    byReason,
    avgPnLByReason,
    stopLossPct: n > 0 ? byReason.stop_loss / n : 0,
    profitTakePct: n > 0 ? byReason.profit_target / n : 0,
    timeExitPct: n > 0 ? byReason.time_exit / n : 0,
  }
}
