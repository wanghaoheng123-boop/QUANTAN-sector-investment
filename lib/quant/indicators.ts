/**
 * Canonical indicator implementations — single source of truth.
 *
 * All functions return full time-series arrays (oldest → newest).
 * Convenience "*Latest" wrappers return only the last valid value.
 *
 * Standard: Wilder smoothing for RSI/ATR, SMA-seeded EMA, sample variance for Bollinger.
 */

export interface OhlcBar {
  open: number
  high: number
  low: number
  close: number
}

export interface OhlcvBar extends OhlcBar {
  volume: number
}

// ─── Simple Moving Average ──────────────────────────────────────────────────

/** Rolling SMA returning full array. NaN for bars before `period`. */
export function smaArray(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (period <= 0 || values.length < period) return out
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  out[period - 1] = sum / period
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period]
    out[i] = sum / period
  }
  return out
}

/** SMA of the last `period` values, or null if insufficient data. */
export function smaLatest(values: number[], period: number): number | null {
  if (values.length < period) return null
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

// ─── Exponential Moving Average ─────────────────────────────────────────────

/**
 * EMA seeded with SMA of the first `period` values (Wilder standard).
 * Returns array of length `values.length - period + 1` (first valid at index 0
 * corresponds to bar index `period - 1` of the input).
 *
 * For a full-length array with NaN padding, use `emaFull`.
 */
export function ema(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return []
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(prev)
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

/**
 * EMA returning a full-length array (NaN-padded before period-1).
 * Index alignment: emaFull[i] corresponds to values[i].
 */
export function emaFull(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (period <= 0 || values.length < period) return out
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

// ─── Relative Strength Index (Wilder) ───────────────────────────────────────

/**
 * Wilder RSI returning full-length array (NaN before period).
 * Uses first `period` changes for initialization, then recursive Wilder smoothing.
 */
export function rsiArray(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN)
  if (period <= 0 || closes.length < period + 1) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) avgGain += d
    else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

/** RSI of the last bar only, or null if insufficient data. */
export function rsiLatest(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1]
    if (ch >= 0) avgGain += ch
    else avgLoss -= ch
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, ch)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -ch)) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

// ─── MACD ───────────────────────────────────────────────────────────────────

export interface MacdResult {
  line: number[]
  signal: number[]
  histogram: number[]
}

/** MACD returning full-length arrays (NaN-padded). */
export function macdArray(
  closes: number[],
  fast = 12,
  slow = 26,
  sig = 9,
): MacdResult {
  const nanArr = () => new Array<number>(closes.length).fill(NaN)
  const line = nanArr()
  const signal = nanArr()
  const histogram = nanArr()
  if (fast <= 0 || slow <= 0 || sig <= 0 || closes.length < slow) return { line, signal, histogram }

  const emaFastArr = emaFull(closes, fast)
  const emaSlowArr = emaFull(closes, slow)

  // MACD line = fast EMA - slow EMA
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(emaFastArr[i]) && Number.isFinite(emaSlowArr[i])) {
      line[i] = emaFastArr[i] - emaSlowArr[i]
    }
  }

  // Signal line = EMA of valid MACD line values
  const validLine = line.slice(slow - 1)
  const sigEma = ema(validLine, sig)
  for (let i = 0; i < sigEma.length; i++) {
    signal[i + slow - 1] = sigEma[i]
  }

  // Histogram = line - signal
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(line[i]) && Number.isFinite(signal[i])) {
      histogram[i] = line[i] - signal[i]
    }
  }

  return { line, signal, histogram }
}

/** MACD latest values only. */
export function macdLatest(closes: number[]): {
  line: number | null
  signal: number | null
  histogram: number | null
} {
  if (closes.length < 35) return { line: null, signal: null, histogram: null }
  const { line, signal, histogram } = macdArray(closes)
  const i = closes.length - 1
  const l = Number.isFinite(line[i]) ? line[i] : null
  const s = Number.isFinite(signal[i]) ? signal[i] : null
  const h = l != null && s != null ? l - s : null
  return { line: l, signal: s, histogram: h }
}

// ─── Bollinger Bands ────────────────────────────────────────────────────────

