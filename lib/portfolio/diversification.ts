/**
 * Portfolio diversification metrics.
 *
 * - Correlation matrix and average pairwise correlation
 * - Herfindahl-Hirschman Index (HHI) — concentration measure
 * - Sector exposure breakdown
 * - Diversification ratio (weighted avg vol / portfolio vol)
 */

/**
 * Pearson correlation between two equal-length return series.
 */
function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const aSlice = a.slice(-n)
  const bSlice = b.slice(-n)
  const meanA = aSlice.reduce((s, x) => s + x, 0) / n
  const meanB = bSlice.reduce((s, x) => s + x, 0) / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    cov += (aSlice[i] - meanA) * (bSlice[i] - meanB)
    varA += (aSlice[i] - meanA) ** 2
    varB += (bSlice[i] - meanB) ** 2
  }
  return varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0
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

/**
 * Diversification ratio = (weighted average vol) / (portfolio vol).
 * Higher ratio = more diversification benefit.
 * DR = 1 → no diversification (all returns perfectly correlated).
 * DR = sqrt(n) → maximum diversification (all uncorrelated equal-vol assets).
 */
export function diversificationRatio(
  returnSeries: Record<string, number[]>,
  weights: Record<string, number>,
  lookback = 60,
): number {
  const tickers = Object.keys(weights).filter(t => weights[t] > 0)
  if (tickers.length < 2) return 1

  // Individual vols
  const vols: Record<string, number> = {}
  for (const t of tickers) {
    const rets = (returnSeries[t] ?? []).slice(-lookback)
    if (rets.length < 5) continue
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1)
    vols[t] = Math.sqrt(Math.max(0, variance))
  }

  // Weighted average vol
  const weightedAvgVol = tickers.reduce((s, t) => s + (weights[t] ?? 0) * (vols[t] ?? 0), 0)

  // Portfolio returns (weighted sum)
  const n = Math.min(...tickers.map(t => (returnSeries[t] ?? []).length))
  if (n < 5) return 1

  const portReturns: number[] = new Array(n).fill(0)
  for (const t of tickers) {
    const rets = (returnSeries[t] ?? []).slice(-n)
    for (let i = 0; i < n; i++) {
      portReturns[i] += (weights[t] ?? 0) * (rets[i] ?? 0)
    }
  }

  const portMean = portReturns.reduce((s, r) => s + r, 0) / n
  const portVariance = portReturns.reduce((s, r) => s + (r - portMean) ** 2, 0) / Math.max(1, n - 1)
  const portVol = Math.sqrt(Math.max(0, portVariance))

  return portVol > 0 ? weightedAvgVol / portVol : 1
}
