/**
 * BTC-specific quantitative indicators and on-chain models.
 *
 * Phase 13 S2 fix (F-NEW HIGH): the seven inline indicator implementations
 * (calcEMA, calcRSI, calcMACD, calcBollingerBands, calcVWAP, calcStochRSI,
 * calcATR) that previously lived here were a SSOT violation with
 * `lib/quant/indicators.ts`. They are now thin adapters that delegate to
 * the canonical implementations — Phase 12+ algorithm fixes (Wilder
 * smoothing, sample variance, MACD warmup gate, n_d Sortino, OBV
 * length-mismatch throw) flow through automatically.
 *
 * What this module *does* still own (genuinely BTC-specific, no equity
 * counterpart):
 *   • MVRV ratio
 *   • Pi Cycle Top
 *   • Stock-to-Flow price
 *   • Difficulty Ribbon
 *   • generateSignals (BTC-specific signal pack including funding rate
 *     and Fear & Greed)
 *   • btcRegime (price-vs-EMA200 + RSI extreme regime classifier)
 */

import {
  emaFull,
  rsiArray,
  macdArray,
  bollingerArray,
  atrArray,
  smaArray,
  obvArray,
  vwapArray,
  stochRsiArray,
  adxArray,
  type OhlcBar,
} from './indicators'
import { PERP_FUNDING_HIGH_ABS } from './fundingConstants'

export interface BtcCandle {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function toBars(candles: BtcCandle[]): OhlcBar[] {
  return candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))
}

// ─── Price-based indicators (canonical adapters) ────────────────────────────

export function calcEMA(prices: number[], period: number): number[] {
  return emaFull(prices, period)
}

export function calcRSI(prices: number[], period = 14): number[] {
  return rsiArray(prices, period)
}

interface MacdRow { macd: number; signal: number; histogram: number }

export function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9): MacdRow[] {
  const { line, signal: sig, histogram } = macdArray(prices, fast, slow, signal)
  return prices.map((_, i) => ({
    macd: line[i],
    signal: sig[i],
    histogram: histogram[i],
  }))
}

interface BollingerRow { mid: number; upper: number; lower: number }

export function calcBollingerBands(prices: number[], period = 20, stdDev = 2): BollingerRow[] {
  const { mid, upper, lower } = bollingerArray(prices, period, stdDev)
  return prices.map((_, i) => ({
    mid: mid[i],
    upper: upper[i],
    lower: lower[i],
  }))
}

export function calcVWAP(candles: BtcCandle[]): { time: number; value: number }[] {
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  const values = vwapArray(highs, lows, closes, volumes)
  return candles.map((c, i) => ({
    time: typeof c.time === 'string' ? Math.floor(new Date(c.time).getTime() / 1000) : c.time,
    value: values[i],
  }))
}

export function calcStochRSI(prices: number[], period = 14, _k = 3, _d = 3) {
  // Canonical stochRsiArray uses period+kSmooth+dSmooth signature; mirror with defaults.
  return stochRsiArray(prices, period, _k, _d)
}

export function calcATR(candles: BtcCandle[], period = 14): number[] {
  return atrArray(toBars(candles), period)
}

// ─── Volume analysis ───────────────────────────────────────────────────────────

export function calcOBV(candles: BtcCandle[]): number[] {
  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  return obvArray(closes, volumes)
}

/**
 * Volume-Weighted Moving Average — short-period weighted mean. Genuinely
 * BTC-specific (no canonical counterpart yet); kept inline.
 */
export function calcVWMA(candles: BtcCandle[], period = 20): number[] {
  const result: number[] = new Array(candles.length).fill(NaN)
  for (let i = period - 1; i < candles.length; i++) {
    let sumPV = 0, sumV = 0
    for (let j = 0; j < period; j++) {
      const idx = i - j
      sumPV += candles[idx].close * candles[idx].volume
      sumV += candles[idx].volume
    }
    result[i] = sumV > 0 ? sumPV / sumV : candles[i].close
  }
  return result
}

