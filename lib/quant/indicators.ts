/**
 * Canonical indicator implementations — single source of truth.
 *
 * All functions return full time-series arrays (oldest → newest).
 * Convenience "*Latest" wrappers return only the last valid value.
 *
 * Smoothing conventions (Phase 13 S2 — F2.3 documentation correction):
 *   - Wilder smoothing (alpha = 1/N) for RSI, ATR, ADX (Wilder 1978).
 *     Wilder smoothing ≠ EMA: it equals an EMA of span 2N-1, reacting more
 *     slowly than standard EMA(N). Use `wilderSmoothing()` (exported).
 *   - Standard EMA (alpha = 2/(N+1)) for MACD signal-line, multi-timeframe
 *     trend, and chart overlays. SMA-seeded for the first N values.
 *   - Sample variance (Bessel's correction, /(N-1)) for Bollinger and
 *     Sharpe/Sortino — unbiased estimator (Bacon 2008 p35).
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
 * EMA seeded with SMA of the first `period` values.
 *
 * @deprecated F2.8 (Phase 13 S2): use {@link emaFull} which returns a
 * full-length NaN-padded array. This shorter-array variant is a footgun
 * — callers indexing `ema(values, n)[i]` get a different value than
 * `emaFull(values, n)[i]` for the same i. The dual API caused at least
 * one subtle bug (the F-NEW MACD signal-line offset). Internal callers
 * should migrate to `emaFull`; this export is retained for backward
 * compatibility and will be removed in a future phase.
 *
 * Returns array of length `values.length - period + 1` (first valid at
 * index 0 corresponds to bar index `period - 1` of the input).
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
  // Phase 13 S2 (F2.7): MACD signal line requires slow+sig-1 bars to be valid.
  // Previously only `closes.length < slow` was checked, which left signal/histogram
  // silently NaN when slow ≤ length < slow+sig-1 — caller saw a populated MACD line
  // with an empty signal and no diagnostic.
  if (
    fast <= 0 ||
    slow <= 0 ||
    sig <= 0 ||
    closes.length < slow + sig - 1
  ) {
    return { line, signal, histogram }
  }

  const emaFastArr = emaFull(closes, fast)
  const emaSlowArr = emaFull(closes, slow)

  // MACD line = fast EMA - slow EMA
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(emaFastArr[i]) && Number.isFinite(emaSlowArr[i])) {
      line[i] = emaFastArr[i] - emaSlowArr[i]
    }
  }

  // Signal line = EMA of valid MACD line values.
  //
  // F-NEW (Phase 13 S2 fix): the previous version placed sigEma[i] at
  // signal[i + slow - 1], which is OFF BY (sig - 1) BARS. `ema()` returns
  // a shorter array of length `validLine.length - sig + 1`, so the loop
  // only filled signal[slow-1 .. closes.length - sig], leaving the most
  // recent sig-1 bars (≈8 for default sig=9) as NaN. As a result, the
  // signal layer's `macdHist` was effectively NaN forever and the MACD
  // weight (0.15-0.20) silently contributed 0 to the weighted score.
  //
  // Correct anchoring: sigEma[k] is the EMA value computed using the first
  // (k+sig) values of validLine. Anchored at validLine index (k + sig - 1),
  // i.e., line index (k + slow + sig - 2). Place it at signal[k + slow + sig - 2].
  const validLine = line.slice(slow - 1)
  const sigEma = ema(validLine, sig)
  for (let i = 0; i < sigEma.length; i++) {
    signal[i + slow + sig - 2] = sigEma[i]
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
  // Phase 13 S2 (F2.9): Bollinger period must be ≥ 2 — at period=1 sample
  // variance is identically 0 and the bands collapse to the price line.
  if (closes.length < period || period < 2) return { mid, upper, lower, pctB }

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

/**
 * On-Balance Volume.
 *
 * Phase 13 S2 (F2.6): silent length-mismatch fallback removed. Mismatched
 * input is now an explicit error — silent truncation hid alignment bugs.
 *
 * @throws Error when closes.length !== volumes.length.
 */
export function obvArray(closes: number[], volumes: number[]): number[] {
  if (closes.length !== volumes.length) {
    throw new Error(
      `obvArray: closes (${closes.length}) and volumes (${volumes.length}) length mismatch`,
    )
  }
  if (closes.length === 0) return []
  let cum = 0
  return closes.map((c, i) => {
    if (i === 0) return 0
    if (c > closes[i - 1]) cum += volumes[i]
    else if (c < closes[i - 1]) cum -= volumes[i]
    return cum
  })
}

