/**
 * Portfolio diversification metrics.
 *
 * - Correlation matrix and average pairwise correlation
 * - Herfindahl-Hirschman Index (HHI) — concentration measure
 * - Sector exposure breakdown
 * - Diversification ratio (weighted avg vol / portfolio vol)
 */

import { pearsonCorrelation } from '@/lib/quant/correlation'

/**
 * Thin adapter over the SSOT pearsonCorrelation primitive
 * (lib/quant/correlation.ts) — preserves the local convention of
 * returning 0 for degenerate inputs (length < 2 or zero variance)
 * instead of null. Phase 13 S2 team-audit cleanup eliminated three
 * inline duplicates of this math across lib/portfolio/* and
 * lib/quant/intermarket.ts; this one was the last.
 */
function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  // Align tails — both series end at the same observation, matching the
  // prior in-file implementation's semantics.
  const aSlice = a.slice(-n)
  const bSlice = b.slice(-n)
  const rho = pearsonCorrelation(aSlice, bSlice)
  return rho == null ? 0 : rho
}

export interface CorrelationMatrix {
  tickers: string[]
  matrix: number[][]  // [i][j] = correlation between tickers[i] and tickers[j]
  avgPairwiseCorr: number
  maxCorr: { tickers: [string, string]; corr: number }
  minCorr: { tickers: [string, string]; corr: number }
}

/**
 * Compute full pairwise correlation matrix.
 */
export function correlationMatrix(
  returnSeries: Record<string, number[]>,
  lookback = 60,
): CorrelationMatrix {
  const tickers = Object.keys(returnSeries)
  const n = tickers.length
  const sliced: Record<string, number[]> = {}
  for (const t of tickers) sliced[t] = returnSeries[t].slice(-lookback)

  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  let corrSum = 0, corrCount = 0

  // Guard: single-asset portfolios have no pairwise correlations
  if (n < 2) {
    return {
      tickers,
      matrix,
      avgPairwiseCorr: 0,
      maxCorr: { tickers: [tickers[0] ?? '', tickers[0] ?? ''] as [string, string], corr: 0 },
      minCorr: { tickers: [tickers[0] ?? '', tickers[0] ?? ''] as [string, string], corr: 0 },
    }
  }

  let maxCorr = { tickers: [tickers[0], tickers[1]] as [string, string], corr: -Infinity }
  let minCorr = { tickers: [tickers[0], tickers[1]] as [string, string], corr: Infinity }

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const c = pearsonCorr(sliced[tickers[i]], sliced[tickers[j]])
      matrix[i][j] = c
      matrix[j][i] = c
      corrSum += c
      corrCount++
      if (c > maxCorr.corr) maxCorr = { tickers: [tickers[i], tickers[j]], corr: c }
      if (c < minCorr.corr) minCorr = { tickers: [tickers[i], tickers[j]], corr: c }
    }
  }

  return {
    tickers,
    matrix,
    avgPairwiseCorr: corrCount > 0 ? corrSum / corrCount : 0,
    maxCorr,
    minCorr,
  }
}

/**
 * Herfindahl-Hirschman Index (HHI) — measures portfolio concentration.
 * HHI = sum(weight_i^2)
 *   - HHI = 1.0 → fully concentrated in one asset
 *   - HHI = 1/n → perfectly diversified (equal weights)
 * Normalized HHI = (HHI - 1/n) / (1 - 1/n) → 0 = max diversified, 1 = max concentrated
 */
export function herfindahlIndex(weights: Record<string, number>): {
  hhi: number
  normalizedHHI: number
  effectiveN: number
  interpretation: 'concentrated' | 'moderate' | 'diversified'
} {
  const vals = Object.values(weights).filter(w => w > 0)
  if (vals.length === 0) return { hhi: 1, normalizedHHI: 1, effectiveN: 1, interpretation: 'concentrated' }
  const n = vals.length
  const hhi = vals.reduce((s, w) => s + w * w, 0)
  const normalizedHHI = n > 1 ? (hhi - 1 / n) / (1 - 1 / n) : 1
  const effectiveN = hhi > 0 ? 1 / hhi : n  // equivalent number of equal-weight assets

  const interpretation: 'concentrated' | 'moderate' | 'diversified' =
    normalizedHHI > 0.6 ? 'concentrated' :
    normalizedHHI > 0.3 ? 'moderate' : 'diversified'

  return { hhi, normalizedHHI, effectiveN, interpretation }
}

export interface SectorExposure {
  sector: string
  weight: number
  tickers: string[]
  tickerWeights: Record<string, number>
}

/**
 * Sector exposure breakdown from positions and their sectors.
 */
