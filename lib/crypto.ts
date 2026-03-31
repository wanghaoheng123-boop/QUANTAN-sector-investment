import { PERP_FUNDING_HIGH_ABS, PERP_FUNDING_MODERATE_ABS } from './quant/fundingConstants'

export { PERP_FUNDING_HIGH_ABS, PERP_FUNDING_MODERATE_ABS } from './quant/fundingConstants'

// ─── BTC indicator calculations ────────────────────────────────────────────────

export interface BtcCandle {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** On-chain MVRV ratio — flags overvaluation / undervaluation zones */
export function calcMVRV(price: number, realizedCap: number): number {
  return realizedCap > 0 ? price / realizedCap : 1
}

/** Stock-to-Flow model price (simplified, no halving cycle) */
export function calcS2FPrice(totalS2F: number): number {
  // Power-law approximation based on PlanB's original model
  return Math.pow(totalS2F, 3) * 0.001
}

/** RSI — identical math to equity RSI */
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

/** EMA */
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

/** MACD */
export function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9) {
  const result = new Array(prices.length).fill({ macd: NaN, signal: NaN, histogram: NaN })
  if (prices.length < slow) return result
  const fastEma = calcEMA(prices, fast)
  const slowEma = calcEMA(prices, slow)
  for (let i = slow - 1; i < prices.length; i++) {
    const macd = fastEma[i] - slowEma[i]
    result[i] = { macd, signal: NaN, histogram: NaN }
  }
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

/** Bollinger Bands */
export function calcBollingerBands(prices: number[], period = 20, stdDev = 2) {
  const result = new Array(prices.length).fill({ mid: NaN, upper: NaN, lower: NaN })
  if (prices.length < period) return result
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    result[i] = { mid: mean, upper: mean + stdDev * std, lower: mean - stdDev * std }
  }
  return result
}

/** VWAP for crypto — cumulative TPV / cumulative volume */
export function calcVWAP(candles: BtcCandle[]): { time: number; value: number }[] {
  let cumulativeTPV = 0
  let cumulativeVol = 0
  return candles.map(c => {
    const tpv = ((c.high + c.low + c.close) / 3) * c.volume
    cumulativeTPV += tpv
    cumulativeVol += c.volume
    return { time: typeof c.time === 'string' ? Math.floor(new Date(c.time).getTime() / 1000) : c.time, value: cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : NaN }
  })
}

/**
 * Funding rate interpretation (Binance-style decimal).
 * Positive rate → longs pay shorts (crowded long risk); negative → shorts pay longs.
 * Signal is a *positioning / contrarian* read, not a price-direction guarantee.
 */
export function interpretFundingRate(rate: number): {
  label: string
  color: string
  /** Contrarian lean: crowded longs (positive rate) vs crowded shorts (negative rate). */
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
} {
  if (!Number.isFinite(rate)) {
    return { label: 'Invalid', color: 'text-slate-400', signal: 'NEUTRAL' }
  }
  if (rate > PERP_FUNDING_HIGH_ABS) {
    return {
      label: 'Very high (longs pay)',
      color: 'text-orange-400',
      signal: 'BEARISH',
    }
  }
  if (rate > PERP_FUNDING_MODERATE_ABS) {
    return {
      label: 'Elevated (longs pay)',
      color: 'text-amber-400',
      signal: 'BEARISH',
    }
  }
  if (rate > 0) {
    return { label: 'Slight (longs pay)', color: 'text-slate-400', signal: 'NEUTRAL' }
  }
  if (rate < -PERP_FUNDING_HIGH_ABS) {
    return {
      label: 'Very high (shorts pay)',
      color: 'text-cyan-400',
      signal: 'BULLISH',
    }
  }
  if (rate < -PERP_FUNDING_MODERATE_ABS) {
    return {
      label: 'Elevated (shorts pay)',
      color: 'text-sky-400',
      signal: 'BULLISH',
    }
  }
  if (rate < 0) {
    return { label: 'Slight (shorts pay)', color: 'text-slate-400', signal: 'NEUTRAL' }
  }
  return { label: 'Neutral', color: 'text-slate-400', signal: 'NEUTRAL' }
}

/** Rainbow chart bands — logarithmic regression levels */
export const RAINBOW_BANDS = [
  { label: 'Bubble Peak', color: '#ff0000', floor: 0.9 },
  { label: 'Sell Peak',   color: '#ff6600', floor: 0.7 },
  { label: 'FOMO',        color: '#ffcc00', floor: 0.5 },
  { label: 'Neutral',     color: '#00cc00', floor: 0.35 },
  { label: 'Accumulate',  color: '#00ffcc', floor: 0.2 },
  { label: 'Deep Value',  color: '#0000ff', floor: 0.0 },
]

export function getRainbowBand(price: number, rainbowHigh: number, rainbowLow: number) {
  const range = rainbowHigh - rainbowLow
  const position = range > 0 ? (price - rainbowLow) / range : 0.5
  if (position >= 0.9) return RAINBOW_BANDS[0]
  if (position >= 0.7) return RAINBOW_BANDS[1]
  if (position >= 0.5) return RAINBOW_BANDS[2]
  if (position >= 0.35) return RAINBOW_BANDS[3]
  if (position >= 0.2) return RAINBOW_BANDS[4]
  return RAINBOW_BANDS[5]
}

/** Fear & Greed interpretation */
export function interpretFearGreed(value: number): {
  label: string
  color: string
  description: string
} {
  if (value >= 75) return { label: 'Extreme Greed', color: 'text-green-400', description: 'Market is highly greedy — caution' }
  if (value >= 55) return { label: 'Greed', color: 'text-lime-400', description: 'Bullish sentiment dominating' }
  if (value >= 45) return { label: 'Neutral', color: 'text-slate-400', description: 'Sentiment is balanced' }
  if (value >= 25) return { label: 'Fear', color: 'text-orange-400', description: 'Bearish sentiment — potential buying opportunity' }
  return { label: 'Extreme Fear', color: 'text-red-400', description: 'Market is fearful — high risk environment' }
}
