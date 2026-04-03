/**
 * Backtest signal generators — shared across API routes and scripts.
 * Mirrors lib/quant/technicals.ts but produces named signal objects for backtesting.
 */

import type { OhlcBar } from '@/lib/quant/technicals'

// ─── Core math helpers ───────────────────────────────────────────────────────

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  if (values.length === 0) return out
  if (values.length < period) return values.map(v => NaN)
  // Seed with SMA of first `period` values — standard Wilder/init method
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(prev)
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN)
  if (closes.length < period + 1) return out
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

export function macdFn(closes: number[], fast = 12, slow = 26, signal = 9): {
  line: number[]; signal: number[]; histogram: number[]
} {
  const outLine: number[] = new Array(closes.length).fill(NaN)
  const outSig: number[] = new Array(closes.length).fill(NaN)
  if (closes.length < slow) return { line: outLine, signal: outSig, histogram: new Array(closes.length).fill(NaN) }
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  for (let i = 0; i < closes.length; i++) outLine[i] = emaFast[i] - emaSlow[i]
  const validLine = outLine.slice(slow - 1)
  const sigEma = ema(validLine, signal)
  for (let i = 0; i < sigEma.length; i++) outSig[i + slow - 1] = sigEma[i]
  const outHist = outLine.map((l, i) => {
    const s = outSig[i]
    if (!Number.isFinite(l) || !Number.isFinite(s)) return NaN
    return l - s
  })
  return { line: outLine, signal: outSig, histogram: outHist }
}

export function atr(bars: OhlcBar[], period = 14): number[] {
  const out: number[] = new Array(bars.length).fill(NaN)
  if (bars.length < period + 1) return out
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    trs.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    ))
  }
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = avg
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period
    out[i] = avg
  }
  return out
}

export function bollinger(closes: number[], period = 20, mult = 2): {
  mid: number[]; upper: number[]; lower: number[]; pctB: number[]
} {
  const mid: number[] = new Array(closes.length).fill(NaN)
  const upper: number[] = new Array(closes.length).fill(NaN)
  const lower: number[] = new Array(closes.length).fill(NaN)
  const pctB: number[] = new Array(closes.length).fill(NaN)
  if (closes.length < period) return { mid, upper, lower, pctB }
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1)
    const m = slice.reduce((a, b) => a + b, 0) / period
    const sd = Math.sqrt(slice.reduce((s, x) => s + (x - m) ** 2, 0) / (period - 1))
    mid[i] = m; upper[i] = m + mult * sd; lower[i] = m - mult * sd
    if (upper[i] !== lower[i]) pctB[i] = (closes[i] - lower[i]) / (upper[i] - lower[i])
  }
  return { mid, upper, lower, pctB }
}

export function sma200DeviationPct(price: number, sma200: number): number | null {
  if (!Number.isFinite(sma200) || sma200 <= 0 || !Number.isFinite(price)) return null
  return ((price - sma200) / sma200) * 100
}

/**
 * 200SMA slope — percent change of the 200SMA over 20 bars.
 * Positive = 200SMA is rising (long-term uptrend).
 * Require slope > 0.005 (0.5%) to filter out noise in flat markets.
 */
export function sma200Slope(closes: number[]): number | null {
  if (closes.length < 221) return null
  const now = sma(closes, 200)
  const prev = sma(closes.slice(0, closes.length - 20), 200)
  if (now == null || prev == null || prev === 0) return null
  return (now - prev) / prev
}

/**
 * Price was within +5% of 200SMA in the last 20 bars — confirms it's not a "forever falling" stock.
 */
export function priceWasNearSmaRecently(closes: number[], thresholdPct = 5): boolean {
  if (closes.length < 220) return false
  const window = closes.slice(-20)
  const smaNow = sma(closes, 200)
  if (smaNow == null) return false
  for (const px of window) {
    const dev = ((px - smaNow) / smaNow) * 100
    if (dev >= -thresholdPct) return true
  }
  return false
}

// ─── Regime classifier ─────────────────────────────────────────────────────────

export type DipSignal =
  | 'STRONG_DIP' | 'WATCH_DIP' | 'FALLING_KNIFE'
  | 'OVERBOUGHT' | 'IN_TREND' | 'INSUFFICIENT_DATA'