export interface BollingerResult {
  mid: number[]
  upper: number[]
  lower: number[]
  pctB: number[]
}

/** Bollinger Bands returning full-length arrays (sample variance, N-1). */
export function bollingerArray(
  closes: number[],
  period = 20,
  mult = 2,
): BollingerResult {
  const nanArr = () => new Array<number>(closes.length).fill(NaN)
  const mid = nanArr()
  const upper = nanArr()
  const lower = nanArr()
  const pctB = nanArr()
  if (closes.length < period || period <= 0) return { mid, upper, lower, pctB }

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1)
    const m = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, period - 1)
    const sd = Math.sqrt(Math.max(variance, 0))
    mid[i] = m
    upper[i] = m + mult * sd
    lower[i] = m - mult * sd
    if (upper[i] !== lower[i]) {
      pctB[i] = (closes[i] - lower[i]) / (upper[i] - lower[i])
    }
  }
  return { mid, upper, lower, pctB }
}

/** Bollinger latest values only. */
export function bollingerLatest(closes: number[], period = 20, mult = 2): {
  mid: number | null
  upper: number | null
  lower: number | null
  pctB: number | null
} {
  if (closes.length < period) return { mid: null, upper: null, lower: null, pctB: null }
  const slice = closes.slice(-period)
  const mid = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((s, x) => s + (x - mid) ** 2, 0) / Math.max(1, period - 1)
  const sd = Math.sqrt(Math.max(variance, 0))
  const upper = mid + mult * sd
  const lower = mid - mult * sd
  const last = closes[closes.length - 1]
  const pctB = upper !== lower ? (last - lower) / (upper - lower) : null
  return { mid, upper, lower, pctB }
}

// ─── Average True Range (Wilder) ────────────────────────────────────────────

/** True Range series (length = bars.length, first bar uses H-L). */
export function trueRange(bars: OhlcBar[]): number[] {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low
    const prev = bars[i - 1]
    return Math.max(
      b.high - b.low,
      Math.abs(b.high - prev.close),
      Math.abs(b.low - prev.close),
    )
  })
}

/** ATR returning full-length array (Wilder smoothing, NaN before period). */
export function atrArray(bars: OhlcBar[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN)
  if (bars.length < period + 1 || period <= 0) return out
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

/** ATR latest value only. */
export function atrLatest(bars: OhlcBar[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    trs.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    ))
  }
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period
  }
  return avg
}

// ─── Additional indicators (from btc-indicators) ───────────────────────────

/** On-Balance Volume */
export function obvArray(closes: number[], volumes: number[]): number[] {
  // Guard: if volumes are shorter than closes, truncate closes to match volumes length
  if (volumes.length < closes.length) {
    closes = closes.slice(-volumes.length)
  }
  if (closes.length === 0 || volumes.length === 0) return []
  let cum = 0
  return closes.map((c, i) => {
    if (i === 0) return 0
    if (c > closes[i - 1]) cum += volumes[i]
    else if (c < closes[i - 1]) cum -= volumes[i]
    return cum
  })
}

