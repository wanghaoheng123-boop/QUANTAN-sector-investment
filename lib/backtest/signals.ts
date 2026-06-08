/**
 * Backtest signal generators — shared across API routes and scripts.
 * Uses canonical indicators from lib/quant/indicators.ts.
 */

import type { OhlcBar, OhlcvBar } from '@/lib/quant/indicators'
import { useEnhancedCombinedSignal } from '@/lib/featureFlags'
import {
  smaLatest as sma,
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

// NOTE: indicators are NOT re-exported from here. Consumers import them from the
// canonical SSOT (`@/lib/quant/indicators`) directly so signals.ts is not a second
// import surface for indicator functions (structure review P1-06).

// ─── Re-exports from split modules ───────────────────────────────────────────
// All helpers, types, and regime logic live in sibling modules.
// Every name that signals.ts previously exported directly is re-exported here
// so that ALL existing import paths remain unchanged.

export {
  piecewiseRsiScore,
  isGoldenCross,
  hasPositiveMomentum,
  detectBullishDivergence,
  detectVolumeClimax,
  isMACompression,
  sma200DeviationPct,
  sma200Slope,
  priceWasNearSmaRecently,
} from './signalHelpers'

export type {
  DipSignal,
  RegimeSignal,
  BacktestConfig,
  ConfirmSignal,
  CombinedSignal,
  WeightedConfirm,
  EnhancedCombinedSignal,
  SectorGateConfig,
} from './signalTypes'

export { DEFAULT_CONFIG } from './signalTypes'

export { regimeSignal } from './regimeSignal'

// ─── Private imports for enhancedCombinedSignal ───────────────────────────────
import {
  piecewiseRsiScore,
  isGoldenCross,
  hasPositiveMomentum,
  detectBullishDivergence,
  detectVolumeClimax,
  isMACompression,
} from './signalHelpers'
import type {
  BacktestConfig,
  ConfirmSignal,
  WeightedConfirm,
  EnhancedCombinedSignal,
  SectorGateConfig,
} from './signalTypes'
import { DEFAULT_CONFIG } from './signalTypes'
import { regimeSignal, clamp, WEIGHT_PROFILES, volumeZoneScore, volRegimeScore } from './regimeSignal'

// ─── Enhanced weighted confluence signal ──────────────────────────────────────

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
  //
  // CRITICAL ensemble property: every score MUST lie in [-1, +1] so that
  // the weighted sum (Σ wᵢ · sᵢ, with Σ wᵢ = 1) is bounded in [-1, +1].
  // A single unclamped score can dominate the entire weighted ensemble.
  //
  // Phase 13 S2 — TEAM AUDIT (Quant + AI + Full-stack):
  //
  //   Bug found: bbScore = 1 - 2 * bbPctB was UNCLAMPED. When price
  //   overshoots a Bollinger band — common in strong trends — bbPctB
  //   exceeds [0, 1]:
  //     bbPctB =  1.5 (price 50% above upper band)  → bbScore = -2.0
  //     bbPctB = -0.5 (price 50% below lower band)  → bbScore = +2.0
  //   With weight 0.15, the contribution is ±0.30 — alone matching the
  //   SELL threshold (-0.30) or doubling the BUY threshold (+0.15).
  //   A single-bar Bollinger overshoot could silently flip the ensemble.
  //
  //   Bug found: rsiScore = (50 - rsi14) / 50 assumed rsi14 ∈ [0, 100]
  //   but had no explicit clamp. RSI is mathematically bounded by Wilder's
  //   construction, but a numerical bug in the indicator (e.g. a divide-by-
  //   tiny-loss) could emit out-of-range values that would silently swing
  //   the ensemble.
  //
  // Fix: clamp ALL per-indicator scores to [-1, +1] explicitly.
  //
  // Citation: Kuncheva, L. I. (2014). *Combining Pattern Classifiers:
  //           Methods and Algorithms* (2nd ed.), Wiley, §4.2 — weighted-
  //           combination ensemble bounds require homogeneous base-learner
  //           output ranges. Unbounded base learners produce unbounded
  //           ensemble outputs, which break threshold-based decision rules.
  const rsiScore = Number.isFinite(rsi14) ? piecewiseRsiScore(rsi14) : 0
  const macdScore = Number.isFinite(macdHist) && Number.isFinite(atrLast) && atrLast > 0
    // F1.13 (Phase 13 S2 documentation): scale MACD histogram by 10% of the
    // current ATR to make the score volatility-normalised. The 0.1 factor is
    // an empirical tunable — Appel's original 1979 MACD paper does not specify
    // a normalisation. The chosen value approximately maps a "1×ATR" MACD
    // displacement to a score of ±10 (clamped to ±1 by `clamp()`), which lines
    // up with practitioner heuristics for "meaningful MACD divergence".
    ? clamp(macdHist / (atrLast * 0.1), -1, 1) : 0
  // D2-6: dip-buy favors calmer vol — high ATR% is cautious (negative), not bullish
  const atrScore = Number.isFinite(atrPct) ? clamp((1.5 - atrPct) / 2.0, -1, 1) : 0
  const bbScore = Number.isFinite(bbPctB) ? clamp(1 - 2 * bbPctB, -1, 1) : 0
  const vpocScore = volumeZoneScore(vpZone)
  // mtf.alignmentScore is in [-3, +3] (sum of 3 timeframe contributions);
  // /3 maps to [-1, +1] exactly under the existing contract, but clamp
  // defensively against future changes to multiTimeframeSignal's range.
  const mtfScore = clamp(mtf.alignmentScore / 3.0, -1, 1)
  // volRegimeScore returns values from a fixed enum (-0.8 .. +0.5) so a
  // clamp here is for defence-in-depth (no current path can exceed ±1).
  const volRegScore = clamp(volRegimeScore(volRegime), -1, 1)

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

  // Resolve thresholds (sector overrides or defaults).
  // Q1-C-5 (Phase 14 S1): BUY threshold raised from 0.15 → 0.25 to reduce false positives.
  // The function docstring already stated "> 0.25" but the default was 0.15 — a comment/code
  // contradiction. At 0.15, a single RSI score of 0.30 (weight 0.20) alone exceeds the
  // threshold; at 0.25, at least two confirming indicators are needed in a typical regime.
  //
  // C2 algorithm-lead approval: documented here. Impact tracked by post-fix benchmark run.
  // Citation: Kuncheva (2014) §4.2 — ensemble threshold should reflect the minimum
  // confluence of base learners; a 0.25 threshold requires ~2 confirming signals
  // weighted ≥ 0.13 each (matches the platform's 7-factor weight layout).
  const buyThresh = sectorGates?.buyWScoreThreshold ?? 0.25
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

/** Production signal resolver — enhanced gated by Q-009 feature flag. */
export function resolveBacktestSignal(
  ticker: string,
  date: string,
  price: number,
  closes: number[],
  bars: OhlcBar[],
  ohlcvBars: (OhlcvBar & { time?: number })[],
  config: Partial<BacktestConfig> = {},
  sectorGates?: SectorGateConfig,
): EnhancedCombinedSignal {
  if (useEnhancedCombinedSignal()) {
    return enhancedCombinedSignal(ticker, date, price, closes, bars, ohlcvBars, config, sectorGates)
  }
  const rsi14 = rsi(closes).at(-1) ?? NaN
  const regime = regimeSignal(price, closes, rsi14)
  const cfg = { ...DEFAULT_CONFIG, ...config }
  let kellyFrac = 0.10
  if (regime.action === 'BUY') kellyFrac = cfg.halfKelly ? 0.15 : 0.30
  if (regime.action === 'SELL') kellyFrac = 1.0
  return {
    ticker,
    date,
    price,
    regime,
    confirms: [],
    action: regime.action,
    confidence: regime.confidence,
    KellyFraction: kellyFrac,
    reason: `${regime.zone} [regime-only path; enhanced disabled in production]`,
    weightedConfirms: [],
    volRegime: detectRegime(closes, bars),
    multiTfScore: 0,
    volumeZone: null,
    totalWeightedScore: 0,
  }
}