/** ADX — delegates to canonical adxArray (carries any future Wilder-smoothing fixes). */
export function calcADX(candles: BtcCandle[], period = 14) {
  const { adx, plusDI, minusDI } = adxArray(toBars(candles), period)
  return { adx, plusDI, minusDI }
}

// ─── On-chain / model indicators ─────────────────────────────────────────────

/** MVRV — Market Value vs Realized Cap ratio */
export function calcMVRV(price: number, realizedCap: number): number {
  return realizedCap > 0 ? price / realizedCap : 1
}

/**
 * Pi Cycle Top indicator — approximate.
 *
 * Original Pi Cycle (Philip Swift, 2019) uses 111-DAY SMA crossing 350-DAY
 * SMA × 2. This function takes pre-computed EMAs as inputs because callers
 * already have those handy from other indicators; document the divergence
 * to make the convention explicit.
 */
export function calcPiCycleTop(ema111: number, ema350: number, multi = 2): boolean {
  return ema111 > ema350 * multi
}

/** Stock-to-Flow model price (PlanB power-law approximation, simplified). */
export function calcS2FPrice(totalS2F: number): number {
  return Math.pow(totalS2F, 3) * 0.001
}

/**
 * Difficulty Ribbon compression — indicates miner capitulation.
 *
 * Phase 13 S2 fix: previous implementation seeded each ribbon EMA from
 * `closes.slice(-p * 2)` — independent of the long-term price path.
 * Now computes each EMA on the full series (canonical emaFull) and reads
 * the latest value, so the ribbon reflects continuous EMA values. The
 * inversion check (8-period EMA below 256-period EMA) is unchanged.
 */
export function calcDifficultyRibbon(candles: BtcCandle[], periods = [8, 16, 32, 64, 128, 256]): boolean {
  if (candles.length < 256) return false
  const closes = candles.map((c) => c.close)
  const ribbons = periods.map((p) => {
    const ema = emaFull(closes, p)
    return ema[ema.length - 1]
  })
  // Ribbon compression: short-term EMA below long-term = miner capitulation
  return ribbons[0] < ribbons[ribbons.length - 1]
}

// ─── Signal generation ────────────────────────────────────────────────────────

export type Signal = 'BUY' | 'SELL' | 'HOLD'

export interface IndicatorSignal {
  indicator: string
  signal: Signal
  strength: number   // 0-100
  description: string
}

