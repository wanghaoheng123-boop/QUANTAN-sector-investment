/**
 * Regime Detection — classify market conditions by volatility and trend strength.
 *
 * Uses vol20/vol60 ratio for volatility regime and ADX for trend strength.
 * Outputs a strategy hint: trend-following, mean-reversion, or neutral.
 */

import type { OhlcBar } from '@/lib/quant/indicators'
import { adxArray } from '@/lib/quant/indicators'

// ─── Types ──────────────────────────────────────────────────────────────────

export type VolatilityRegime = 'low' | 'normal' | 'high' | 'crisis'
export type TrendRegime = 'strong_trend' | 'weak_trend' | 'range_bound'
export type StrategyHint = 'trend_following' | 'mean_reversion' | 'neutral'

export interface RegimeState {
  volatilityRegime: VolatilityRegime
  trendRegime: TrendRegime
  strategyHint: StrategyHint
  volRatio: number       // vol20 / vol60
  adxValue: number | null
  confidence: number     // 0-100, how clear the regime signal is
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Annualized realized volatility over `period` days.
 * Uses log returns, annualized by sqrt(252).
 */
function realizedVol(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null
  const slice = closes.slice(-period - 1)
  const logReturns: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0 && slice[i] > 0) {
      logReturns.push(Math.log(slice[i] / slice[i - 1]))
    }
  }
  if (logReturns.length < 2) return null
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length
  const variance = logReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / (logReturns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252)
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Detect the current market regime from closes and bars.
 *
 * Volatility regime: vol20/vol60 ratio
 *   - crisis: ratio > 1.5 (short-term vol spiking relative to medium-term)
 *   - high: ratio > 1.2
 *   - low: ratio < 0.8 (compression, potential breakout)
 *   - normal: 0.8 to 1.2
 *
 * Trend regime: ADX(14)
 *   - strong_trend: ADX > 25
 *   - weak_trend: ADX 15-25
 *   - range_bound: ADX < 15
 *
 * Strategy hint:
 *   - strong_trend + non-crisis -> trend_following
 *   - range_bound + low/normal vol -> mean_reversion
 *   - otherwise -> neutral
 */
export function detectRegime(closes: number[], bars: OhlcBar[]): RegimeState {
  // Volatility regime
  const vol20 = realizedVol(closes, 20)
  const vol60 = realizedVol(closes, 60)
  let volRatio = 1.0
  let volatilityRegime: VolatilityRegime = 'normal'

  if (vol20 != null && vol60 != null && vol60 > 0) {
    volRatio = vol20 / vol60
    if (volRatio > 1.5) volatilityRegime = 'crisis'
    else if (volRatio > 1.2) volatilityRegime = 'high'
    else if (volRatio < 0.8) volatilityRegime = 'low'
    else volatilityRegime = 'normal'
  }

  // Trend regime via ADX
  const adx = adxArray(bars, 14)
  const lastAdx = adx.adx[adx.adx.length - 1]
  let adxValue: number | null = null
  let trendRegime: TrendRegime = 'range_bound'

  if (Number.isFinite(lastAdx)) {
    adxValue = lastAdx
    if (lastAdx > 25) trendRegime = 'strong_trend'
    else if (lastAdx > 15) trendRegime = 'weak_trend'
    else trendRegime = 'range_bound'
  }

  // Strategy hint
  let strategyHint: StrategyHint = 'neutral'
  if (trendRegime === 'strong_trend' && volatilityRegime !== 'crisis') {
    strategyHint = 'trend_following'
  } else if (trendRegime === 'range_bound' && (volatilityRegime === 'low' || volatilityRegime === 'normal')) {
    strategyHint = 'mean_reversion'
  }

  // Confidence: clearer signals = higher confidence
  let confidence = 50
  if (trendRegime === 'strong_trend') confidence += 20
  else if (trendRegime === 'range_bound') confidence += 10
  if (volatilityRegime === 'normal') confidence += 10
  else if (volatilityRegime === 'crisis') confidence -= 15
  if (adxValue != null && (adxValue > 30 || adxValue < 12)) confidence += 10 // very clear signal

  return {
    volatilityRegime,
    trendRegime,
    strategyHint,
    volRatio,
    adxValue,
    confidence: Math.max(0, Math.min(100, confidence)),
  }
}
