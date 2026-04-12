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
  const atrVals = atrArray(bars, 14)
  const lastATR = atrVals[atrVals.length - 1]
  const atrPct = Number.isFinite(lastATR) && entryPrice > 0 ? lastATR / entryPrice : 0.05

  const stopPct = Math.min(ceiling, Math.max(floor, atrPct * multiplier))
  return {
    stopLossPrice: entryPrice * (1 - stopPct),
    atrPct,
  }
}

/**
 * Determine whether to exit a position at the current bar.
 *
 * Returns exit reason and effective exit price, or null if no exit yet.
 */
export function checkExitConditions(
  position: OpenPosition,
  currentIdx: number,
  currentPrice: number,
  currentDate: string,
  currentATRPct: number,
  signalAction: 'BUY' | 'HOLD' | 'SELL',
  config: ExitConfig,
): { shouldExit: boolean; reason: ExitReason; exitPrice: number; isPartial: boolean; partialFraction: number } | null {

  // 1. Stop loss (highest priority)
  if (currentPrice <= position.stopLossPrice) {
    return { shouldExit: true, reason: 'stop_loss', exitPrice: currentPrice, isPartial: false, partialFraction: 1.0 }
  }

  // 2. ATR panic exit (volatility expansion — something is wrong)
  if (config.panicExitAtrMultiple > 0 && position.entryATRPct > 0) {
    if (currentATRPct > position.entryATRPct * config.panicExitAtrMultiple) {
      return { shouldExit: true, reason: 'panic_exit', exitPrice: currentPrice, isPartial: false, partialFraction: 1.0 }
    }
  }

  // 3. Signal-based exit
  if (config.signalBasedExit && signalAction === 'SELL') {
    return { shouldExit: true, reason: 'signal', exitPrice: currentPrice, isPartial: false, partialFraction: 1.0 }
  }

  // 4. Profit-taking (partial exit at target)
  const unrealizedPct = (currentPrice - position.entryPrice) / position.entryPrice
  if (!position.partialExitDone && unrealizedPct >= config.profitTakePct) {
    return { shouldExit: true, reason: 'profit_target', exitPrice: currentPrice, isPartial: true, partialFraction: 0.50 }
  }

  // 5. Trailing stop (after partial exit)
  if (position.partialExitDone) {
    const trailLevel = position.highestPrice * (1 - config.trailingStopPct)
    if (currentPrice < trailLevel) {
      return { shouldExit: true, reason: 'stop_loss', exitPrice: currentPrice, isPartial: false, partialFraction: 1.0 }
    }
  }

  // 6. Time-based exit
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
