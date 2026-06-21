/**
 * Regime classifier signal — extracted from signals.ts.
 * Depends on signalHelpers and signalTypes; no circular risk.
 */

import { smaLatest as sma } from '@/lib/quant/indicators'
import type { RegimeState as VolRegimeState } from '@/lib/quant/regimeDetection'
import type { PriceZone } from '@/lib/quant/volumeProfile'
import { sma200DeviationPct, sma200Slope, priceWasNearSmaRecently } from './signalHelpers'
import type { DipSignal, RegimeSignal } from './signalTypes'

export type { DipSignal, RegimeSignal }

function deviationLabel(dev: number | null): string {
  if (dev === null) return '?'
  if (dev >= 0) return `+${dev.toFixed(1)}%`
  return `${dev.toFixed(1)}%`
}

// ─── Enhanced weighted confluence signal internal helpers ─────────────────────

/** Clamp a value between min and max. */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * Default weight profiles. Weights must sum to 1.0.
 * Adjusted based on regime: trend-following boosts MACD/Multi-TF,
 * mean-reversion boosts RSI/BB%B.
 */
export const WEIGHT_PROFILES: Record<string, { rsi: number; macd: number; atr: number; bb: number; vpoc: number; mtf: number; volReg: number }> = {
  default:         { rsi: 0.20, macd: 0.15, atr: 0.10, bb: 0.15, vpoc: 0.10, mtf: 0.20, volReg: 0.10 },
  trend_following: { rsi: 0.15, macd: 0.20, atr: 0.10, bb: 0.10, vpoc: 0.10, mtf: 0.25, volReg: 0.10 },
  mean_reversion:  { rsi: 0.25, macd: 0.10, atr: 0.10, bb: 0.20, vpoc: 0.10, mtf: 0.15, volReg: 0.10 },
  neutral:         { rsi: 0.20, macd: 0.15, atr: 0.10, bb: 0.15, vpoc: 0.10, mtf: 0.20, volReg: 0.10 },
}

/**
 * Volume-profile zone score.
 *
 * Phase 13 S2 documentation (F1.14): the asymmetry below_va=+0.8 vs
 * above_va=-0.5 reflects a MEAN-REVERSION prior — the default signal mode
 * for this codebase. Steidlmayer's Market Profile (1989) treats below-VA
 * as accumulation territory (institutional buyers absorbing supply) and
 * above-VA as distribution territory; the asymmetric weights bias the
 * confluence score toward dip-buying, which historically produces the
 * dip-buy bias in the confluence score (see SIGNAL_SSOT.md for honest WR metrics).
 *
 * For TREND-FOLLOWING regimes (high ADX), an above-VA breakout is
 * bullish, not bearish. The current implementation does not flip the
 * sign for trend regimes; this is a known limitation queued for a
 * future pass that would make the score regime-dependent (passing
 * `volRegime.strategyHint` into this helper).
 *
 * Reference: Steidlmayer, J. P. (1989). Steidlmayer on Markets. Wiley.
 */
export function volumeZoneScore(zone: PriceZone | null): number {
  if (zone === null) return 0
  switch (zone) {
    case 'below_va': return 0.8   // below value area = potential support = bullish (mean-rev prior)
    case 'at_poc':   return 0.3   // at POC = fair value
    case 'in_va':    return 0.0   // inside value area = neutral
    case 'above_va': return -0.5  // above value area = extended (mean-rev prior)
  }
}

/** Volatility regime to score mapping. */
export function volRegimeScore(regime: VolRegimeState): number {
  switch (regime.volatilityRegime) {
    case 'low':    return 0.5   // compression = potential breakout
    case 'normal': return 0.2
    case 'high':   return -0.3
    case 'crisis': return -0.8
  }
}

// ─── Regime classifier ─────────────────────────────────────────────────────────

/**
 * Classify price regime based on 200SMA deviation and slope.
 *
 * FIX A: Require slope > 0.005 (0.5% over 20 bars) to filter flat/noise markets.
 * FIX D: Require price was within +5% of 200SMA in last 20 bars for dip BUY zones.
 *
 * Deviation zones (price vs 200SMA):
 *   >+20%  EXTREME_BULL  → HOLD (overbought, don't chase)
 *   >+10%  EXTENDED_BULL → HOLD
 *   >= 0%  HEALTHY_BULL  → HOLD (slightly above SMA = normal)
 *   -10 to 0%  FIRST_DIP  → BUY if slope positive AND price was recently near SMA (else HOLD/WATCH_DIP)
 *   -20 to -10% DEEP_DIP  → BUY if slope positive AND near SMA (else SELL — falling knife)
 *   -30 to -20% BEAR_ALERT → BUY only with positive slope + near SMA (else SELL)
 *   <-30%  CRASH_ZONE    → BUY only if slope positive + near SMA (else SELL — never buy crash in downtrend)
 */