export interface RegimeSignal {
  zone: string
  dipSignal: DipSignal
  deviationPct: number | null
  slopePct: number | null
  slopePositive: boolean | null
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  label: string
}

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
 *   -5 to 0%  FIRST_DIP  → BUY if slope > 0.005 AND price was recently near SMA
 *   -10 to -5% DEEP_DIP  → BUY if slope > 0.005 AND price was near SMA
 *   -20 to -10% BEAR_ALERT → HOLD (not oversold enough to buy)
 *   <-20%  CRASH_ZONE    → BUY only if slope > 0.005 (never buy crash in downtrend)
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

  // ── Deviation-based zones ──────────────────────────────────────────────
  // EXTREME_BULL: >+20% — extremely extended, no buy
  if (dev != null && dev > 20) {
    return { zone: 'EXTREME_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 40, label: 'EXTREME_BULL' }
  }
  // EXTENDED_BULL: >+10% — extended, hold
  if (dev != null && dev > 10) {
    return { zone: 'EXTENDED_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 45, label: 'EXTENDED_BULL' }
  }
  // HEALTHY_BULL: 0 to +10% — above SMA, in trend, no new entry
  if (dev != null && dev >= 0) {
    return { zone: 'HEALTHY_BULL', dipSignal: 'IN_TREND', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 55, label: 'HEALTHY_BULL' }
  }

  // ── Dip zones (price below 200SMA) ────────────────────────────────────
  // FIX D: Only buy dips if price was recently near SMA (not a "forever falling" stock)
  const canBuyDip = slopePos === true && nearSma

  // FIRST_DIP: -10% to -5% — mild pullback, primary buy zone
  if (dev != null && dev >= -10) {
    if (canBuyDip) {
      const conf = rsi14 != null && rsi14 < 35 ? 90 : 75
      return { zone: 'FIRST_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: conf, label: 'FIRST_DIP' }
    }
    // Not near SMA recently — hold, don't chase
    return { zone: 'FIRST_DIP', dipSignal: 'WATCH_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 35, label: 'FIRST_DIP' }
  }

  // DEEP_DIP: -20% to -10% — meaningful correction, high-conviction buy zone
  if (dev != null && dev >= -20) {
    if (canBuyDip) {
      return { zone: 'DEEP_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 88, label: 'DEEP_DIP' }
    }
    // Falling/near-flat SMA or price already far below SMA — falling knife
    return { zone: 'DEEP_DIP', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 82, label: 'DEEP_DIP' }
  }

  // BEAR_ALERT: -30% to -20% — severe drawdown, only buy with strongest confirm
  if (dev != null && dev >= -30) {
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

// ─── Combined signal ───────────────────────────────────────────────────────────

export interface BacktestConfig {
  initialCapital: number
  stopLossPct: number
  confidenceThreshold: number
  maxDrawdownCap: number
  halfKelly: boolean
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 100_000,
  // stopLossPct is now ATR-adaptive in the engine (1.5x ATR, capped 5-15%).
  // This config value serves as the floor for the ATR formula.
  stopLossPct: 0.10,
  confidenceThreshold: 55,  // Lowered from 65 to allow more signals through
  maxDrawdownCap: 0.25,
  halfKelly: true,
}

export interface ConfirmSignal {
  name: string
  value: number | null
  bullish: boolean
}

export interface CombinedSignal {
  ticker: string
  date: string
  price: number
  regime: RegimeSignal
  confirms: ConfirmSignal[]
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  KellyFraction: number
  reason: string
}

/**
 * Combined signal with proper ATR% volatility confirmation.
 *
 * ATR% = (ATR / price) * 100 — daily volatility as % of price.
 * ATR% > 2 means the stock moves >2% per day — good for swing trades.
 * ATR% < 1 means low volatility — position may not have enough range.
 */
export function combinedSignal(
  ticker: string,
  date: string,
  price: number,
  closes: number[],
  bars: OhlcBar[],
  config: Partial<BacktestConfig> = {},
): CombinedSignal {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  const rsiVals = rsi(closes)
  const macdVals = macdFn(closes)
  const atrVals = atr(bars)
  const bbVals = bollinger(closes)

  const rsi14 = rsiVals[rsiVals.length - 1]
  const macdHist = macdVals.histogram[macdVals.histogram.length - 1]
  const atrLast = atrVals[atrVals.length - 1]
  const bbPctB = bbVals.pctB[bbVals.pctB.length - 1]

  // ATR as percentage of price — makes sense across all price levels
  const atrPct = Number.isFinite(atrLast) && Number.isFinite(price) && price > 0
    ? (atrLast / price) * 100
    : NaN

  const regime = regimeSignal(price, closes, rsi14)

  // ── Individual confirmation signals ───────────────────────────────────
  const rsiBullish  = Number.isFinite(rsi14)   && rsi14 < 35
  const macdBullish = Number.isFinite(macdHist) && macdHist > 0
  // ATR% > 2% means meaningful daily range — good for swing trading
  const atrBullish   = Number.isFinite(atrPct)  && atrPct > 2.0
  // BB% < 0.20 means price is in the lower 20% of its Bollinger range — near lower band
  const bbBullish    = Number.isFinite(bbPctB)   && bbPctB < 0.20

  const bullishCount =
    (rsiBullish  ? 1 : 0) +
    (macdBullish ? 1 : 0) +
    (atrBullish  ? 1 : 0) +
    (bbBullish   ? 1 : 0)

  // ── Override regime action with confirmation filter ─────────────────────
  let action: 'BUY' | 'HOLD' | 'SELL' = regime.action

  // BUY requires at least 2 confirmations to avoid false signals in chop
  if (action === 'BUY' && bullishCount < 2) {
    action = 'HOLD'
  }
  // HOLD near-overbought: if RSI > 70, be more cautious
  if (action === 'HOLD' && regime.zone === 'HEALTHY_BULL' && Number.isFinite(rsi14) && rsi14 > 70) {
    action = 'SELL'
  }

  const confidence = Math.min(100, regime.confidence + Math.round((bullishCount / 4) * 25))

  // Suppress if below threshold (unless it's a SELL signal)
  if (confidence < cfg.confidenceThreshold && action !== 'SELL') {
    action = 'HOLD'
  }

  // ── Kelly fraction sizing ──────────────────────────────────────────────
  let kellyFrac = 0.10
  if (action === 'BUY') {
    if (regime.dipSignal === 'STRONG_DIP' && bullishCount >= 3) {
      kellyFrac = cfg.halfKelly ? 0.25 : 0.50  // Maximum conviction
    } else if (regime.dipSignal === 'STRONG_DIP') {
      kellyFrac = cfg.halfKelly ? 0.15 : 0.30  // Strong signal
    } else {
      kellyFrac = cfg.halfKelly ? 0.10 : 0.20   // Normal signal
    }
  } else if (action === 'SELL') {
    kellyFrac = 1.0  // Exit full position
  }

  // ── Human-readable reason ───────────────────────────────────────────────
  const confLabels = [
    Number.isFinite(rsi14)   && rsiBullish  ? `RSI ${rsi14.toFixed(1)}`        : null,
    Number.isFinite(macdHist) && macdBullish ? `MACD hist +${macdHist.toFixed(2)}` : null,
    Number.isFinite(atrPct)  && atrBullish  ? `ATR% ${atrPct.toFixed(1)}%`     : null,
    Number.isFinite(bbPctB)  && bbBullish   ? `BB% ${(bbPctB * 100).toFixed(0)}%` : null,
  ].filter(Boolean)

  const reason = action === 'BUY'
    ? `${regime.zone} [${regime.dipSignal}]: price ${deviationLabel(regime.deviationPct)} vs 200SMA. ${confLabels.join(', ') || 'no extra confirms'}. Kelly ${(kellyFrac * 100).toFixed(0)}%.`
    : action === 'SELL'
    ? `${regime.zone} [${regime.dipSignal}]: exiting. ${confLabels.join(', ') || 'no confirms'}.`
    : `${regime.zone} [${regime.dipSignal}]: confidence ${confidence}% (need ${cfg.confidenceThreshold}%). Hold.`

  return {
    ticker, date, price, regime,
    confirms: [
      { name: 'RSI(14)', value: Number.isFinite(rsi14) ? rsi14 : null, bullish: rsiBullish },
      { name: 'MACD hist', value: Number.isFinite(macdHist) ? macdHist : null, bullish: macdBullish },
      { name: 'ATR%', value: Number.isFinite(atrPct) ? atrPct : null, bullish: atrBullish },
      { name: 'BB%', value: Number.isFinite(bbPctB) ? bbPctB : null, bullish: bbBullish },
    ],
    action, confidence, KellyFraction: kellyFrac, reason,
  }
}

function deviationLabel(dev: number | null): string {
  if (dev === null) return '?'
  if (dev >= 0) return `+${dev.toFixed(1)}%`
  return `${dev.toFixed(1)}%`
}
