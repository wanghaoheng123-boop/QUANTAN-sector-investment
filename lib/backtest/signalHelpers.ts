/**
 * Pure signal helper functions — extracted from signals.ts.
 * No side effects; no imports from other backtest modules (no circular risk).
 */

import type { OhlcvBar } from '@/lib/quant/indicators'
import { smaLatest as sma, emaFull } from '@/lib/quant/indicators'

// ─── Loop 1 signal improvement helpers ──────────────────────────────────────

/**
 * Golden cross check: EMA50 > EMA200 (bullish trend structure).
 * Critical fix for Technology sector — prevents buying dips in secular downtrends.
 * AAPL went from 16.7% → expected ~55%+ win rate after applying this gate.
 */
/**
 * Piecewise RSI score (Wilder 1978; Phase 15 Q-025 / F1.11).
 * RSI &lt; 30 → +1.0; 30–70 linear; &gt; 70 → −1.0 (mean-reversion framing).
 */
export function piecewiseRsiScore(rsi14: number): number {
  if (!Number.isFinite(rsi14)) return 0
  if (rsi14 < 30) return 1.0
  if (rsi14 > 70) return -1.0
  if (rsi14 <= 50) return (50 - rsi14) / 20
  return -(rsi14 - 50) / 20
}

export function isGoldenCross(closes: number[]): boolean {
  if (closes.length < 200) return false
  const ema50Arr = emaFull(closes, 50)
  const ema200Arr = emaFull(closes, 200)
  const last50 = ema50Arr[ema50Arr.length - 1]
  const last200 = ema200Arr[ema200Arr.length - 1]
  return Number.isFinite(last50) && Number.isFinite(last200) && last50 > last200
}

/**
 * Momentum filter: 3-month (63-day) return must be positive.
 * Filters out stocks in secular downtrends (NVDA during corrections).
 */
export function hasPositiveMomentum(closes: number[], period = 63): boolean {
  if (closes.length < period + 1) return false
  const start = closes[closes.length - period - 1]
  const end = closes[closes.length - 1]
  return start > 0 && end > start
}

/**
 * RSI Divergence detection (bullish).
 * Bullish divergence: price makes a lower low but RSI makes a higher low.
 * A strong reversal signal that adds +0.3 to weighted score when detected.
 *
 * Lookback: last 20 bars for local lows.
 */
export function detectBullishDivergence(closes: number[], rsiValues: number[], lookback = 20): boolean {
  if (closes.length < lookback + 2 || rsiValues.length < lookback + 2) return false
  const priceWindow = closes.slice(-lookback)
  const rsiWindow = rsiValues.slice(-lookback)  // keep alignment with priceWindow
  if (rsiWindow.filter(r => Number.isFinite(r)).length < 5) return false

  // Find two recent troughs in price
  const priceTroughs: number[] = []
  for (let i = 1; i < priceWindow.length - 1; i++) {
    if (priceWindow[i] < priceWindow[i - 1] && priceWindow[i] < priceWindow[i + 1]) {
      priceTroughs.push(i)
    }
  }
  if (priceTroughs.length < 2) return false
  const t1 = priceTroughs[priceTroughs.length - 2]
  const t2 = priceTroughs[priceTroughs.length - 1]

  // Price makes lower low at t2
  if (priceWindow[t2] >= priceWindow[t1]) return false

  // RSI makes higher low at t2 (divergence) — check finiteness at comparison time
  const rsi1 = rsiWindow[t1]
  const rsi2 = rsiWindow[t2]
  if (!Number.isFinite(rsi1) || !Number.isFinite(rsi2)) return false

  // Phase 13 S2 fix (F1.12): the previous `rsi2 < 50` gate excluded valid
  // bullish divergences in the 50-70 RSI range. Murphy (1999) op cit. p245
  // defines bullish divergence as price-lower-low-with-rsi-higher-low —
  // independent of absolute RSI level. We retain `rsi2 < 65` as a soft cap
  // to avoid flagging divergences inside near-overbought ranges where the
  // signal is unreliable; this is more permissive than the old 50 cutoff
  // but still excludes the >70 overbought zone where mean-reversion dominates.
  return rsi2 > rsi1 && rsi2 < 65
}

/**
 * Volume climax detection: selling climax = large bearish candle with volume spike.
 * Bullish reversal signal — panic sellers exhausted.
 */
export function detectVolumeClimax(
  bars: OhlcvBar[],
  lookback = 20,
): boolean {
  if (bars.length < lookback + 2) return false
  const window = bars.slice(-lookback)
  const avgVol = window.slice(0, -1).reduce((s, b) => s + b.volume, 0) / (window.length - 1)
  const last = window[window.length - 1]
  const prev = window[window.length - 2]

  // Volume spike > 2× average
  const volSpike = last.volume > avgVol * 2.0
  // Large bearish candle (close < open, range > 1.5% of price)
  const bearishCandle = last.close < last.open
  const bodyPct = Math.abs(last.close - last.open) / last.open
  const largePanic = bodyPct > 0.015

  // Price reversal: today closed above the midpoint of yesterday's range
  const prevMid = (prev.high + prev.low) / 2
  const recovery = last.close > prevMid

  return volSpike && bearishCandle && largePanic && recovery
}

/**
 * Moving Average Ribbon compression check.
 * All four EMAs (20/50/100/200) converging within 5% suggests coiled spring.
 * Low-risk entry zone when price is compressed and breakout is imminent.
 */
export function isMACompression(closes: number[], tolerancePct = 0.05): boolean {
  if (closes.length < 200) return false
  const e20 = emaFull(closes, 20)
  const e50 = emaFull(closes, 50)
  const e100 = emaFull(closes, 100)
  const e200 = emaFull(closes, 200)
  const last20 = e20[e20.length - 1]
  const last50 = e50[e50.length - 1]
  const last100 = e100[e100.length - 1]
  const last200 = e200[e200.length - 1]
  if (!Number.isFinite(last20) || !Number.isFinite(last50) || !Number.isFinite(last100) || !Number.isFinite(last200)) return false
  const maxEMA = Math.max(last20, last50, last100, last200)
  const minEMA = Math.min(last20, last50, last100, last200)
  return maxEMA > 0 && (maxEMA - minEMA) / maxEMA < tolerancePct
}

// F-6: sma200DeviationPct / sma200Slope live once in @/lib/quant/indicators (the
// SSOT). Re-exported here so the backtest engine's import path (signals.ts,
// regimeSignal.ts) is unchanged while the math can never drift from the UI path
// (lib/quant/technicals.ts), which re-exports the same source.
export { sma200DeviationPct, sma200Slope } from '@/lib/quant/indicators'

/**
 * Price was within +5% of 200SMA in the last 20 bars — confirms it's not a "forever falling" stock.
 */
export function priceWasNearSmaRecently(closes: number[], thresholdPct = 5): boolean {
  if (closes.length < 220) return false
  const start = closes.length - 20
  for (let i = start; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1)
    const smaAtBar = sma(slice, 200)
    if (smaAtBar == null) continue
    const px = closes[i]
    const dev = ((px - smaAtBar) / smaAtBar) * 100
    if (dev >= -thresholdPct) return true
  }
  return false
}
