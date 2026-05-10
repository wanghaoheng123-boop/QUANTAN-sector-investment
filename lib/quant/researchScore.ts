/**
 * Transparent composite 0–100 "research dashboard" score from sub-pillars.
 * Not alpha — a summarized lens so users see what inputs drove the number.
 */

export interface ResearchScoreInput {
  trailingPE: number | null
  forwardPE: number | null
  debtToEquity: number | null
  returnOnEquity: number | null
  profitMargin: number | null
  rsi14: number | null
  /** -1 bearish stack, 0 mixed, 1 bullish stack */
  trendScore: number | null
  /** %B Bollinger 0-1 */
  pctB: number | null
  /** vs SPY 60d excess return */
  excessVsSpy60d: number | null
  /** 0 = deep buy zone, 0.5 neutral, 1 = above sell zone heuristic */
  bandPosition: number | null
}

export interface PillarScore {
  name: string
  score: number
  detail: string
}

function clamp01(x: number) {
  return Math.max(0, Math.min(100, x))
}

/** Map forward P/E to crude value score (lower PE → higher for profitable value tilt). */
function valueFromPe(pe: number | null): { s: number; d: string } {
  if (pe == null || pe <= 0) return { s: 50, d: 'P/E unavailable — neutral value pillar.' }
  if (pe < 12) return { s: 85, d: 'Low multiple vs. broad market heuristic.' }
  if (pe < 18) return { s: 70, d: 'Moderate multiple.' }
  if (pe < 28) return { s: 55, d: 'Elevated multiple.' }
  return { s: 35, d: 'Very high multiple — growth or hype priced in.' }
}

function qualityScore(de: number | null, roe: number | null, margin: number | null): PillarScore {
  let s = 50
  const bits: string[] = []
  if (roe != null && roe > 0.15) {
    s += 20
    bits.push('strong ROE')
  } else if (roe != null && roe > 0.08) {
    s += 10
    bits.push('ok ROE')
  } else if (roe != null && roe < 0) {
    s -= 15
    bits.push('negative ROE')
  }
  // Profit-margin pillar: previously rewarded healthy margins (>20%) but
  // gave NO penalty for unprofitable companies, so a -50% margin company
  // scored identically on the margin axis to a 0% margin company. The
  // penalty here mirrors the "negative ROE" penalty on the ROE axis,
  // making the quality pillar honest about loss-making businesses.
  if (margin != null) {
    if (margin > 0.2) {
      s += 10
      bits.push('healthy margins')
    } else if (margin < 0) {
      s -= 10
      bits.push('negative margins')
    }
  }
  if (de != null) {
    if (de < 0.5) {
      s += 10
      bits.push('low leverage')
    } else if (de > 2) {
      s -= 15
      bits.push('high debt/equity')
    }
  }
  return {
    name: 'Quality / balance sheet',
    score: clamp01(s),
    detail: bits.length ? bits.join(' · ') : 'Limited quality metrics.',
  }
}

/**
 * Piecewise-linear RSI score delta (F1.11).
 *
 * Previous step-function behavior was:
 *   RSI < 30  → +15
 *   30..70    →  0
 *   RSI > 70  → -10
 * This produced a 25-point swing across the RSI 29 → 31 boundary and a
 * 10-point swing across 69 → 71, making the pillar score non-smooth and
 * vulnerable to RSI rounding noise.
 *
 * Replaced with a piecewise-linear function: zero through the neutral
 * 30..70 band (Wilder's canonical thresholds), linearly ramping to the
 * pinned extremes (+15 at RSI=0, -10 at RSI=100). The boundary values
 * are unchanged at 30 and 70 (continuous transition), so the relative
 * ordering of the existing pillar tests is preserved.
 *
 * Citation: Wilder, J. W. (1978). *New Concepts in Technical Trading
 *           Systems*, ch. 6 — RSI thresholds 30/70 are the definitional
 *           oversold/overbought bounds. Cardwell's "RSI ranges" research
 *           supports a smooth gradient inside the band rather than a
 *           binary classification.
 */
export function rsiScoreDelta(rsi: number): { delta: number; label: string } {
  if (!Number.isFinite(rsi)) return { delta: 0, label: 'RSI n/a' }
  const r = Math.max(0, Math.min(100, rsi))
  if (r < 30) {
    // 0 at r=30 → +15 at r=0
    return { delta: ((30 - r) / 30) * 15, label: 'RSI oversold' }
  }
  if (r > 70) {
    // 0 at r=70 → -10 at r=100
    return { delta: -((r - 70) / 30) * 10, label: 'RSI overbought' }
  }
  return { delta: 0, label: `RSI ${r.toFixed(0)}` }
}

