/**
 * Backtest signal generators — shared across API routes and scripts.
 * Mirrors lib/quant/technicals.ts but produces named signal objects for backtesting.
 *
 * Phase 2 additions (April 2026):
 *   - adx()       Wilder's Average Directional Index (trend strength filter)
 *   - stochRsi()  Stochastic RSI (more sensitive oversold detection)
 *   - roc()       Rate of Change — 12-month momentum factor
 *   - relativeVolume() RVOL vs 20-bar average (volume confirmation)
 *   - ema50Deviation() price vs 50-EMA support for HEALTHY_BULL pullback zone
 *   - HEALTHY_BULL_DIP zone: buy 50-EMA pullbacks when above 200-SMA (uptrend retest)
 */

import type { OhlcBar } from '@/lib/quant/technicals'
import { kellyFraction } from '@/lib/quant/kelly'

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
  const n = closes.length
  const outLine: number[] = new Array(n).fill(NaN)
  const outSig: number[] = new Array(n).fill(NaN)
  const outHist: number[] = new Array(n).fill(NaN)
  if (n < slow) return { line: outLine, signal: outSig, histogram: outHist }
  // ema() returns array of length (n - period + 1); index 0 = time (period-1)
  const emaFast = ema(closes, fast)   // index i → time (fast-1+i)
  const emaSlow = ema(closes, slow)   // index i → time (slow-1+i)
  // Align by time: emaSlow[si] is at time t = slow-1+si; emaFast[fi] where fi = t-(fast-1)
  const macdVals: number[] = []
  for (let si = 0; si < emaSlow.length; si++) {
    const t = slow - 1 + si
    const fi = t - (fast - 1)
    const val = emaFast[fi] - emaSlow[si]
    outLine[t] = val
    macdVals.push(val)
  }
  if (macdVals.length < signal) return { line: outLine, signal: outSig, histogram: outHist }
  const sigVals = ema(macdVals, signal)
  for (let i = 0; i < sigVals.length; i++) {
    const t = slow - 1 + signal - 1 + i
    outSig[t] = sigVals[i]
  }
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(outLine[i]) && Number.isFinite(outSig[i])) {
      outHist[i] = outLine[i] - outSig[i]
    }
  }
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
  // First valid ATR is at bar index `period` (needs `period` prior TRs = `period+1` bars)
  out[period] = avg
  for (let i = period + 1; i < bars.length; i++) {
    avg = (avg * (period - 1) + trs[i - 1]) / period
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

// ─── Phase 2 indicators ───────────────────────────────────────────────────────

/**
 * Wilder's Average Directional Index (ADX) — measures TREND STRENGTH, not direction.
 * ADX > 20 = trending; ADX > 25 = strong trend; ADX < 20 = ranging/chop.
 *
 * Algorithm (Wilder's smoothing, period = 14):
 *   +DM = max(high - prevHigh, 0) only if > max(prevLow - low, 0), else 0
 *   -DM = max(prevLow - low, 0) only if > max(high - prevHigh, 0), else 0
 *   TR  = max(H-L, |H-Cprev|, |L-Cprev|)
 *   Smooth with Wilder (not EMA): smoothed[0]=sum(14); smoothed[i]= smoothed[i-1] - smoothed[i-1]/14 + new
 *   +DI = 100 × smoothedPlusDM / smoothedTR
 *   -DI = 100 × smoothedMinusDM / smoothedTR
 *   DX  = 100 × |+DI - -DI| / (+DI + -DI)
 *   ADX = Wilder(DX, 14)
 *
 * Returns array aligned with bars[] (NaN until sufficient history).
 */
export function adx(bars: OhlcBar[], period = 14): {
  adx: number[]
  plusDI: number[]
  minusDI: number[]
} {
  const n = bars.length
  const outAdx: number[] = new Array(n).fill(NaN)
  const outPlusDI: number[] = new Array(n).fill(NaN)
  const outMinusDI: number[] = new Array(n).fill(NaN)
  if (n < period * 2 + 1) return { adx: outAdx, plusDI: outPlusDI, minusDI: outMinusDI }

  const plusDMs: number[] = []
  const minusDMs: number[] = []
  const trs: number[] = []

  for (let i = 1; i < n; i++) {
    const h = bars[i].high, l = bars[i].low, c = bars[i - 1].close
    const ph = bars[i - 1].high, pl = bars[i - 1].low
    const upMove = h - ph
    const downMove = pl - l
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0)
    trs.push(Math.max(h - l, Math.abs(h - c), Math.abs(l - c)))
  }

  // Wilder smoothing: seed = sum of first `period` values
  let smTR = trs.slice(0, period).reduce((a, b) => a + b, 0)
  let smPDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0)
  let smMDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0)

  const dxVals: number[] = []
  const firstIdx = period // bars index corresponding to first smoothed DI

  for (let i = period; i < trs.length; i++) {
    if (i > period) {
      // Wilder's smoothing: S[i] = S[i-1] - S[i-1]/p + new
      smTR = smTR - smTR / period + trs[i]
      smPDM = smPDM - smPDM / period + plusDMs[i]
      smMDM = smMDM - smMDM / period + minusDMs[i]
    }
    const pdi = smTR > 0 ? 100 * smPDM / smTR : 0
    const mdi = smTR > 0 ? 100 * smMDM / smTR : 0
    const barIdx = i + 1 // bars[] is offset by 1 (i=0 → bar index 1)
    outPlusDI[barIdx] = pdi
    outMinusDI[barIdx] = mdi
    const dxSum = pdi + mdi
    dxVals.push(dxSum > 0 ? 100 * Math.abs(pdi - mdi) / dxSum : 0)
  }

  // ADX = Wilder smooth of DX over `period`
  if (dxVals.length < period) return { adx: outAdx, plusDI: outPlusDI, minusDI: outMinusDI }
  let smADX = dxVals.slice(0, period).reduce((a, b) => a + b, 0) / period
  const adxStartBarIdx = firstIdx + period
  if (adxStartBarIdx < n) outAdx[adxStartBarIdx] = smADX
  for (let i = period; i < dxVals.length; i++) {
    smADX = (smADX * (period - 1) + dxVals[i]) / period
    const barIdx = firstIdx + i + 1
    if (barIdx < n) outAdx[barIdx] = smADX
  }

  return { adx: outAdx, plusDI: outPlusDI, minusDI: outMinusDI }
}

