/**
 * Backtest signal generators — standalone version for scripts.
 * Identical to lib/backtest/signals.ts but without @ path aliases.
 */

import type { OhlcBar } from '../../lib/quant/technicals'

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  if (values.length === 0) return out
  let prev = values[0]
  out.push(prev)
  for (let i = 1; i < values.length; i++) {
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
  out[period] = avg
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period
    out[i + 1] = avg
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

export function sma200Slope(closes: number[]): number | null {
  if (closes.length < 221) return null
  const now = sma(closes, 200)
  const prev = sma(closes.slice(0, closes.length - 20), 200)
  if (now == null || prev == null || prev === 0) return null
  return (now - prev) / prev
}

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
  // FIX A: Require meaningful slope > 0.005 (0.5%) to filter flat/noise markets
  const slopePos = slope != null ? slope > 0.005 : null
  // FIX D: Was price recently within +5% of SMA?
  const nearSma = priceWasNearSmaRecently(closes, 5)
  const canBuyDip = slopePos === true && nearSma

  if (dev != null && dev > 20) {
    return { zone: 'EXTREME_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 40, label: 'EXTREME_BULL' }
  }
  if (dev != null && dev > 10) {
    return { zone: 'EXTENDED_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 45, label: 'EXTENDED_BULL' }
  }
  if (dev != null && dev >= 0) {
    return { zone: 'HEALTHY_BULL', dipSignal: 'IN_TREND', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 55, label: 'HEALTHY_BULL' }
  }

  if (dev != null && dev >= -10) {
    if (canBuyDip) {
      const conf = rsi14 != null && rsi14 < 35 ? 90 : 75
      return { zone: 'FIRST_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: conf, label: 'FIRST_DIP' }
    }
    return { zone: 'FIRST_DIP', dipSignal: 'WATCH_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 35, label: 'FIRST_DIP' }
  }

  if (dev != null && dev >= -20) {
    if (canBuyDip) {
      return { zone: 'DEEP_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 88, label: 'DEEP_DIP' }
    }
    return { zone: 'DEEP_DIP', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 82, label: 'DEEP_DIP' }
  }

  if (dev != null && dev >= -30) {
    if (canBuyDip) {
      return { zone: 'BEAR_ALERT', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 80, label: 'BEAR_ALERT' }
    }
    return { zone: 'BEAR_ALERT', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 90, label: 'BEAR_ALERT' }
  }

  if (canBuyDip) {
    return { zone: 'CRASH_ZONE', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 78, label: 'CRASH_ZONE' }
  }
  return { zone: 'CRASH_ZONE', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 95, label: 'CRASH_ZONE' }
}

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
  stopLossPct: 0.10,
  confidenceThreshold: 55,  // Lowered from 65 to allow more signals through
  maxDrawdownCap: 0.25,
  halfKelly: true,
}

export interface CombinedSignal {
  ticker: string
  date: string
  price: number
  regime: RegimeSignal
  confirms: { name: string; value: number | null; bullish: boolean }[]
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  KellyFraction: number
  reason: string
}

export function combinedSignal(
  ticker: string, date: string, price: number,
  closes: number[], bars: { open: number; high: number; low: number; close: number }[],
  config: Partial<BacktestConfig> = {},
): CombinedSignal {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  const rsiVals = rsi(closes)
  const macdVals = macdFn(closes)
  const atrVals = atr(bars)
  const bbVals = bollinger(closes)

  const rsi14   = rsiVals[rsiVals.length - 1]
  const macdHist = macdVals.histogram[macdVals.histogram.length - 1]
  const atrLast  = atrVals[atrVals.length - 1]
  const bbPctB  = bbVals.pctB[bbVals.pctB.length - 1]

  const atrPct = Number.isFinite(atrLast) && Number.isFinite(price) && price > 0
    ? (atrLast / price) * 100 : NaN

  const regime = regimeSignal(price, closes, rsi14)

  const rsiBullish  = Number.isFinite(rsi14)   && rsi14 < 35
  const macdBullish = Number.isFinite(macdHist) && macdHist > 0
  const atrBullish   = Number.isFinite(atrPct)  && atrPct > 2.0
  const bbBullish    = Number.isFinite(bbPctB)   && bbPctB < 0.20

  const bullishCount =
    (rsiBullish  ? 1 : 0) +
    (macdBullish ? 1 : 0) +
    (atrBullish  ? 1 : 0) +
    (bbBullish   ? 1 : 0)

  let action: 'BUY' | 'HOLD' | 'SELL' = regime.action
  if (action === 'BUY' && bullishCount < 2) action = 'HOLD'
  if (action === 'HOLD' && regime.zone === 'HEALTHY_BULL' && Number.isFinite(rsi14) && rsi14 > 70) action = 'SELL'

  const confidence = Math.min(100, regime.confidence + Math.round((bullishCount / 4) * 25))
  if (confidence < cfg.confidenceThreshold && action !== 'SELL') action = 'HOLD'

  let kellyFrac = 0.10
  if (action === 'BUY') {
    if (regime.dipSignal === 'STRONG_DIP' && bullishCount >= 3) kellyFrac = cfg.halfKelly ? 0.25 : 0.50
    else if (regime.dipSignal === 'STRONG_DIP') kellyFrac = cfg.halfKelly ? 0.15 : 0.30
    else kellyFrac = cfg.halfKelly ? 0.10 : 0.20
  } else if (action === 'SELL') {
    kellyFrac = 1.0
  }

  const devLbl = (d: number | null) => d === null ? '?' : d >= 0 ? `+${d.toFixed(1)}%` : `${d.toFixed(1)}%`
  const confLabels = [
    rsiBullish  ? `RSI ${rsi14.toFixed(1)}`       : null,
    macdBullish ? `MACD hist +${macdHist.toFixed(2)}` : null,
    atrBullish  ? `ATR% ${atrPct.toFixed(1)}%`    : null,
    bbBullish   ? `BB% ${(bbPctB * 100).toFixed(0)}%` : null,
  ].filter(Boolean)

  const reason = action === 'BUY'
    ? `${regime.zone} [${regime.dipSignal}]: price ${devLbl(regime.deviationPct)} vs 200SMA. ${confLabels.join(', ') || 'no extra confirms'}. Kelly ${(kellyFrac * 100).toFixed(0)}%.`
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