export function generateSignals(candles: BtcCandle[], fundingRate?: number, fearGreed?: number): IndicatorSignal[] {
  const closes = candles.map((c) => c.close)
  if (closes.length < 55) return []

  const rsi = calcRSI(closes)
  const macd = calcMACD(closes)
  const bb = calcBollingerBands(closes)
  const ema20 = calcEMA(closes, 20)
  const ema50 = calcEMA(closes, 50)
  const latestRSI = rsi[rsi.length - 1]
  const latestMACD = macd[macd.length - 1]
  const latestBB = bb[bb.length - 1]
  const latestEMA20 = ema20[ema20.length - 1]
  const latestEMA50 = ema50[ema50.length - 1]
  const latestClose = closes[closes.length - 1]
  const signals: IndicatorSignal[] = []

  if (
    !Number.isFinite(latestRSI) ||
    !Number.isFinite(latestClose) ||
    !Number.isFinite(latestEMA20) ||
    !Number.isFinite(latestEMA50)
  ) {
    return []
  }

  // RSI
  if (latestRSI < 30) signals.push({ indicator: 'RSI(14)', signal: 'BUY', strength: Math.round((30 - latestRSI) / 30 * 100), description: `Oversold at ${latestRSI.toFixed(1)}` })
  else if (latestRSI > 70) signals.push({ indicator: 'RSI(14)', signal: 'SELL', strength: Math.round((latestRSI - 70) / 30 * 100), description: `Overbought at ${latestRSI.toFixed(1)}` })
  else signals.push({ indicator: 'RSI(14)', signal: 'HOLD', strength: 50, description: `Neutral at ${latestRSI.toFixed(1)}` })

  // MACD (skip if not converged — avoids flip-flopping on NaN)
  const hist = latestMACD.histogram
  if (Number.isFinite(hist)) {
    if (hist > 0) signals.push({ indicator: 'MACD', signal: 'BUY', strength: 60, description: 'MACD histogram positive' })
    else if (hist < 0) signals.push({ indicator: 'MACD', signal: 'SELL', strength: 60, description: 'MACD histogram negative' })
  }

  // EMA Cross with minimum threshold (1%) to avoid noise
  const emaCrossPct = ((latestEMA20 - latestEMA50) / latestEMA50) * 100
  if (emaCrossPct > 1) {
    signals.push({ indicator: 'EMA Cross', signal: 'BUY', strength: 70, description: `EMA20 ($${latestEMA20.toFixed(0)}) > EMA50 ($${latestEMA50.toFixed(0)}) by ${emaCrossPct.toFixed(1)}%` })
  } else if (emaCrossPct < -1) {
    signals.push({ indicator: 'EMA Cross', signal: 'SELL', strength: 70, description: `EMA20 ($${latestEMA20.toFixed(0)}) < EMA50 ($${latestEMA50.toFixed(0)}) by ${Math.abs(emaCrossPct).toFixed(1)}%` })
  } else {
    signals.push({ indicator: 'EMA Cross', signal: 'HOLD', strength: 30, description: `EMA20 ($${latestEMA20.toFixed(0)}) and EMA50 ($${latestEMA50.toFixed(0)}) within 1% — no clear cross` })
  }

  // Bollinger Bands
  if (
    Number.isFinite(latestBB.lower) &&
    Number.isFinite(latestBB.upper) &&
    latestBB.upper != null &&
    latestBB.lower != null
  ) {
    if (latestClose < latestBB.lower) signals.push({ indicator: 'Bollinger Bands', signal: 'BUY', strength: 65, description: 'Price below lower BB band' })
    else if (latestClose > latestBB.upper) signals.push({ indicator: 'Bollinger Bands', signal: 'SELL', strength: 65, description: 'Price above upper BB band' })
    else signals.push({ indicator: 'Bollinger Bands', signal: 'HOLD', strength: 40, description: 'Price within BB bands' })
  }

  // Funding Rate (Binance decimal scale — see lib/quant/fundingConstants.ts)
  if (fundingRate != null && Number.isFinite(fundingRate)) {
    if (fundingRate > PERP_FUNDING_HIGH_ABS) {
      signals.push({
        indicator: 'Funding Rate',
        signal: 'SELL',
        strength: 75,
        description: `Elevated positive funding (${(fundingRate * 100).toFixed(4)}% / interval) — longs pay shorts (crowding)`,
      })
    } else if (fundingRate < -PERP_FUNDING_HIGH_ABS) {
      signals.push({
        indicator: 'Funding Rate',
        signal: 'BUY',
        strength: 75,
        description: `Elevated negative funding (${(fundingRate * 100).toFixed(4)}% / interval) — shorts pay longs (crowding)`,
      })
    }
  }

  // Fear & Greed
  if (fearGreed != null) {
    if (fearGreed < 25) signals.push({ indicator: 'Fear & Greed', signal: 'BUY', strength: 80, description: `Extreme Fear (${fearGreed}) — contrarian buy signal` })
    else if (fearGreed > 75) signals.push({ indicator: 'Fear & Greed', signal: 'SELL', strength: 80, description: `Extreme Greed (${fearGreed}) — contrarian sell signal` })
  }

  return signals
}

// ─── Regime classification ───────────────────────────────────────────────────

export type BtcRegimeLabel =
  | 'STRONG_BULL'
  | 'BULL'
  | 'NEUTRAL'
  | 'BEAR'
  | 'STRONG_BEAR'
  | 'CAPITULATION'
  | 'EUPHORIA'

export interface BtcRegime {
  regime: BtcRegimeLabel
  confidence: number
  reasons: string[]
  metrics: {
    pctVsEma200: number | null
    ema50: number | null
    ema200: number | null
    rsi14: number | null
    atrPct: number | null
  }
}

export interface BtcRegimeOptions {
  fastPeriod?: number
  slowPeriod?: number
  rsiPeriod?: number
  atrPeriod?: number
}