/**
 * Stochastic RSI — applies stochastic formula to RSI values.
 * StochRSI = (RSI - min RSI over period) / (max RSI - min RSI)
 * Output in [0, 1]; < 0.20 = deeply oversold; > 0.80 = overbought.
 * More sensitive than plain RSI for timing entries.
 */
export function stochRsi(closes: number[], rsiPeriod = 14, stochPeriod = 14): number[] {
  const rsiVals = rsi(closes, rsiPeriod)
  const out: number[] = new Array(closes.length).fill(NaN)
  for (let i = rsiPeriod + stochPeriod - 1; i < closes.length; i++) {
    const window = rsiVals.slice(i - stochPeriod + 1, i + 1).filter(v => Number.isFinite(v))
    if (window.length < stochPeriod) continue
    const lo = Math.min(...window)
    const hi = Math.max(...window)
    out[i] = hi - lo > 0 ? (rsiVals[i] - lo) / (hi - lo) : 0.5
  }
  return out
}

/**
 * Rate of Change — percentage price change over n bars.
 * ROC(n) = (close - close[n bars ago]) / close[n bars ago] × 100
 * 12-month ROC (252 bars) > 0 confirms long-term price momentum.
 * Used as Fama-French / Carhart momentum factor proxy.
 */
export function roc(closes: number[], period = 252): number[] {
  const out: number[] = new Array(closes.length).fill(NaN)
  for (let i = period; i < closes.length; i++) {
    const prev = closes[i - period]
    if (prev > 0) out[i] = ((closes[i] - prev) / prev) * 100
  }
  return out
}

/**
 * Relative Volume — current bar volume vs 20-bar SMA of volume.
 * RVOL > 1.5 = above-average volume → confirms signal (institutional participation).
 * RVOL < 0.7 = low-volume → suspect signal.
 */
export function relativeVolume(volumes: number[], period = 20): number[] {
  const out: number[] = new Array(volumes.length).fill(NaN)
  for (let i = period - 1; i < volumes.length; i++) {
    const avg = volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
    out[i] = avg > 0 ? volumes[i] / avg : NaN
  }
  return out
}