export function sectorExposure(
  weights: Record<string, number>,
  tickerSectors: Record<string, string>,
): SectorExposure[] {
  const sectorMap: Record<string, { weight: number; tickers: string[]; tickerWeights: Record<string, number> }> = {}

  for (const [ticker, weight] of Object.entries(weights)) {
    if (weight <= 0) continue
    const sector = tickerSectors[ticker] ?? 'Unknown'
    if (!sectorMap[sector]) sectorMap[sector] = { weight: 0, tickers: [], tickerWeights: {} }
    sectorMap[sector].weight += weight
    sectorMap[sector].tickers.push(ticker)
    sectorMap[sector].tickerWeights[ticker] = weight
  }

  return Object.entries(sectorMap)
    .map(([sector, data]) => ({ sector, ...data }))
    .sort((a, b) => b.weight - a.weight)
}

/** Minimum observations required for a meaningful vol estimate. */
const MIN_VOL_OBS = 5

/**
 * Diversification ratio = (weighted average vol) / (portfolio vol).
 *   DR = 1 → no diversification (all returns perfectly correlated).
 *   DR = √n → maximum diversification (all uncorrelated equal-vol assets).
 *
 * Phase 13 S2: returns now include a warnings field for data-quality issues
 * (mirrors stressTest's pattern). Callers can distinguish "DR=1 because
 * portfolio is single-asset / fully-correlated" (legitimate) from "DR=1
 * because we couldn't compute" (degraded).
 *
 * Citation: Choueifaty, Y. & Coignard, Y. (2008). "Toward Maximum
 *           Diversification." Journal of Portfolio Management, 35(1), 40-51.
 */
export interface DiversificationRatioResult {
  ratio: number
  /** Observations used in the portfolio-vol computation (max across tickers). */
  observations: number
  /** Data-quality issues encountered. Empty array == clean run. */
  warnings: string[]
}

export function diversificationRatio(
  returnSeries: Record<string, number[]>,
  weights: Record<string, number>,
  lookback = 60,
): DiversificationRatioResult {
  const warnings: string[] = []
  const tickers = Object.keys(weights).filter(t => weights[t] > 0)
  if (tickers.length < 2) {
    return {
      ratio: 1,
      observations: 0,
      warnings: tickers.length === 0
        ? ['Empty portfolio — diversification ratio undefined; returning 1.']
        : ['Single-asset portfolio — diversification ratio definitionally 1.'],
    }
  }

  // Individual vols, with per-ticker warnings for short histories.
  const vols: Record<string, number> = {}
  const shortHistoryTickers: string[] = []
  for (const t of tickers) {
    const rets = (returnSeries[t] ?? []).slice(-lookback)
    if (rets.length < MIN_VOL_OBS) {
      shortHistoryTickers.push(t)
      continue
    }
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1)
    vols[t] = Math.sqrt(Math.max(0, variance))
  }
  if (shortHistoryTickers.length > 0) {
    warnings.push(
      `${shortHistoryTickers.length} ticker(s) had <${MIN_VOL_OBS} obs in the lookback ` +
      `window and were excluded from the vol average: ${shortHistoryTickers.join(', ')}.`,
    )
  }

  // Weighted average vol. Use the actual computed-vol tickers, not the full set.
  const measurableTickers = tickers.filter(t => vols[t] != null)
  const weightedAvgVol = measurableTickers.reduce(
    (s, t) => s + (weights[t] ?? 0) * (vols[t] ?? 0),
    0,
  )

  // Portfolio returns — use MAX of non-empty lengths (Phase 13 S2 fail-closed
  // pattern, mirrors stressTest.ts fix). Previously Math.min(...lengths)
  // silently returned 1 when any one ticker had zero history.
  const nonEmptyLengths = tickers
    .map(t => (returnSeries[t] ?? []).length)
    .filter(len => len > 0)
  const n = nonEmptyLengths.length > 0 ? Math.max(...nonEmptyLengths) : 0

  if (n < MIN_VOL_OBS) {
    warnings.push(
      `Insufficient return history (${n} obs across all tickers) ` +
      `to compute portfolio vol; returning DR=1.`,
    )
    return { ratio: 1, observations: n, warnings }
  }

  const portReturns: number[] = new Array(n).fill(0)
  for (const t of tickers) {
    const rets = (returnSeries[t] ?? [])
    if (rets.length === 0) continue
    const sliced = rets.slice(-n)
    for (let i = 0; i < sliced.length; i++) {
      portReturns[i] += (weights[t] ?? 0) * sliced[i]
    }
  }

  const portMean = portReturns.reduce((s, r) => s + r, 0) / n
  const portVariance = portReturns.reduce((s, r) => s + (r - portMean) ** 2, 0) / Math.max(1, n - 1)
  const portVol = Math.sqrt(Math.max(0, portVariance))

  const ratio = portVol > 0 ? weightedAvgVol / portVol : 1
  return { ratio, observations: n, warnings }
}