/**
 * Classify Bitcoin into a regime. Pure function over candles (oldest → newest).
 * Trend axis: % distance of close from EMA-slow (default 200).
 * EUPHORIA / CAPITULATION are end-of-trend exhaustion states gated by RSI extremes.
 */
export function btcRegime(candles: BtcCandle[], opts: BtcRegimeOptions = {}): BtcRegime {
  const fast = opts.fastPeriod ?? 50
  const slow = opts.slowPeriod ?? 200
  const rsiP = opts.rsiPeriod ?? 14
  const atrP = opts.atrPeriod ?? 14

  const empty: BtcRegime = {
    regime: 'NEUTRAL',
    confidence: 0,
    reasons: ['insufficient data'],
    metrics: { pctVsEma200: null, ema50: null, ema200: null, rsi14: null, atrPct: null },
  }
  if (candles.length < slow) return empty

  const closes = candles.map((c) => c.close)
  const last = closes[closes.length - 1]
  if (!Number.isFinite(last) || last <= 0) return empty

  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)
  const rsiArr = calcRSI(closes, rsiP)
  const atrArr = calcATR(candles, atrP)

  const ema50 = emaFast[emaFast.length - 1]
  const ema200 = emaSlow[emaSlow.length - 1]
  const rsi14 = rsiArr[rsiArr.length - 1]
  const atr = atrArr[atrArr.length - 1]

  if (!Number.isFinite(ema200) || ema200 <= 0) return empty

  // Use epsilon tolerance to avoid floating-point artefacts (e.g. -2.9e-16 for flat series)
  const pctRaw = (last - ema200) / ema200
  const pct = Math.abs(pctRaw) < 1e-10 ? 0 : pctRaw
  const atrPct = Number.isFinite(atr) && atr > 0 ? atr / last : null
  const reasons: string[] = []

  let regime: BtcRegimeLabel = 'NEUTRAL'

  if (pct > 0.20 && Number.isFinite(rsi14) && rsi14 > 80) {
    regime = 'EUPHORIA'
    reasons.push(`Price ${(pct * 100).toFixed(1)}% above 200EMA + RSI ${rsi14.toFixed(0)} > 80`)
  } else if (pct < -0.20 && Number.isFinite(rsi14) && rsi14 < 20) {
    regime = 'CAPITULATION'
    reasons.push(`Price ${(pct * 100).toFixed(1)}% below 200EMA + RSI ${rsi14.toFixed(0)} < 20`)
  } else if (pct > 0.10) {
    regime = 'STRONG_BULL'
    reasons.push(`Price ${(pct * 100).toFixed(1)}% above 200EMA`)
  } else if (pct < -0.10) {
    regime = 'STRONG_BEAR'
    reasons.push(`Price ${(pct * 100).toFixed(1)}% below 200EMA`)
  } else if (pct > 0 && Number.isFinite(ema50) && ema50 > ema200) {
    regime = 'BULL'
    reasons.push(`Price above 200EMA, 50EMA > 200EMA`)
  } else if (pct < 0 && Number.isFinite(ema50) && ema50 < ema200) {
    regime = 'BEAR'
    reasons.push(`Price below 200EMA, 50EMA < 200EMA`)
  } else {
    reasons.push(`Price within ±10% of 200EMA, no strong cross signal`)
  }

  // Confidence: calmer markets give higher confidence in the regime label.
  // Non-linear scaling: confidence saturates at low ATR%, drops faster at high ATR%.
  // atrPct=0.5% → ~95, atrPct=1% → 88, atrPct=2% → 75, atrPct=5% → 35, atrPct=8% → 0.
  const confidence = atrPct != null
    ? Math.round(100 * Math.pow(Math.max(0, 1 - atrPct / 0.08), 1.3))
    : 50

  return {
    regime,
    confidence,
    reasons,
    metrics: {
      pctVsEma200: pct,
      ema50: Number.isFinite(ema50) ? ema50 : null,
      ema200: Number.isFinite(ema200) ? ema200 : null,
      rsi14: Number.isFinite(rsi14) ? rsi14 : null,
      atrPct,
    },
  }
}

// ─── Re-export canonical SMA so consumers don't reach across libraries ───────
export { smaArray as calcSMA }
