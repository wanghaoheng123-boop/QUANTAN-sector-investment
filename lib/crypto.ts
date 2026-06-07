import { PERP_FUNDING_HIGH_ABS, PERP_FUNDING_MODERATE_ABS } from './quant/fundingConstants'
import {
  emaFull,
  rsiArray,
  macdArray,
  bollingerArray,
  atrArray,
  type OhlcBar,
} from './quant/indicators'

export { PERP_FUNDING_HIGH_ABS, PERP_FUNDING_MODERATE_ABS } from './quant/fundingConstants'

// ─── BTC indicator calculations ────────────────────────────────────────────────
//
// Phase 13 S2 fix (F-NEW HIGH): EMA / RSI / MACD / ATR / VWAP previously had
// inline implementations here that duplicated lib/quant/indicators.ts (same
// SSOT-violation pattern as F5.1 in KLineChart). The duplicates are now thin
// adapters that delegate to canonical impls — Phase 12+ algorithm fixes
// (Wilder smoothing, sample variance, MACD warmup gate, OBV throw, etc.)
// flow through automatically.
//
// Adapter shape notes:
//   - calcMACD originally returned `[{ macd, signal, histogram }]` (array of
//     structs). Canonical macdArray returns struct-of-arrays. Adapter
//     converts so existing call sites (BtcQuantLab, BTC page) stay unchanged.

export interface BtcCandle {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * On-chain MVRV ratio and Stock-to-Flow price — re-exported from
 * `lib/quant/btc-indicators.ts` (canonical SSOT).
 *
 * Phase 14 wave 11 + SSOT dedup: inline copies removed; same pattern as
 * calcVWAP below. The cross-source sync test in
 * __tests__/quant/cryptoIndicators.test.ts guards that both names resolve
 * to the identical implementation.
 */
export { calcMVRV, calcS2FPrice } from './quant/btc-indicators'

/** RSI — delegates to canonical Wilder RSI in lib/quant/indicators. */
export function calcRSI(prices: number[], period = 14): number[] {
  return rsiArray(prices, period)
}

/** EMA — delegates to canonical SMA-seeded EMA in lib/quant/indicators. */
export function calcEMA(prices: number[], period: number): number[] {
  return emaFull(prices, period)
}

interface MacdRow { macd: number; signal: number; histogram: number }

/**
 * MACD — delegates to canonical macdArray with shape adapter.
 * Canonical now also enforces `closes.length >= slow + sig - 1` (F2.7 fix);
 * previously the inline impl returned signal=NaN with no warmup gate.
 */
export function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9): MacdRow[] {
  const { line, signal: sig, histogram } = macdArray(prices, fast, slow, signal)
  return prices.map((_, i) => ({
    macd: line[i],
    signal: sig[i],
    histogram: histogram[i],
  }))
}

/** ATR (Wilder) — delegates to canonical atrArray. */
export function calcATR(candles: BtcCandle[], period = 14): number[] {
  const bars: OhlcBar[] = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))
  return atrArray(bars, period)
}

/** Stochastic %K / %D (classic 14,3,3) — %K = SMA of raw %K, %D = SMA of %K */
export function calcStochastic(
  candles: BtcCandle[],
  kPeriod = 14,
  smoothK = 3,
  smoothD = 3,
): { k: number[]; d: number[] } {
  const n = candles.length
  const rawK: number[] = new Array(n).fill(NaN)
  const k: number[] = new Array(n).fill(NaN)
  const d: number[] = new Array(n).fill(NaN)
  for (let i = kPeriod - 1; i < n; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1)
    const hh = Math.max(...slice.map((c) => c.high))
    const ll = Math.min(...slice.map((c) => c.low))
    const c = candles[i].close
    rawK[i] = hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100
  }
  const startK = kPeriod - 1 + smoothK - 1
  for (let i = startK; i < n; i++) {
    let s = 0
    for (let j = 0; j < smoothK; j++) s += rawK[i - j] ?? 0
    k[i] = s / smoothK
  }
  const startD = startK + smoothD - 1
  for (let i = startD; i < n; i++) {
    let s = 0
    for (let j = 0; j < smoothD; j++) s += k[i - j] ?? 0
    d[i] = s / smoothD
  }
  return { k, d }
}

/**
 * Bollinger Bands — delegates to canonical bollingerArray with shape adapter.
 *
 * Phase 13 S2 fix: canonical uses SAMPLE variance (/(period-1)) per Bessel's
 * correction; the previous inline impl here used POPULATION variance
 * (/period). Bands are now ~2.6% wider for period=20, matching the signal
 * layer + KLineChart, which both already use canonical.
 */
interface BollingerRow { mid: number; upper: number; lower: number }

export function calcBollingerBands(prices: number[], period = 20, stdDev = 2): BollingerRow[] {
  const { mid, upper, lower } = bollingerArray(prices, period, stdDev)
  return prices.map((_, i) => ({
    mid: mid[i],
    upper: upper[i],
    lower: lower[i],
  }))
}

/**
 * VWAP for crypto — re-exported from `lib/quant/btc-indicators.ts`.
 *
 * Phase 14 wave 32 (jscpd duplication fix): the wrapper logic here was
 * byte-identical to `btc-indicators.ts:calcVWAP` (17-line clone per jscpd).
 * Two copies of the same time-conversion adapter were a regression hazard —
 * a fix in one would silently miss the other. Now `lib/crypto.ts` re-exports
 * the canonical version. The wrapper produces `{time, value}[]` for
 * lightweight-charts; both files import the math from canonical
 * `lib/quant/indicators.ts::vwapArray`.
 */
export { calcVWAP } from './quant/btc-indicators'

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