export function regimeSignal(price: number, closes: number[], rsi14?: number): RegimeSignal {
  if (closes.length < 200) {
    return {
      zone: 'INSUFFICIENT_DATA', dipSignal: 'INSUFFICIENT_DATA',
      deviationPct: null, slopePct: null, slopePositive: null,
      action: 'HOLD', confidence: 0, label: 'Insufficient Data',
    }
  }

  const dev = sma200DeviationPct(price, sma(closes, 200)!)
  const slope = sma200Slope(closes)
  // FIX A: Require meaningful slope > 0.005 (0.5%)
  const slopePos = slope != null ? slope > 0.005 : null
  // FIX D: Was price recently within +5% of SMA?
  const nearSma = priceWasNearSmaRecently(closes, 5)

  // Fail-closed when deviation can't be computed (non-finite price, broken
  // SMA). Previously the function fell through every `if (dev != null ...)`
  // branch and silently classified the position as CRASH_ZONE BUY or SELL
  // with 78–95% confidence — emitting real trading actions from bad data.
  if (dev == null) {
    return {
      zone: 'INSUFFICIENT_DATA', dipSignal: 'INSUFFICIENT_DATA',
      deviationPct: null, slopePct: slope, slopePositive: slopePos,
      action: 'HOLD', confidence: 0, label: 'Insufficient Data',
    }
  }

  // ── Deviation-based zones ──────────────────────────────────────────────
  // `dev` is non-null past the fail-closed guard above, so the zone checks
  // below are unguarded comparisons (no redundant `dev != null &&`).
  // EXTREME_BULL: >+20% — extremely extended, no buy
  if (dev > 20) {
    return { zone: 'EXTREME_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 40, label: 'EXTREME_BULL' }
  }
  // EXTENDED_BULL: >+10% — extended, hold
  if (dev > 10) {
    return { zone: 'EXTENDED_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 45, label: 'EXTENDED_BULL' }
  }
  // HEALTHY_BULL: 0 to +10% — above SMA, in trend, no new entry
  if (dev >= 0) {
    return { zone: 'HEALTHY_BULL', dipSignal: 'IN_TREND', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 55, label: 'HEALTHY_BULL' }
  }

  // ── Dip zones (price below 200SMA) ────────────────────────────────────
  // FIX D: Only buy dips if price was recently near SMA (not a "forever falling" stock)
  const canBuyDip = slopePos === true && nearSma

  // FIRST_DIP: -10% to 0% — mild pullback, primary buy zone
  if (dev >= -10) {
    if (canBuyDip) {
      const conf = rsi14 != null && rsi14 < 35 ? 90 : 75
      return { zone: 'FIRST_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: conf, label: 'FIRST_DIP' }
    }
    // Not near SMA recently — hold, don't chase
    return { zone: 'FIRST_DIP', dipSignal: 'WATCH_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 35, label: 'FIRST_DIP' }
  }

  // DEEP_DIP: -20% to -10% — meaningful correction, high-conviction buy zone
  if (dev >= -20) {
    if (canBuyDip) {
      return { zone: 'DEEP_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 88, label: 'DEEP_DIP' }
    }
    // Falling/near-flat SMA or price already far below SMA — falling knife
    return { zone: 'DEEP_DIP', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 82, label: 'DEEP_DIP' }
  }

  // BEAR_ALERT: -30% to -20% — severe drawdown, only buy with strongest confirm
  if (dev >= -30) {
    if (canBuyDip) {
      return { zone: 'BEAR_ALERT', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 80, label: 'BEAR_ALERT' }
    }
    return { zone: 'BEAR_ALERT', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 90, label: 'BEAR_ALERT' }
  }

  // CRASH_ZONE: <-30% — crash territory
  if (canBuyDip) {
    return { zone: 'CRASH_ZONE', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 78, label: 'CRASH_ZONE' }
  }
  return { zone: 'CRASH_ZONE', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 95, label: 'CRASH_ZONE' }
}