/**
 * 50-EMA deviation — price distance from 50-bar EMA as %.
 * Used to detect pullbacks to 50-EMA support within uptrends (HEALTHY_BULL zone).
 */
export function ema50DeviationPct(price: number, closes: number[]): number | null {
  if (closes.length < 50) return null
  const emaVals = ema(closes, 50)
  const ema50 = emaVals[emaVals.length - 1]
  if (!Number.isFinite(ema50) || ema50 <= 0) return null
  return ((price - ema50) / ema50) * 100
}

/**
 * Chande Momentum Oscillator — measures trend strength direction combined.
 * CMO(N) = 100 × (SumUp - SumDown) / (SumUp + SumDown)  range [-100, +100]
 *
 * Unlike RSI (uses smoothed averages), CMO uses raw sum → more reactive.
 * Thresholds (Chande & Kroll 1994, validated on S&P 500):
 *   CMO > +50  → strong uptrend  → allow HEALTHY_BULL entries
 *   CMO < -50  → strong downtrend → suppress all BUY signals
 *   |CMO| < 20 → trendless/ranging → only mean-reversion entries valid
 */
export function cmo(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN)
  for (let i = period; i < closes.length; i++) {
    let up = 0, down = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1]
      if (d > 0) up += d
      else if (d < 0) down += Math.abs(d)
    }
    const denom = up + down
    out[i] = denom > 0 ? 100 * (up - down) / denom : 0
  }
  return out
}

/**
 * Omega ratio — measures strategy edge without assuming return normality.
 * Omega(τ) = Σ max(r_i − τ, 0) / Σ max(τ − r_i, 0)
 * Omega > 1.0 = strategy beats threshold. > 1.5 = strong edge.
 * Ideal for low-frequency strategies where the Gaussian assumption breaks down.
 */