/**
 * Volume-Weighted Average Price (cumulative from `anchorIndex`).
 *
 * Phase 13 S2 (F2.4): added optional `anchorIndex` to support **anchored
 * VWAP** — the typical use-case in trading (anchored to a prior low,
 * earnings event, session open, etc.). Cumulative-from-start (default
 * anchor=0) is preserved for backward compat but is statistically
 * meaningless for daily-bar series spanning more than ~6 months because
 * long-tail accumulation dwarfs the recent prices.
 *
 * Reference:
 *   - Berkowitz, S. A., Logue, D. E., Noser, E. A. (1988). "The Total Cost
 *     of Transactions on the NYSE." Journal of Finance 43, p97-112.
 *   - Pruitt, S. W. & White, R. E. (1988). Anchored-VWAP variant
 *     used by the CRISMA trading system (Journal of Portfolio Management
 *     14(3), p55-58).
 *
 * @param anchorIndex   Bar index from which accumulation starts.
 *                      Defaults to 0 (legacy cumulative behaviour).
 *                      Returns NaN for bars before the anchor.
 */
export function vwapArray(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  anchorIndex = 0,
): number[] {
  const out: number[] = new Array(closes.length).fill(NaN)
  if (anchorIndex < 0 || anchorIndex >= closes.length) return out
  let cumTPV = 0
  let cumVol = 0
  for (let i = anchorIndex; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3
    cumTPV += tp * volumes[i]
    cumVol += volumes[i]
    out[i] = cumVol > 0 ? cumTPV / cumVol : NaN
  }
  return out
}

/**
 * Convenience wrapper: VWAP anchored to the last `n` bars (sliding-window).
 * Useful for "session VWAP" on intraday bars or "20-day anchored VWAP" on
 * daily bars without managing the anchor index manually.
 */
export function vwapArrayWindow(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  windowBars: number,
): number[] {
  if (windowBars <= 0 || closes.length === 0) {
    return new Array(closes.length).fill(NaN)
  }
  const anchor = Math.max(0, closes.length - windowBars)
  return vwapArray(highs, lows, closes, volumes, anchor)
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

/**
 * Wilder smoothing — alpha = 1/period (equivalent to an EMA with span 2N-1).
 *
 * This is the smoothing scheme Wilder defined for ADX, ATR, and RSI in
 * "New Concepts in Technical Trading Systems" (1978). It is *not* the same as
 * standard EMA (alpha = 2/(N+1)) — Wilder's reacts more slowly. TA-Lib (the
 * de facto reference) uses Wilder smoothing for ADX/ATR/RSI; charting
 * platforms generally follow.
 *
 * Returns full-length array, NaN before index `period - 1`.
 */
export function wilderSmoothing(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (period <= 0 || values.length < period) return out
  // SMA seed for the first `period` values.
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  // Recursive Wilder smoothing: prev = prev + (current - prev) / period
  //                          = prev * (1 - 1/period) + current * (1/period)
  for (let i = period; i < values.length; i++) {
    prev = prev + (values[i] - prev) / period
    out[i] = prev
  }
  return out
}

/**
 * ADX (Average Directional Index) returning full-length arrays.
 *
 * Phase 13 S2 fix (F2.2): smoothing now uses Wilder's method per the
 * original 1978 specification. Previously used standard EMA (alpha=2/(N+1)),
 * which produces faster-reacting (more noisy) ADX values that disagree with
 * TA-Lib and charting platforms.
 */
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

  const trSmooth = wilderSmoothing(tr, period)
  const plusDISmooth = wilderSmoothing(plusDM, period)
  const minusDISmooth = wilderSmoothing(minusDM, period)

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

  // Smooth the per-bar DX (in adxRaw) with Wilder smoothing → ADX. F2.2 fix.
  const validAdx = adxRaw.slice(period)
  const adxSmoothed = wilderSmoothing(validAdx, period)
  const adxOut = new Array<number>(bars.length).fill(NaN)
  for (let i = 0; i < adxSmoothed.length; i++) {
    adxOut[i + period] = adxSmoothed[i]
  }

  return { adx: adxOut, plusDI: plusDIOut, minusDI: minusDIOut }
}

