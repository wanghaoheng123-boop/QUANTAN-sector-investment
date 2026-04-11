/**
 * Portfolio diversification metrics.
 *
 * Computes:
 *   - Pairwise Pearson correlation matrix (from daily log returns)
 *   - Herfindahl-Hirschman Index (HHI) of portfolio weights
 *   - Effective N (= 1 / HHI) — number of "independent" bets
 *   - Average pairwise correlation (portfolio concentration proxy)
 *   - Diversification ratio (weighted-avg single-asset vol / portfolio vol)
 *
 * All inputs are daily closes aligned to a common date grid.
 */

import { annualizedVolFromCloses } from '@/lib/quant/volatility'

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface AssetCloses {
  ticker: string
  closes: number[]  // aligned to same date grid
}

export interface CorrelationMatrix {
  tickers: string[]
  /** Row-major flat array: matrix[i * n + j] = corr(tickers[i], tickers[j]) */
  matrix: number[]
  /** Convenience accessor */
  get(i: number, j: number): number
}

export interface DiversificationReport {
  correlationMatrix: CorrelationMatrix
  /** Weight HHI ∈ [1/n, 1]. Near 1/n = maximally diverse, near 1 = concentrated. */
  hhi: number
  /** Effective number of positions (1 / HHI). */
  effectiveN: number
  /** Simple average of all off-diagonal correlations. */
  avgPairwiseCorr: number
  /** Weighted-avg standalone vol / true portfolio vol. > 1 means diversification benefit. */
  diversificationRatio: number
  /** Portfolio annualized volatility (exact, uses full correlation matrix). */
  portfolioVol: number
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function logReturns(closes: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      out.push(Math.log(closes[i] / closes[i - 1]))
    }
  }
  return out
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const meanA = a.slice(0, n).reduce((s, x) => s + x, 0) / n
  const meanB = b.slice(0, n).reduce((s, x) => s + x, 0) / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov  += da * db
    varA += da * da
    varB += db * db
  }
  const denom = Math.sqrt(varA * varB)
  return denom === 0 ? 0 : cov / denom
}

// ────────────────────────────────────────────────────────────────
// Correlation matrix
// ────────────────────────────────────────────────────────────────

export function buildCorrelationMatrix(assets: AssetCloses[]): CorrelationMatrix {
  const n = assets.length
  const returns = assets.map((a) => logReturns(a.closes))
  const tickers = assets.map((a) => a.ticker)
  const data = new Array<number>(n * n).fill(0)

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const r = i === j ? 1 : pearson(returns[i], returns[j])
      data[i * n + j] = r
      data[j * n + i] = r
    }
  }

  return {
    tickers,
    matrix: data,
    get(i: number, j: number) { return data[i * n + j] },
  }
}

// ────────────────────────────────────────────────────────────────
// Diversification metrics
// ────────────────────────────────────────────────────────────────

/**
 * Compute a full diversification report.
 *
 * @param assets   Each asset's ticker + aligned close series
 * @param weights  Portfolio weights (must sum to ~1); defaults to equal-weight
 */
export function diversificationReport(
  assets: AssetCloses[],
  weights?: number[],
): DiversificationReport {
  const n = assets.length
  if (n === 0) {
    const empty: CorrelationMatrix = { tickers: [], matrix: [], get: () => 0 }
    return { correlationMatrix: empty, hhi: 0, effectiveN: 0, avgPairwiseCorr: 0, diversificationRatio: 1, portfolioVol: 0 }
  }

  const w = weights && weights.length === n ? weights : assets.map(() => 1 / n)

  // Normalize weights
  const sumW = w.reduce((s, x) => s + x, 0)
  const wn   = sumW > 0 ? w.map((x) => x / sumW) : w

  // Vols
  const vols = assets.map((a) => Math.max(annualizedVolFromCloses(a.closes), 1e-6))

  // Correlation matrix
  const corrMatrix = buildCorrelationMatrix(assets)

  // Portfolio variance: σ²_p = Σ_i Σ_j w_i * w_j * σ_i * σ_j * ρ_ij
  let portfolioVar = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      portfolioVar += wn[i] * wn[j] * vols[i] * vols[j] * corrMatrix.get(i, j)
    }
  }
  const portfolioVol = Math.sqrt(Math.max(portfolioVar, 0))

  // Weighted-avg standalone vol
  const weightedStandaloneVol = wn.reduce((s, wi, i) => s + wi * vols[i], 0)
  const diversificationRatio  = portfolioVol > 0 ? weightedStandaloneVol / portfolioVol : 1

  // HHI of weights
  const hhi = wn.reduce((s, wi) => s + wi * wi, 0)
  const effectiveN = hhi > 0 ? 1 / hhi : n

  // Average pairwise correlation (off-diagonal)
  let corrSum = 0
  let corrCount = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      corrSum += corrMatrix.get(i, j)
      corrCount++
    }
  }
  const avgPairwiseCorr = corrCount > 0 ? corrSum / corrCount : 0

  return {
    correlationMatrix: corrMatrix,
    hhi,
    effectiveN,
    avgPairwiseCorr,
    diversificationRatio,
    portfolioVol,
  }
}

/**
 * Return a qualitative diversification grade based on key metrics.
 *
 * A: Excellent  — effectiveN ≥ 8,  avgCorr < 0.3
 * B: Good       — effectiveN ≥ 5,  avgCorr < 0.5
 * C: Moderate   — effectiveN ≥ 3,  avgCorr < 0.7
 * D: Poor       — otherwise
 */
export function diversificationGrade(report: DiversificationReport): 'A' | 'B' | 'C' | 'D' {
  const { effectiveN, avgPairwiseCorr } = report
  if (effectiveN >= 8 && avgPairwiseCorr < 0.3) return 'A'
  if (effectiveN >= 5 && avgPairwiseCorr < 0.5) return 'B'
  if (effectiveN >= 3 && avgPairwiseCorr < 0.7) return 'C'
  return 'D'
}
