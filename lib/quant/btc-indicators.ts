/**
 * BTC-specific quantitative indicators and models.
 * All functions are pure — no network calls, no side effects.
 */

import { PERP_FUNDING_HIGH_ABS } from './fundingConstants'

export interface BtcCandle {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ─── Price-based indicators ──────────────────────────────────────────────────

export function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const ema: number[] = new Array(prices.length).fill(NaN)
  if (prices.length < period) return ema
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  ema[period - 1] = prev
  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k)
    ema[i] = prev
  }
  return ema
}

export function calcRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = new Array(prices.length).fill(NaN)
  if (prices.length < period + 1) return rsi
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) avgGain += diff
    else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

export function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9) {
  const result = new Array(prices.length).fill({ macd: NaN, signal: NaN, histogram: NaN })
  if (prices.length < slow) return result
  const fastEma = calcEMA(prices, fast)
  const slowEma = calcEMA(prices, slow)
  for (let i = slow - 1; i < prices.length; i++) result[i] = { macd: fastEma[i] - slowEma[i], signal: NaN, histogram: NaN }
  const validMacd = result.map(r => r.macd).slice(slow - 1)
  const signalEma = calcEMA(validMacd, signal)
  for (let i = 0; i < signalEma.length; i++) {
    const idx = i + slow - 1
    const m = result[idx].macd
    const s = signalEma[i]
    result[idx] = { macd: m, signal: s, histogram: !isNaN(m) && !isNaN(s) ? m - s : NaN }
  }
  return result
}

export function calcBollingerBands(prices: number[], period = 20, stdDev = 2) {
  const result = new Array(prices.length).fill({ mid: NaN, upper: NaN, lower: NaN })
  if (prices.length < period) return result
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    result[i] = { mid: mean, upper: mean + stdDev * Math.sqrt(variance), lower: mean - stdDev * Math.sqrt(variance) }
  }
  return result
}

export function calcVWAP(candles: BtcCandle[]): { time: number; value: number }[] {
  let cumulativeTPV = 0, cumulativeVol = 0
  return candles.map(c => {
    const tpv = ((c.high + c.low + c.close) / 3) * c.volume
    cumulativeTPV += tpv
    cumulativeVol += c.volume
    const t = typeof c.time === 'string' ? Math.floor(new Date(c.time).getTime() / 1000) : c.time
    return { time: t, value: cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : NaN }
  })
}

export function calcStochRSI(prices: number[], period = 14, k = 3, d = 3) {
  const rsi = calcRSI(prices, period)
  const stoch: number[] = new Array(prices.length).fill(NaN)
  if (prices.length < period * 2) return { k: stoch, d: stoch }
  for (let i = period; i < prices.length; i++) {
    const window = rsi.slice(i - period + 1, i + 1)
    const minR = Math.min(...window)
    const maxR = Math.max(...window)
    stoch[i] = maxR - minR > 0 ? ((rsi[i] - minR) / (maxR - minR)) * 100 : 50
  }
  const kLine = calcEMA(stoch, k)
  const dLine = calcEMA(kLine, d)
  return { k: kLine, d: dLine }
}

export function calcATR(candles: BtcCandle[], period = 14): number[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low
    const hl = c.high - c.low
    const hC = Math.abs(c.high - candles[i - 1].close)
    const lC = Math.abs(c.low - candles[i - 1].close)
    return Math.max(hl, hC, lC)
  })
  return calcEMA(tr, period)
}

// ─── Volume analysis ───────────────────────────────────────────────────────────

export function calcOBV(candles: BtcCandle[]): number[] {
  let cumulative = 0
  return candles.map((c, i) => {
    if (i === 0) return 0
    const prevClose = candles[i - 1].close
    if (c.close > prevClose) cumulative += c.volume
    else if (c.close < prevClose) cumulative -= c.volume
    return cumulative
  })
}

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

export function calcADX(candles: BtcCandle[], period = 14) {
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low
    const hPH = Math.abs(candles[i].high - candles[i - 1].close)
    const lPC = Math.abs(candles[i].low - candles[i - 1].close)
    tr.push(Math.max(hl, hPH, lPC))
    plusDM.push(candles[i].high - candles[i - 1].high > candles[i - 1].low - candles[i].low && candles[i].high - candles[i - 1].high > 0 ? candles[i].high - candles[i - 1].high : 0)
    minusDM.push(candles[i - 1].low - candles[i].low > candles[i].high - candles[i - 1].high && candles[i - 1].low - candles[i].low > 0 ? candles[i - 1].low - candles[i].low : 0)
  }
  const trSmooth = calcEMA(tr, period)
  const plusDISmooth = calcEMA(plusDM, period)
  const minusDISmooth = calcEMA(minusDM, period)
  const adx: number[] = new Array(candles.length).fill(NaN)
  for (let i = period; i < candles.length; i++) {
    const plusDI = trSmooth[i] > 0 ? (plusDISmooth[i] / trSmooth[i]) * 100 : 0
    const minusDI = trSmooth[i] > 0 ? (minusDISmooth[i] / trSmooth[i]) * 100 : 0
    const dx = plusDI + minusDI > 0 ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0
    adx[i] = dx
  }
  const adxSmooth = calcEMA(adx, period)
  return { adx: adxSmooth, plusDI: plusDISmooth, minusDI: minusDISmooth }
}

// ─── On-chain / model indicators ─────────────────────────────────────────────

/** MVRV — Market Value vs Realized Cap ratio */
export function calcMVRV(price: number, realizedCap: number): number {
  return realizedCap > 0 ? price / realizedCap : 1
}

/** Pi Cycle Top indicator — approximate */
export function calcPiCycleTop(ema111: number, ema350: number, multi = 2): boolean {
  return ema111 > ema350 * multi
}

/** Stock-to-Flow model price (PlanB power-law approximation) */
export function calcS2FPrice(totalS2F: number): number {
  return Math.pow(totalS2F, 3) * 0.001
}

/** Difficulty Ribbon compression — indicates miner capitulation */
export function calcDifficultyRibbon(candles: BtcCandle[], periods = [8, 16, 32, 64, 128, 256]): boolean {
  if (candles.length < 256) return false
  const closes = candles.map(c => c.close)
  const ribbons = periods.map(p => {
    const ema = calcEMA(closes.slice(-p * 2), p)
    return ema[ema.length - 1]
  })
  // Ribbon compression: short-term EMAs cross below long-term
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
  const closes = candles.map(c => c.close)
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

  // EMA Cross
  if (latestEMA20 > latestEMA50) signals.push({ indicator: 'EMA Cross', signal: 'BUY', strength: 70, description: `EMA20 ($${latestEMA20.toFixed(0)}) > EMA50 ($${latestEMA50.toFixed(0)})` })
  else signals.push({ indicator: 'EMA Cross', signal: 'SELL', strength: 70, description: `EMA20 ($${latestEMA20.toFixed(0)}) < EMA50 ($${latestEMA50.toFixed(0)})` })

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

  const pct = (last - ema200) / ema200
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
  // 0% ATR = 100% conf, 8% daily ATR = 0% conf (linearly).
  const confidence = atrPct != null
    ? Math.max(0, Math.min(100, Math.round(100 - 100 * (atrPct / 0.08))))
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