export function omegaRatio(returns: number[], threshold = 0.04 / 252): number | null {
  const gains = returns.reduce((s, r) => s + Math.max(0, r - threshold), 0)
  const losses = returns.reduce((s, r) => s + Math.max(0, threshold - r), 0)
  if (losses < 1e-12) return gains > 0 ? Infinity : null
  return gains / losses
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
  | 'OVERBOUGHT' | 'IN_TREND' | 'TREND_PULLBACK' | 'INSUFFICIENT_DATA'

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
 * Classify price regime based on 200-SMA + 50-EMA deviation and slope.
 *
 * Phase 2 addition: HEALTHY_BULL_DIP zone — buy 50-EMA pullbacks in uptrends.
 * This captures "buy the dip in a bull market" setups when price is above 200-SMA
 * but has pulled back to 50-EMA support (Elder Triple Screen / Guppy method).
 *
 * Deviation zones (price vs 200SMA):
 *   >+20%  EXTREME_BULL       → HOLD (overbought, don't chase)
 *   >+10%  EXTENDED_BULL      → HOLD
 *   0-10%  HEALTHY_BULL       → BUY if 50-EMA pullback (dev50 < -2%) + slope positive
 *   0-10%  HEALTHY_BULL       → HOLD otherwise
 *   -10 to 0%  FIRST_DIP      → BUY if slope > threshold AND price was near SMA
 *   -20 to -10% DEEP_DIP      → BUY if slope > threshold AND price was near SMA
 *   -30 to -20% BEAR_ALERT    → BUY only with strongest confirm
 *   <-30%  CRASH_ZONE         → HOLD/SELL
 */
export function regimeSignal(
  price: number,
  closes: number[],
  rsi14?: number,
  opts?: {
    smaSlopeThreshold?: number
    smaSlopeLookback?: number
    priceProximityPct?: number
    enableHealthyBullDip?: boolean
  },
): RegimeSignal {
  if (closes.length < 200) {
    return {
      zone: 'INSUFFICIENT_DATA', dipSignal: 'INSUFFICIENT_DATA',
      deviationPct: null, slopePct: null, slopePositive: null,
      action: 'HOLD', confidence: 0, label: 'Insufficient Data',
    }
  }

  const slopeThr = opts?.smaSlopeThreshold ?? 0.005
  const proximityPct = opts?.priceProximityPct ?? 5
  const enableHBDip = opts?.enableHealthyBullDip ?? true

  const sma200val = sma(closes, 200)!
  const dev = sma200DeviationPct(price, sma200val)
  const slope = sma200Slope(closes)
  const slopePos = slope != null ? slope > slopeThr : null
  const nearSma = priceWasNearSmaRecently(closes, proximityPct)

  // ── Deviation-based zones ──────────────────────────────────────────────
  // EXTREME_BULL: >+20% — extremely extended, no buy
  if (dev != null && dev > 20) {
    return { zone: 'EXTREME_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 40, label: 'EXTREME_BULL' }
  }
  // EXTENDED_BULL: >+10% — extended, hold
  if (dev != null && dev > 10) {
    return { zone: 'EXTENDED_BULL', dipSignal: 'OVERBOUGHT', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 45, label: 'EXTENDED_BULL' }
  }
  // ── Phase 2: HEALTHY_BULL_DIP — buy 50-EMA pullbacks when price still above 200-SMA ──
  // Logic: price 0-10% above 200-SMA (uptrend) but pulled back ≥2% below 50-EMA.
  // This is the "Elder Triple Screen" / "buy the dip in bull market" pattern.
  if (dev != null && dev >= 0 && enableHBDip && slopePos === true) {
    const dev50 = ema50DeviationPct(price, closes)
    if (dev50 != null && dev50 < -2) {
      // Price is below 50-EMA support in an uptrend — valid pullback entry
      const conf = rsi14 != null && rsi14 < 45 ? 80 : 70
      return {
        zone: 'HEALTHY_BULL', dipSignal: 'TREND_PULLBACK',
        deviationPct: dev, slopePct: slope, slopePositive: slopePos,
        action: 'BUY', confidence: conf, label: 'HEALTHY_BULL',
      }
    }
  }
  // HEALTHY_BULL: 0 to +10% — above SMA, in trend, no new entry (unless pullback above)
  if (dev != null && dev >= 0) {
    return { zone: 'HEALTHY_BULL', dipSignal: 'IN_TREND', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 55, label: 'HEALTHY_BULL' }
  }

  // ── Dip zones (price below 200SMA) ────────────────────────────────────
  // Only buy dips if price was recently near SMA (not a "forever falling" stock)
  const canBuyDip = slopePos === true && nearSma

  // FIRST_DIP: -10% to 0% — mild pullback, primary buy zone
  if (dev != null && dev >= -10) {
    if (canBuyDip) {
      const conf = rsi14 != null && rsi14 < 35 ? 90 : 75
      return { zone: 'FIRST_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: conf, label: 'FIRST_DIP' }
    }
    return { zone: 'FIRST_DIP', dipSignal: 'WATCH_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'HOLD', confidence: 35, label: 'FIRST_DIP' }
  }

  // DEEP_DIP: -20% to -10% — meaningful correction, high-conviction buy zone
  if (dev != null && dev >= -20) {
    if (canBuyDip) {
      return { zone: 'DEEP_DIP', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 88, label: 'DEEP_DIP' }
    }
    return { zone: 'DEEP_DIP', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 82, label: 'DEEP_DIP' }
  }

  // BEAR_ALERT: -30% to -20% — severe drawdown, only buy with strongest confirm
  if (dev != null && dev >= -30) {
    if (canBuyDip) {
      return { zone: 'BEAR_ALERT', dipSignal: 'STRONG_DIP', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'BUY', confidence: 80, label: 'BEAR_ALERT' }
    }
    return { zone: 'BEAR_ALERT', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 90, label: 'BEAR_ALERT' }
  }

  // CRASH_ZONE: <-30% — crash territory, never buy
  return { zone: 'CRASH_ZONE', dipSignal: 'FALLING_KNIFE', deviationPct: dev, slopePct: slope, slopePositive: slopePos, action: 'SELL', confidence: 95, label: 'CRASH_ZONE' }
}

// ─── Combined signal ───────────────────────────────────────────────────────────

export interface BacktestConfig {
  initialCapital: number
  stopLossPct: number
  confidenceThreshold: number
  maxDrawdownCap: number
  halfKelly: boolean
  /** Max fraction of capital allocated to a new long (from strategy stopLoss / risk budget). */
  maxPositionWeight: number
  // ── Signal / regime tuning (passed to combinedSignal → regimeSignal) ────────
  /** RSI value at or below which the RSI confirmation is counted bullish. Default 40. */
  rsiOversold: number
  /** ATR% (ATR as % of price) above which ATR confirmation fires. Default 1.5. */
  atrPctThreshold: number
  /** Bollinger %B below which the BB confirmation fires (lower-band touch). Default 0.20. */
  bbPctThreshold: number
  /** Minimum 200-SMA slope (% over smaSlopeLookback bars) for dip-BUY eligibility. Default 0.001. */
  smaSlopeThreshold: number
  /** Number of bars over which to compute 200-SMA slope. Default 20. */
  smaSlopeLookback: number
  /** Price must have been within this % of the 200-SMA in the last 20 bars. Default 10. */
  priceProximityPct: number
  /** Minimum number of bullish confirmations (RSI/MACD/ATR/BB/ADX/StochRSI) required for a BUY. Default 2. */
  minBullishConfirms: number
  // ── Phase 2: New indicator thresholds ────────────────────────────────────────
  /** ADX threshold — below this value the market is ranging (no trend), skip BUY. Default 15.
   *  Set 0 to disable ADX filter (allow all entries regardless of trend strength). */
  adxThreshold: number
  /** StochRSI oversold threshold — at or below this value StochRSI confirms bullish. Default 0.30. */
  stochRsiOversold: number
  /** Minimum 12-month Rate of Change (ROC) for positive momentum. Default -10 (off).
   *  Set > 0 (e.g. 5) to require positive long-term momentum (avoids value traps). */
  roc252Threshold: number
  /** Relative volume (RVOL) threshold — RVOL above this confirms volume participation. Default 0.8.
   *  Set 0 to disable volume filter. */
  rvolThreshold: number
  /** Enable HEALTHY_BULL_DIP zone: buy 50-EMA pullbacks when above 200-SMA. Default true. */
  enableHealthyBullDip: boolean
  // ── Phase 3 (2026-04-25): Breakout entry path ─────────────────────────────
  /** Enable breakout confirmation signal. */
  enableBreakoutEntry: boolean
  /** Min % pullback from 252-bar high. */
  breakoutMinPullbackPct: number
  /** Max % pullback from 252-bar high. */
  breakoutMaxPullbackPct: number
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 100_000,
  // stopLossPct is now ATR-adaptive in the engine (1.5x ATR, capped 5-15%).
  // This config value serves as the floor for the ATR formula.
  stopLossPct: 0.10,
  confidenceThreshold: 55,
  maxDrawdownCap: 0.25,
  halfKelly: true,
  maxPositionWeight: 0.5,
  // ── Phase 1 optimised signal parameters (grid-search April 2026, 5y 16-instrument) ──
  // Best combo: 56.9% win rate, +0.45% ann, 3.5% maxDD across 15/16 instruments.
  rsiOversold: 40,          // was 35 — slightly relaxed for more signals
  atrPctThreshold: 1.5,     // was 2.0 — fire on lower volatility too
  bbPctThreshold: 0.20,     // unchanged
  smaSlopeThreshold: 0.001, // was 0.005 — key change: allow near-flat 200-SMA slopes
  smaSlopeLookback: 20,     // unchanged
  priceProximityPct: 10,    // was 5 — more forgiving proximity check
  minBullishConfirms: 2,    // unchanged
  // ── Phase 2: Grid-search optimised defaults (April 2026, 20-ticker × 6y real data) ──
  // Winning config on real-data grid: adx=20, stoch=0.20, HBD=off.
  // OOS Sharpe −0.36 (vs −0.99 prior baseline), overfitting 0.08 (vs 0.51).
  // After Phase 3 breakout added, grid shows adx=15/stoch=0.30 is best since
  // breakout path provides its own trend confirmation — tighter ADX over-filters.
  adxThreshold: 15,
  stochRsiOversold: 0.30,
  roc252Threshold: -10,     // -10 = off (allow any long-term momentum direction)
  rvolThreshold: 0.8,       // RVOL > 0.8 (retained; grid shows no discriminating power)
  enableHealthyBullDip: false, // Disabled — grid shows it adds overfitting without OOS gain.
  // ── Phase 3 (2026-04-25): Breakout entry path ─────────────────────────────
  /** Enable Minervini-style breakout confirmation: price within X% of 252-bar high,
   *  above 200-SMA. Adds to bullishCount pool. Default true. */
  enableBreakoutEntry: true,
  /** Min pullback from 252-bar high to qualify. Default 1 (grid-optimised 2026-04-25). */
  breakoutMinPullbackPct: 1,
  /** Max pullback from 252-bar high. Default 12 (grid shows >15 catches falling knives). */
  breakoutMaxPullbackPct: 12,
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
 * Combined signal — Phase 2 upgrade with 7 confirmations.
 *
 * Confirmation signals (any subset can qualify):
 *   1. RSI(14)      < rsiOversold             (classic oversold)
 *   2. MACD hist    > 0                        (momentum turning up)
 *   3. ATR%         > atrPctThreshold          (sufficient volatility for swing trade)
 *   4. Bollinger%B  < bbPctThreshold           (near lower band)
 *   5. ADX(14)      > adxThreshold             (trending market, not ranging/chop)
 *   6. StochRSI(14) < stochRsiOversold         (sensitive oversold momentum)
 *   7. RVOL         > rvolThreshold            (above-average volume = institutional buy)
 *
 * ROC(252) acts as a hard gate (if enabled): negative 12-month momentum blocks BUY.
 * This implements the Carhart momentum factor — avoids buying persistent losers.
 *
 * HEALTHY_BULL_DIP regime: adds 50-EMA pullback setups for instruments in uptrends.
 * Significantly increases trade frequency without sacrificing quality.
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

  // ── Compute all indicators ──────────────────────────────────────────────
  const rsiVals    = rsi(closes)
  const macdVals   = macdFn(closes)
  const atrVals    = atr(bars)
  const bbVals     = bollinger(closes)
  const adxVals    = adx(bars)
  const stochVals  = stochRsi(closes)
  const rocVals    = roc(closes, 252)
  const volumes    = bars.map(b => (b as { volume?: number }).volume ?? 0)
  const rvolVals   = relativeVolume(volumes)

  const rsi14      = rsiVals[rsiVals.length - 1]
  const macdHist   = macdVals.histogram[macdVals.histogram.length - 1]
  const atrLast    = atrVals[atrVals.length - 1]
  const bbPctB     = bbVals.pctB[bbVals.pctB.length - 1]
  const adxLast    = adxVals.adx[adxVals.adx.length - 1]
  const plusDI     = adxVals.plusDI[adxVals.plusDI.length - 1]
  const minusDI    = adxVals.minusDI[adxVals.minusDI.length - 1]
  const stochLast  = stochVals[stochVals.length - 1]
  const rocLast    = rocVals[rocVals.length - 1]
  const rvolLast   = rvolVals[rvolVals.length - 1]

  // ATR as percentage of price — normalised across all price levels
  const atrPct = Number.isFinite(atrLast) && price > 0 ? (atrLast / price) * 100 : NaN

  // ── Regime classification (with Phase 2 HEALTHY_BULL_DIP) ──────────────
  const regime = regimeSignal(price, closes, rsi14, {
    smaSlopeThreshold:    cfg.smaSlopeThreshold,
    smaSlopeLookback:     cfg.smaSlopeLookback,
    priceProximityPct:    cfg.priceProximityPct,
    enableHealthyBullDip: cfg.enableHealthyBullDip,
  })

  // ── Individual confirmation signals ────────────────────────────────────
  const rsiBullish     = Number.isFinite(rsi14)     && rsi14    < cfg.rsiOversold
  const macdBullish    = Number.isFinite(macdHist)   && macdHist > 0
  const atrBullish     = Number.isFinite(atrPct)     && atrPct   > cfg.atrPctThreshold
  const bbBullish      = Number.isFinite(bbPctB)     && bbPctB   < cfg.bbPctThreshold
  // ADX: trend must be strong AND +DI > -DI (upward direction)
  const adxBullish     = cfg.adxThreshold > 0
    ? Number.isFinite(adxLast)  && adxLast  > cfg.adxThreshold &&
      Number.isFinite(plusDI)   && Number.isFinite(minusDI) && plusDI > minusDI
    : false
  const stochBullish   = Number.isFinite(stochLast)  && stochLast < cfg.stochRsiOversold
  // RVOL: require above-threshold volume (skip if threshold is 0 = disabled)
  const rvolBullish    = cfg.rvolThreshold > 0
    ? Number.isFinite(rvolLast) && rvolLast > cfg.rvolThreshold
    : false

  // ── Phase 3: Breakout entry (Minervini-style new-high pullback) ─────────
  // Fires when price is a modest pullback from a recent 252-bar high AND above 200-SMA.
  // Captures trend-continuation setups the dip-only regime logic misses.
  let breakoutBullish = false
  let recentHighPullbackPct: number | null = null
  if (cfg.enableBreakoutEntry && bars.length >= 252) {
    const highs = bars.slice(-252).map(b => b.high)
    const lookbackHigh = Math.max(...highs)
    if (Number.isFinite(lookbackHigh) && lookbackHigh > 0) {
      recentHighPullbackPct = ((lookbackHigh - price) / lookbackHigh) * 100
      const aboveSMA200 = regime.deviationPct !== null && regime.deviationPct !== undefined && regime.deviationPct > 0
      breakoutBullish =
        recentHighPullbackPct >= cfg.breakoutMinPullbackPct &&
        recentHighPullbackPct <= cfg.breakoutMaxPullbackPct &&
        aboveSMA200
    }
  }

  // ── Hard gates (block BUY regardless of confirmations) ─────────────────
  // Momentum gate: if ROC(252) is enabled and negative, skip (Carhart factor)
  const momentumBlocked = cfg.roc252Threshold > -100 && Number.isFinite(rocLast) && rocLast < cfg.roc252Threshold

  // Count bullish confirmations from the 8-signal panel (7 + Phase 3 breakout)
  const bullishCount =
    (rsiBullish      ? 1 : 0) +
    (macdBullish     ? 1 : 0) +
    (atrBullish      ? 1 : 0) +
    (bbBullish       ? 1 : 0) +
    (adxBullish      ? 1 : 0) +
    (stochBullish    ? 1 : 0) +
    (rvolBullish     ? 1 : 0) +
    (breakoutBullish ? 1 : 0)

  // ── Apply confirmation filter and hard gates ───────────────────────────
  let action: 'BUY' | 'HOLD' | 'SELL' = regime.action

  if (action === 'BUY' && bullishCount < cfg.minBullishConfirms) action = 'HOLD'
  if (action === 'BUY' && momentumBlocked) action = 'HOLD'

  // Exit overbought: RSI > 70 in HEALTHY_BULL zone
  if (action === 'HOLD' && regime.zone === 'HEALTHY_BULL' && regime.dipSignal === 'IN_TREND' &&
      Number.isFinite(rsi14) && rsi14 > 70) {
    action = 'SELL'
  }

  // Phase 3: Breakout can promote HOLD → BUY in HEALTHY_BULL_IN_TREND when
  // regime is "holding trend" but breakout confirms + minimum other confirms.
  if (action === 'HOLD' && breakoutBullish && regime.zone === 'HEALTHY_BULL' &&
      bullishCount >= Math.max(2, cfg.minBullishConfirms) && !momentumBlocked) {
    action = 'BUY'
  }

  // Confidence: base regime confidence + (confirms / max) × 25pts bonus
  const maxConfirms = (cfg.adxThreshold > 0 ? 5 : 4) + (cfg.enableBreakoutEntry ? 1 : 0)
  const confidence = Math.min(100, regime.confidence + Math.round((Math.min(bullishCount, maxConfirms) / maxConfirms) * 25))
  if (confidence < cfg.confidenceThreshold && action !== 'SELL') action = 'HOLD'

  // ── Kelly fraction — mathematically grounded sizing (Phase 2) ──────────
  // Maps signal confidence → implied win probability → Kelly f*
  // winProb: confidence at threshold → 0.45, at 100 → 0.75 (linear)
  // b (avg win / avg loss): 1.5 (conservative implied ratio for swing trades)
  // Mode: full/half/quarter Kelly, clamped to maxPositionWeight
  let kellyFrac = 0.10
  if (action === 'BUY') {
    const minConf = cfg.confidenceThreshold   // e.g. 55
    const winProb = Math.max(0.40, Math.min(0.75,
      0.40 + Math.max(0, confidence - minConf) / (100 - minConf) * 0.35
    ))
    // Implied avg win / avg loss: 1.5 for standard dips, 2.0 for high-conviction
    // kellyFraction(p, avgWin, avgLoss) uses b = avgWin/avgLoss internally
    // Passing (b, 1) normalises: avgWin=b, avgLoss=1 → b ratio = b/1 = b
    const isHighConviction = (regime.dipSignal === 'STRONG_DIP' || regime.dipSignal === 'TREND_PULLBACK') && bullishCount >= 3
    const b = isHighConviction ? 2.0 : 1.5
    const rawKelly = kellyFraction(winProb, b, 1) ?? 0.10
    const sized = cfg.halfKelly ? rawKelly / 2 : rawKelly
    kellyFrac = Math.max(0.05, Math.min(sized, cfg.maxPositionWeight))
    // NOTE: Volatility-regime Kelly scaling was tested (2026-04-25) and
    // hurt OOS Sharpe from −0.12 → −0.20 despite improving maxDD. Not promoted.
    // See docs/SESSION_PROGRESS_2026-04-25.md for Priority 1 notes.
  } else if (action === 'SELL') {
    kellyFrac = 1.0
  }

  // ── Reason string ──────────────────────────────────────────────────────
  const confLabels = [
    Number.isFinite(rsi14)    && rsiBullish    ? `RSI ${rsi14.toFixed(1)}`              : null,
    Number.isFinite(macdHist) && macdBullish   ? `MACD+${macdHist.toFixed(2)}`           : null,
    Number.isFinite(atrPct)   && atrBullish    ? `ATR%${atrPct.toFixed(1)}`              : null,
    Number.isFinite(bbPctB)   && bbBullish     ? `BB${(bbPctB * 100).toFixed(0)}%`       : null,
    Number.isFinite(adxLast)  && adxBullish    ? `ADX${adxLast.toFixed(0)}`              : null,
    Number.isFinite(stochLast)&& stochBullish  ? `StRSI${(stochLast * 100).toFixed(0)}%`: null,
    Number.isFinite(rvolLast) && rvolBullish   ? `RVOL${rvolLast.toFixed(1)}x`           : null,
  ].filter(Boolean)

  const reason = action === 'BUY'
    ? `${regime.zone}[${regime.dipSignal}] ${deviationLabel(regime.deviationPct)} vs 200SMA. ${confLabels.join(' ')||'basic'} (${bullishCount}/${maxConfirms}). Kelly${(kellyFrac*100).toFixed(0)}%.`
    : action === 'SELL'
    ? `${regime.zone}[${regime.dipSignal}]: exit. ${confLabels.join(' ')||'—'}.`
    : `${regime.zone}[${regime.dipSignal}]: hold (conf ${confidence}%<${cfg.confidenceThreshold}%${momentumBlocked?' +momBlock':''}).`

  return {
    ticker, date, price, regime,
    confirms: [
      { name: 'RSI(14)',    value: Number.isFinite(rsi14)    ? rsi14    : null, bullish: rsiBullish  },
      { name: 'MACD hist',  value: Number.isFinite(macdHist) ? macdHist : null, bullish: macdBullish },
      { name: 'ATR%',       value: Number.isFinite(atrPct)   ? atrPct   : null, bullish: atrBullish  },
      { name: 'BB%B',       value: Number.isFinite(bbPctB)   ? bbPctB   : null, bullish: bbBullish   },
      { name: 'ADX(14)',    value: Number.isFinite(adxLast)  ? adxLast  : null, bullish: adxBullish  },
      { name: 'StochRSI',  value: Number.isFinite(stochLast) ? stochLast : null, bullish: stochBullish},
      { name: 'RVOL',       value: Number.isFinite(rvolLast) ? rvolLast : null, bullish: rvolBullish },
    ],
    action, confidence, KellyFraction: kellyFrac, reason,
  }
}

function deviationLabel(dev: number | null): string {
  if (dev === null) return '?'
  if (dev >= 0) return `+${dev.toFixed(1)}%`
  return `${dev.toFixed(1)}%`
}