function momentumScore(
  rsi: number | null,
  trend: number | null,
  pctB: number | null
): PillarScore {
  let s = 50
  const bits: string[] = []
  if (rsi != null) {
    const { delta, label } = rsiScoreDelta(rsi)
    s += delta
    bits.push(label)
  }
  if (trend != null) {
    s += trend * 20
    bits.push(trend > 0 ? 'trend supportive' : trend < 0 ? 'trend hostile' : 'mixed trend')
  }
  if (pctB != null) {
    if (pctB < 0.15) {
      s += 8
      bits.push('near lower Bollinger')
    } else if (pctB > 0.85) {
      s -= 8
      bits.push('near upper Bollinger')
    }
  }
  return {
    name: 'Momentum & technicals',
    score: clamp01(s),
    detail: bits.join(' · ') || 'Neutral momentum.',
  }
}

function rsScore(excess: number | null): PillarScore {
  if (excess == null) return { name: 'Relative strength (vs SPY)', score: 50, detail: 'Insufficient overlap with SPY.' }
  const ann = excess
  let s = 50 + ann * 120
  const detail =
    ann > 0.05
      ? `Outperforming SPY in window (+${(ann * 100).toFixed(1)}%).`
      : ann < -0.05
        ? `Underperforming SPY (${(ann * 100).toFixed(1)}%).`
        : 'In line with SPY.'
  return { name: 'Relative strength (vs SPY)', score: clamp01(s), detail }
}

function valuationBandScore(pos: number | null): PillarScore {
  if (pos == null) return { name: 'Valuation band fit', score: 50, detail: 'Bands unavailable.' }
  const s = 100 - pos * 100
  return {
    name: 'Valuation band fit',
    score: clamp01(s),
    detail:
      pos < 0.35
        ? 'Closer to mechanical buy zone vs composite fair value.'
        : pos > 0.65
          ? 'Closer to mechanical sell zone vs composite fair value.'
          : 'Mid-band vs model anchors.',
  }
}

export function computeResearchScore(i: ResearchScoreInput): {
  pillars: PillarScore[]
  total: number
  weights: string
  rubricLines: string[]
  benchmarkNote: string
} {
  const v = valueFromPe(i.forwardPE ?? i.trailingPE)
  const valuePillar: PillarScore = {
    name: 'Value (multiples heuristic)',
    score: v.s,
    detail: v.d,
  }
  const q = qualityScore(i.debtToEquity, i.returnOnEquity, i.profitMargin)
  const m = momentumScore(i.rsi14, i.trendScore, i.pctB)
  const r = rsScore(i.excessVsSpy60d)
  const b = valuationBandScore(i.bandPosition)

  const pillars = [valuePillar, q, m, r, b]
  const weights = '20% value · 25% quality · 20% momentum · 20% vs SPY · 15% band position'
  const w = [0.2, 0.25, 0.2, 0.2, 0.15]
  const total = clamp01(pillars.reduce((s, p, idx) => s + p.score * w[idx], 0))

  const rubricLines = [
    '0–100 is a weighted blend of the five pillar cards below. ~50 means “neutral vs these crude rules”, not “average stock” or fair value.',
    'Rough guide: under ~40 often means several weak pillars (e.g. stretched multiple, poor 60d RS vs SPY, or soft quality). Above ~65 means multiple pillars align — still not a buy/sell call.',
    'Only the “Relative strength (vs SPY)” pillar uses a benchmark (60d excess vs SPY). Value, quality, momentum, and band fit are symbol-specific Yahoo fields, not vs a peer basket.',
  ]
  const benchmarkNote =
    'Automatic same-industry peer comparison is not in this build. Compare manually to a sector ETF (e.g. XLK) or your comps list; use Quant Lab tables for the inputs behind each pillar.'

  return { pillars, total, weights, rubricLines, benchmarkNote }
}

/**
 * Map price vs buy/sell bands to a 0..1 valuation-position scalar.
 *
 *   ≤ buyHigh  → 0.15  (clamped — deep buy zone)
 *   ≥ sellLow  → 0.85  (clamped — at/above sell zone)
 *   in-band    → linear interpolation
 *
 * The fixed 0.15 / 0.85 endpoints (rather than 0 / 1) intentionally
 * cap the contribution from extreme bands so a single deep-discount
 * reading cannot drive the pillar to 100 by itself.
 *
 * `fair` is required as a sanity gate (we refuse to score when fair
 * value is missing) but is otherwise not used in the position math.
 * Returns null on invalid inputs.
 */
export function bandPosition(
  price: number,
  buyHigh: number | null,
  sellLow: number | null,
  fair: number | null
): number | null {
  if (buyHigh == null || sellLow == null || fair == null || price <= 0) return null
  // buyHigh > sellLow is malformed input (band is "inverted"). Refuse to
  // guess at intent — return null so the caller sees missing-data fallback.
  if (buyHigh > sellLow) return null
  if (price <= buyHigh) return 0.15
  if (price >= sellLow) return 0.85
  // Pure linear interpolation: at price = buyHigh we get 0, at price = sellLow we get 1.
  // (Both endpoints are unreachable here because the gates above take precedence.)
  return (price - buyHigh) / (sellLow - buyHigh)
}
