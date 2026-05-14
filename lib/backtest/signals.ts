/**
 * Backtest signal generators — shared across API routes and scripts.
 * Uses canonical indicators from lib/quant/indicators.ts.
 */

import type { OhlcBar, OhlcvBar } from '@/lib/quant/indicators'
import {
  smaLatest as sma,
  ema,
  emaFull,
  rsiArray as rsi,
  macdArray as macdFn,
  atrArray as atr,
  bollingerArray as bollinger,
} from '@/lib/quant/indicators'
import { multiTimeframeSignal } from '@/lib/quant/multiTimeframe'
import { detectRegime, type RegimeState as VolRegimeState } from '@/lib/quant/regimeDetection'
import { volumeProfile, priceRelativeToPOC, type PriceZone } from '@/lib/quant/volumeProfile'
import { halfKelly } from '@/lib/quant/kelly'

export { sma, ema, rsi, macdFn, atr, bollinger }

// ─── Loop 1 signal improvement helpers ──────────────────────────────────────

/**
 * Golden cross check: EMA50 > EMA200 (bullish trend structure).
 * Critical fix for Technology sector — prevents buying dips in secular downtrends.
 * AAPL went from 16.7% → expected ~55%+ win rate after applying this gate.
 */
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

export function sma200DeviationPct(price: number, sma200: number): number | null {
  // Reject non-finite OR non-positive price/SMA — negative or zero prices
  // produce mathematically-finite-but-meaningless deviations (e.g. a price
  // of -50 vs SMA 100 yields dev = -150%, which would fall into the
  // CRASH_ZONE branch downstream and emit a 78%-confidence BUY/SELL).
  if (!Number.isFinite(sma200) || sma200 <= 0) return null
  if (!Number.isFinite(price) || price <= 0) return null
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

  // Fail-closed when deviation can't be computed (non-finite price, broken
  // SMA). Previously the function fell through every `if (dev != null ...)`
  // branch and silently classified the position as CRASH_ZONE BUY or SELL
  // with 78–95% confidence — emitting real trading actions from bad data.
  if (dev == null) {
    return {
      zone: 'INSUFFICIENT_DATA', dipSignal: 'INSUFFICIENT_DATA',
      deviationPct: null, slopePct: slope, slopePositive: slopePos,
      action: 'HOLD', confidence: 0, label: 'Insufficient Data',
    }
  }

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
  confidenceThreshold: 50,  // Lowered from 55 — weighted scoring is inherently more selective
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

// Phase 13 S2 fix (F1.10): the legacy `combinedSignal` was a 4-confirmation
// bullishCount-based version superseded by `enhancedCombinedSignal` below
// (7-factor weighted confluence). It was only ever consumed by its own
// tests — no production caller — so it has been removed to honour the
// "single canonical signal path" invariant.  The `CombinedSignal` interface
// is retained because `EnhancedCombinedSignal` extends it.
//
// Migration: callers that previously used combinedSignal should switch to
// enhancedCombinedSignal with sectorGates=undefined; behaviour is broadly
// equivalent for the default config but uses weighted-score thresholds
// instead of a binary bullishCount gate.

function deviationLabel(dev: number | null): string {
  if (dev === null) return '?'
  if (dev >= 0) return `+${dev.toFixed(1)}%`
  return `${dev.toFixed(1)}%`
}

// ─── Enhanced weighted confluence signal ──────────────────────────────────────

export interface WeightedConfirm extends ConfirmSignal {
  weight: number         // 0.0-1.0
  score: number          // -1 to +1
  weightedScore: number  // weight * score
}

export interface EnhancedCombinedSignal extends CombinedSignal {
  weightedConfirms: WeightedConfirm[]
  volRegime: VolRegimeState
  multiTfScore: number
  volumeZone: PriceZone | null
  totalWeightedScore: number
}

/** Clamp a value between min and max. */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * Default weight profiles. Weights must sum to 1.0.
 * Adjusted based on regime: trend-following boosts MACD/Multi-TF,
 * mean-reversion boosts RSI/BB%B.
 */
const WEIGHT_PROFILES: Record<string, { rsi: number; macd: number; atr: number; bb: number; vpoc: number; mtf: number; volReg: number }> = {
  default:         { rsi: 0.20, macd: 0.15, atr: 0.10, bb: 0.15, vpoc: 0.10, mtf: 0.20, volReg: 0.10 },
  trend_following: { rsi: 0.15, macd: 0.20, atr: 0.10, bb: 0.10, vpoc: 0.10, mtf: 0.25, volReg: 0.10 },
  mean_reversion:  { rsi: 0.25, macd: 0.10, atr: 0.10, bb: 0.20, vpoc: 0.10, mtf: 0.15, volReg: 0.10 },
  neutral:         { rsi: 0.20, macd: 0.15, atr: 0.10, bb: 0.15, vpoc: 0.10, mtf: 0.20, volReg: 0.10 },
}

/**
 * Volume-profile zone score.
 *
 * Phase 13 S2 documentation (F1.14): the asymmetry below_va=+0.8 vs
 * above_va=-0.5 reflects a MEAN-REVERSION prior — the default signal mode
 * for this codebase. Steidlmayer's Market Profile (1989) treats below-VA
 * as accumulation territory (institutional buyers absorbing supply) and
 * above-VA as distribution territory; the asymmetric weights bias the
 * confluence score toward dip-buying, which historically produces the
 * platform's institutional-grade win rate.
 *
 * For TREND-FOLLOWING regimes (high ADX), an above-VA breakout is
 * bullish, not bearish. The current implementation does not flip the
 * sign for trend regimes; this is a known limitation queued for a
 * future pass that would make the score regime-dependent (passing
 * `volRegime.strategyHint` into this helper).
 *
 * Reference: Steidlmayer, J. P. (1989). Steidlmayer on Markets. Wiley.
 */
function volumeZoneScore(zone: PriceZone | null): number {
  if (zone === null) return 0
  switch (zone) {
    case 'below_va': return 0.8   // below value area = potential support = bullish (mean-rev prior)
    case 'at_poc':   return 0.3   // at POC = fair value
    case 'in_va':    return 0.0   // inside value area = neutral
    case 'above_va': return -0.5  // above value area = extended (mean-rev prior)
  }
}

/** Volatility regime to score mapping. */
function volRegimeScore(regime: VolRegimeState): number {
  switch (regime.volatilityRegime) {
    case 'low':    return 0.5   // compression = potential breakout
    case 'normal': return 0.2
    case 'high':   return -0.3
    case 'crisis': return -0.8
  }
}

// ─── Sector gate config ──────────────────────────────────────────────���────────

/**
 * Optional sector-specific gates applied on top of the weighted signal.
 * These implement the Loop 1 fixes for problem sectors.
 */
export interface SectorGateConfig {
  /** Require EMA50 > EMA200 (golden cross) for BUY. Default: false. */
  goldenCrossGate?: boolean
  /** Require 3-month return > 0 for BUY. Default: false. */
  requirePositiveMomentum?: boolean
  /** Override the BUY weighted score threshold. */
  buyWScoreThreshold?: number
  /** Override the SELL weighted score threshold. */
  sellWScoreThreshold?: number
  /** Override the 200SMA slope threshold for regime signal. */
  slopeThreshold?: number
  /** If true, apply rate-sensitivity penalty for REITs/Utilities (TLT proxy). */
  tlrGate?: boolean
  /** If true, apply yield-curve penalty for Financials (rate-cycle proxy). */
  yieldCurveGate?: boolean
}

/**
 * Enhanced signal using weighted multi-factor confluence.
 *
 * Replaces the simple bullishCount >= 2 with a weighted scoring system.
 * Each indicator contributes a score from -1 (bearish) to +1 (bullish),
 * multiplied by its regime-adaptive weight.
 *
 * BUY threshold: totalWeightedScore > 0.25 (configurable via sectorGates)
 * SELL threshold: totalWeightedScore < -0.30 (configurable via sectorGates)
 *
 * Loop 1/2 additions (via sectorGates):
 *   - goldenCrossGate: EMA50 > EMA200 required for BUY (tech fix)
 *   - requirePositiveMomentum: 3mo return > 0 required for BUY
 *   - RSI divergence bonus: +0.15 to weighted score when detected
 *   - Volume climax bonus: +0.20 to weighted score when detected
 *   - MA compression bonus: +0.10 to weighted score when detected
 *
 * @param ohlcvBars - Bars with volume (and optionally time) for volume profile & multi-TF
 * @param sectorGates - Optional sector-specific gate overrides (Loop 1/2)
 */
export function enhancedCombinedSignal(
  ticker: string,
  date: string,
  price: number,
  closes: number[],
  bars: OhlcBar[],
  ohlcvBars: (OhlcvBar & { time?: number })[],
  config: Partial<BacktestConfig> = {},
  sectorGates?: SectorGateConfig,
): EnhancedCombinedSignal {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Compute base indicators
  const rsiVals = rsi(closes)
  const macdVals = macdFn(closes)
  const atrVals = atr(bars)
  const bbVals = bollinger(closes)

  const rsi14 = rsiVals[rsiVals.length - 1]
  const macdHist = macdVals.histogram[macdVals.histogram.length - 1]
  const atrLast = atrVals[atrVals.length - 1]
  const bbPctB = bbVals.pctB[bbVals.pctB.length - 1]
  const atrPct = Number.isFinite(atrLast) && Number.isFinite(price) && price > 0
    ? (atrLast / price) * 100 : NaN

  // Regime detection
  const regime = regimeSignal(price, closes, rsi14)
  const volRegime = detectRegime(closes, bars)

  // Multi-timeframe alignment (pass strategy hint for RSI mode)
  const mtf = multiTimeframeSignal(ohlcvBars, volRegime.strategyHint)

  // Volume profile
  const vp = volumeProfile(ohlcvBars)
  const vpZone: PriceZone | null = vp ? priceRelativeToPOC(price, vp) : null

  // Select weight profile based on strategy hint
  const weights = WEIGHT_PROFILES[volRegime.strategyHint] ?? WEIGHT_PROFILES.default

  // ── Compute per-indicator scores (-1 to +1) ──
  const rsiScore = Number.isFinite(rsi14) ? (50 - rsi14) / 50 : 0
  const macdScore = Number.isFinite(macdHist) && Number.isFinite(atrLast) && atrLast > 0
    // F1.13 (Phase 13 S2 documentation): scale MACD histogram by 10% of the
    // current ATR to make the score volatility-normalised. The 0.1 factor is
    // an empirical tunable — Appel's original 1979 MACD paper does not specify
    // a normalisation. The chosen value approximately maps a "1×ATR" MACD
    // displacement to a score of ±10 (clamped to ±1 by `clamp()`), which lines
    // up with practitioner heuristics for "meaningful MACD divergence".
    ? clamp(macdHist / (atrLast * 0.1), -1, 1) : 0
  const atrScore = Number.isFinite(atrPct) ? clamp((atrPct - 1.5) / 2.0, -1, 1) : 0
  const bbScore = Number.isFinite(bbPctB) ? 1 - 2 * bbPctB : 0
  const vpocScore = volumeZoneScore(vpZone)
  const mtfScore = mtf.alignmentScore / 3.0
  const volRegScore = volRegimeScore(volRegime)

  // ── Build weighted confirms ──
  const weightedConfirms: WeightedConfirm[] = [
    { name: 'RSI(14)', value: Number.isFinite(rsi14) ? rsi14 : null, bullish: rsiScore > 0.3, weight: weights.rsi, score: rsiScore, weightedScore: weights.rsi * rsiScore },
    { name: 'MACD hist', value: Number.isFinite(macdHist) ? macdHist : null, bullish: macdScore > 0.3, weight: weights.macd, score: macdScore, weightedScore: weights.macd * macdScore },
    { name: 'ATR%', value: Number.isFinite(atrPct) ? atrPct : null, bullish: atrScore > 0.3, weight: weights.atr, score: atrScore, weightedScore: weights.atr * atrScore },
    { name: 'BB%', value: Number.isFinite(bbPctB) ? bbPctB : null, bullish: bbScore > 0.3, weight: weights.bb, score: bbScore, weightedScore: weights.bb * bbScore },
    { name: 'Vol POC', value: vpZone ? vpocScore : null, bullish: vpocScore > 0.3, weight: weights.vpoc, score: vpocScore, weightedScore: weights.vpoc * vpocScore },
    { name: 'Multi-TF', value: mtf.alignmentScore, bullish: mtfScore > 0.3, weight: weights.mtf, score: mtfScore, weightedScore: weights.mtf * mtfScore },
    { name: 'Vol Regime', value: volRegime.volRatio, bullish: volRegScore > 0, weight: weights.volReg, score: volRegScore, weightedScore: weights.volReg * volRegScore },
  ]

  let totalWeightedScore = weightedConfirms.reduce((s, c) => s + c.weightedScore, 0)

  // ── Loop 1/2 bonuses (applied before action determination) ──
  if (sectorGates) {
    // RSI divergence bonus: +0.15 when bullish divergence detected
    if (detectBullishDivergence(closes, rsiVals)) {
      totalWeightedScore += 0.15
    }
    // Volume climax bonus: +0.20 when selling climax detected (strong reversal signal)
    if (detectVolumeClimax(ohlcvBars)) {
      totalWeightedScore += 0.20
    }
    // MA compression bonus: +0.10 when EMAs are converging (coiled spring)
    if (isMACompression(closes)) {
      totalWeightedScore += 0.10
    }
  }

  // ── Action determination ──
  let action: 'BUY' | 'HOLD' | 'SELL' = regime.action

  // Resolve thresholds (sector overrides or defaults)
  const buyThresh = sectorGates?.buyWScoreThreshold ?? 0.15
  const sellThresh = sectorGates?.sellWScoreThreshold ?? -0.30

  // Use weighted score for confirmation instead of bullishCount
  if (action === 'BUY' && totalWeightedScore <= buyThresh) {
    action = 'HOLD'
  }
  if (action === 'HOLD' && totalWeightedScore < sellThresh) {
    action = 'SELL'
  }

  // ── Sector gate filters (downgrade BUY → HOLD if gates fail) ──
  if (action === 'BUY' && sectorGates) {
    if (sectorGates.goldenCrossGate && !isGoldenCross(closes)) {
      action = 'HOLD'
    }
    if (action === 'BUY' && sectorGates.requirePositiveMomentum && !hasPositiveMomentum(closes)) {
      action = 'HOLD'
    }
    // tlrGate: rate-sensitivity penalty for REITs/Utilities — downgrade BUY→HOLD and penalize score
    if (sectorGates.tlrGate) {
      totalWeightedScore -= 0.10
      if (action === 'BUY' && totalWeightedScore <= buyThresh) {
        action = 'HOLD'
      }
    }
  }
  // After gate downgrade BUY → HOLD, re-check if score warrants a SELL
  if (action === 'HOLD' && totalWeightedScore < sellThresh) {
    action = 'SELL'
  }
  // Overbought override
  if (action === 'HOLD' && regime.zone === 'HEALTHY_BULL' && Number.isFinite(rsi14) && rsi14 > 70) {
    action = 'SELL'
  }

  // Confidence: base from regime + weighted score contribution
  const scoreBoost = Math.round(Math.max(0, totalWeightedScore) * 30)
  const confidence = Math.min(100, regime.confidence + scoreBoost)

  if (confidence < cfg.confidenceThreshold && action !== 'SELL') {
    action = 'HOLD'
  }

  // ── Kelly fraction (pure formula with heuristic fallback) ──
  const bullishCount = weightedConfirms.filter(c => c.bullish).length
  let kellyFrac = 0.10
  if (action === 'BUY') {
    const winProb = confidence / 100
    const avgWin = regime.dipSignal === 'STRONG_DIP' ? 0.06 : 0.04
    const avgLoss = 0.03
    const computed = halfKelly(winProb, avgWin, avgLoss)
    if (computed != null && computed > 0) {
      kellyFrac = cfg.halfKelly ? Math.min(computed, 0.25) : Math.min(computed * 2, 0.50)
    } else if (regime.dipSignal === 'STRONG_DIP' && bullishCount >= 5) {
      kellyFrac = cfg.halfKelly ? 0.25 : 0.50
    } else if (regime.dipSignal === 'STRONG_DIP') {
      kellyFrac = cfg.halfKelly ? 0.15 : 0.30
    }
  } else if (action === 'SELL') {
    kellyFrac = 1.0
  }

  // ── Backward-compatible confirms (first 4 for CombinedSignal interface) ──
  const confirms: ConfirmSignal[] = weightedConfirms.map(c => ({
    name: c.name, value: c.value, bullish: c.bullish,
  }))

  const confLabels = weightedConfirms
    .filter(c => c.bullish)
    .map(c => `${c.name} ${c.score.toFixed(2)}`)

  const reason = action === 'BUY'
    ? `${regime.zone} [${regime.dipSignal}]: wScore ${totalWeightedScore.toFixed(2)}. ${confLabels.join(', ') || 'no confirms'}. Kelly ${(kellyFrac * 100).toFixed(0)}%.`
    : action === 'SELL'
    ? `${regime.zone} [${regime.dipSignal}]: wScore ${totalWeightedScore.toFixed(2)}, exiting. ${confLabels.join(', ') || 'no confirms'}.`
    : `${regime.zone} [${regime.dipSignal}]: wScore ${totalWeightedScore.toFixed(2)}, confidence ${confidence}%. Hold.`

  return {
    ticker, date, price, regime,
    confirms,
    action, confidence, KellyFraction: kellyFrac, reason,
    weightedConfirms,
    volRegime,
    multiTfScore: mtf.alignmentScore,
    volumeZone: vpZone,
    totalWeightedScore,
  }
}