// ─── Utility: daily returns, max drawdown, Sharpe, Sortino ─────────────────

/**
 * Simple daily returns: r_i = close_i / close_{i-1} - 1.
 *
 * Convention (F2.10 — Phase 13 S2 documentation):
 *   We use SIMPLE returns throughout. Tsay (2010) op cit. p3-7 covers the
 *   tradeoffs vs LOG returns:
 *     • Simple returns aggregate naturally across portfolios (weighted sum).
 *     • Log returns aggregate naturally across time (additive).
 *     • For typical daily moves (|r| < 5%), simple ≈ log to second-order.
 *   Sharpe/Sortino computations that follow are based on simple returns,
 *   matching most institutional reporting conventions (e.g., Bacon 2008
 *   uses simple returns for performance attribution).
 *
 *   For log-return computations (e.g., volatility annualisation), see
 *   `realizedVol` in `lib/quant/regimeDetection.ts` and `logReturns` in
 *   `lib/quant/relativeStrength.ts` which explicitly use Math.log(c/c_prev).
 */
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

/**
 * Sample Sharpe (daily), annualized.
 *
 * Phase 13 S2 fix (F1.6): annualization is now configurable. Default 252 for
 * US equities; pass 365 for crypto (24/7 trading). Previously hardcoded 252,
 * which understated crypto Sharpe by sqrt(252/365) ≈ 17%.
 *
 * @param returns        Daily returns series (decimal, e.g. 0.01 = 1%).
 * @param rfAnnual       Annualized risk-free rate; default 4%.
 * @param annualization  Trading periods per year; default 252.
 */
export function sharpeRatio(
  returns: number[],
  rfAnnual = 0.04,
  annualization = 252,
): number | null {
  if (returns.length < 20) return null
  const rfD = rfAnnual / annualization
  const excess = returns.map((x) => x - rfD)
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length
  const v = excess.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, excess.length - 1)
  const sd = Math.sqrt(Math.max(v, 0))
  if (sd === 0) return null
  return (mean / sd) * Math.sqrt(annualization)
}

/**
 * Sortino ratio — canonical single-source-of-truth implementation.
 *
 * Phase 13 S2 fix (F2.1 + F1.16): Three divergent Sortino implementations existed
 * (engine.ts, portfolioBacktest.ts, indicators.ts) — this is now the canonical one.
 * Other call-sites import from here.
 *
 * Formula (Sortino & van der Meer 1991):
 *   downsideDeviation = sqrt( sum( min(0, r - MAR)^2 ) / n_d )
 *   Sortino           = ((mean - MAR) / downsideDeviation) * sqrt(annualization)
 *
 * Key choices:
 *   - Denominator is n_d (count of negative excess returns), NOT N (total obs).
 *     Using N understates downside deviation, inflating Sortino by sqrt(N/n_d).
 *   - Minimum n_d ≥ 30 for statistically stable estimate (Bacon 2008 p107).
 *   - MAR (Minimum Acceptable Return) is configurable as a daily rate. Pass
 *     `marDaily = rfAnnual / annualization` to use risk-free rate as MAR.
 *   - Numerator uses (mean - MAR), matching the MAR used in the denominator.
 *
 * Returns null when:
 *   - returns.length < 30
 *   - n_d (negative excess returns) < 30
 *   - downsideDeviation is degenerate (zero or non-finite)
 *
 * @param returns        Daily return series (decimal, e.g. 0.01 = 1%).
 * @param marDaily       Minimum Acceptable Return as a daily rate. Default 0
 *                       (any negative return counts as downside).
 * @param annualization  Trading periods per year (252 equities, 365 crypto).
 */
export function sortinoRatio(
  returns: number[],
  marDaily = 0,
  annualization = 252,
): number | null {
  if (returns.length < 30) return null
  const negDevs = returns
    .map((x) => Math.min(0, x - marDaily))
    .filter((x) => x < 0)
  if (negDevs.length < 30) return null

  const downsideVariance =
    negDevs.reduce((s, x) => s + x * x, 0) / negDevs.length
  const dsd = Math.sqrt(downsideVariance)
  if (!Number.isFinite(dsd) || dsd < 1e-12) return null

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const ratio = ((mean - marDaily) / dsd) * Math.sqrt(annualization)
  return Number.isFinite(ratio) ? ratio : null
}