/** Volume-Weighted Average Price (cumulative). */
export function vwapArray(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number[] {
  let cumTPV = 0
  let cumVol = 0
  return closes.map((c, i) => {
    const tp = (highs[i] + lows[i] + c) / 3
    cumTPV += tp * volumes[i]
    cumVol += volumes[i]
    return cumVol > 0 ? cumTPV / cumVol : NaN
  })
}

/** Stochastic RSI returning K and D lines (full-length, NaN-padded). */
export function stochRsiArray(
  closes: number[],
  rsiPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: number[]; d: number[] } {
  const rsi = rsiArray(closes, rsiPeriod)
  const stoch = new Array<number>(closes.length).fill(NaN)
  if (rsiPeriod <= 0 || kSmooth <= 0 || dSmooth <= 0 || closes.length < rsiPeriod * 2) return { k: stoch, d: stoch }
  for (let i = rsiPeriod; i < closes.length; i++) {
    const window = rsi.slice(i - rsiPeriod + 1, i + 1)
    const min = Math.min(...window)
    const max = Math.max(...window)
    stoch[i] = max - min > 0 ? ((rsi[i] - min) / (max - min)) * 100 : 50
  }
  const k = emaFull(stoch, kSmooth)
  const d = emaFull(k, dSmooth)
  return { k, d }
}

/** ADX (Average Directional Index) returning full-length arrays. */
export function adxArray(bars: OhlcBar[], period = 14): {
  adx: number[]
  plusDI: number[]
  minusDI: number[]
} {
  const nanArr = () => new Array<number>(bars.length).fill(NaN)
  if (bars.length < period + 1 || period <= 0) return { adx: nanArr(), plusDI: nanArr(), minusDI: nanArr() }

  const plusDM: number[] = []
  const minusDM: number[] = []
  const tr: number[] = []

  for (let i = 1; i < bars.length; i++) {
    const hl = bars[i].high - bars[i].low
    const hPH = Math.abs(bars[i].high - bars[i - 1].close)
    const lPC = Math.abs(bars[i].low - bars[i - 1].close)
    tr.push(Math.max(hl, hPH, lPC))

    const upMove = bars[i].high - bars[i - 1].high
    const downMove = bars[i - 1].low - bars[i].low
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  const trSmooth = emaFull(tr, period)
  const plusDISmooth = emaFull(plusDM, period)
  const minusDISmooth = emaFull(minusDM, period)

  const adxRaw = new Array<number>(bars.length).fill(NaN)
  const plusDIOut = new Array<number>(bars.length).fill(NaN)
  const minusDIOut = new Array<number>(bars.length).fill(NaN)

  for (let i = period; i < bars.length; i++) {
    const trVal = trSmooth[i - 1] // offset by 1 since tr starts at bar 1
    const pdi = trVal > 0 ? (plusDISmooth[i - 1] / trVal) * 100 : 0
    const mdi = trVal > 0 ? (minusDISmooth[i - 1] / trVal) * 100 : 0
    plusDIOut[i] = pdi
    minusDIOut[i] = mdi
    adxRaw[i] = pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0
  }

  // Smooth ADX itself
  const validAdx = adxRaw.slice(period)
  const adxSmoothed = emaFull(validAdx, period)
  const adxOut = new Array<number>(bars.length).fill(NaN)
  for (let i = 0; i < adxSmoothed.length; i++) {
    adxOut[i + period] = adxSmoothed[i]
  }

  return { adx: adxOut, plusDI: plusDIOut, minusDI: minusDIOut }
}

// ─── Utility: daily returns, max drawdown, Sharpe, Sortino ─────────────────

export function dailyReturns(closes: number[]): number[] {
  const r: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1)
  }
  return r
}

export function maxDrawdown(closes: number[]): { maxDd: number; maxDdPct: number } | null {
  if (closes.length < 2) return null
  let peak = closes[0]
  let maxDd = 0
  for (const c of closes) {
    if (c > peak) peak = c
    const dd = peak - c
    if (dd > maxDd) maxDd = dd
  }
  const maxDdPct = peak > 0 ? maxDd / peak : 0
  return { maxDd, maxDdPct }
}

/** Sample Sharpe (daily), annualized; rf annual default 4%. */
export function sharpeRatio(returns: number[], rfAnnual = 0.04): number | null {
  if (returns.length < 20) return null
  const rfD = rfAnnual / 252
  const excess = returns.map((x) => x - rfD)
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length
  const v = excess.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, excess.length - 1)
  const sd = Math.sqrt(Math.max(v, 0))
  if (sd === 0) return null
  return (mean / sd) * Math.sqrt(252)
}

/** Sortino using downside deviation vs MAR. Denominator = N-1 (sample std, matches Sharpe). */
export function sortinoRatio(returns: number[], marDaily = 0): number | null {
  if (returns.length < 20) return null
  const n = returns.length
  const downsideSq = returns.map((x) => {
    const dev = Math.min(0, x - marDaily)
    return dev * dev
  })
  const downsideVariance = downsideSq.reduce((s, x) => s + x, 0) / Math.max(1, n - 1)
  const dsd = Math.sqrt(downsideVariance)
  if (dsd === 0) return null
  const mean = returns.reduce((a, b) => a + b, 0) / n
  return ((mean - marDaily) / dsd) * Math.sqrt(252)
}
