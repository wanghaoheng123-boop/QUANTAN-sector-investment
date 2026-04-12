/**
 * Risk Parity position sizing.
 *
 * Inverse-volatility weighting and iterative risk parity (equal risk contribution).
 *
 * Reference: Qian (2005) "Risk Parity Portfolios", PanAgora Asset Management.
 * Method: Maillard, Roncalli & Teiletche (2010) — iterative ERC algorithm.
 */

/**
 * Compute rolling realized volatility for each instrument.
 * Uses log returns over the last `lookback` bars.
 */
export function rollingVols(
  returnSeries: Record<string, number[]>,
  lookback = 60,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [ticker, rets] of Object.entries(returnSeries)) {
    const window = rets.slice(-lookback)
    if (window.length < 10) continue
    const mean = window.reduce((s, r) => s + r, 0) / window.length
    const variance = window.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, window.length - 1)
    result[ticker] = Math.sqrt(Math.max(0, variance)) * Math.sqrt(252) // annualized
  }
  return result
}

/**
 * Inverse-volatility weighting.
 * Weight_i = (1/vol_i) / sum(1/vol_j)
 *
 * Simple and effective for uncorrelated assets.
 */
export function inverseVolWeights(vols: Record<string, number>): Record<string, number> {
  const entries = Object.entries(vols).filter(([, v]) => v > 0)
  if (entries.length === 0) return {}
  const invVols = entries.map(([t, v]) => ({ ticker: t, invVol: 1 / v }))
  const total = invVols.reduce((s, x) => s + x.invVol, 0)
  const weights: Record<string, number> = {}
  for (const { ticker, invVol } of invVols) {
    weights[ticker] = total > 0 ? invVol / total : 1 / entries.length
  }
  return weights
}

/**
 * Compute the rolling covariance matrix from daily returns.
 *
 * @param returnSeries  Record of ticker -> daily log-returns (same length)
 * @param lookback      Rolling window
 * @returns Covariance matrix as nested record
 */
export function covarianceMatrix(
  returnSeries: Record<string, number[]>,
  lookback = 60,
): Record<string, Record<string, number>> {
  const tickers = Object.keys(returnSeries)
  const sliced: Record<string, number[]> = {}
  for (const t of tickers) {
    sliced[t] = returnSeries[t].slice(-lookback)
  }
  const n = Math.min(...Object.values(sliced).map(v => v.length))
  if (n < 2) return {}

  const means: Record<string, number> = {}
  for (const t of tickers) {
    means[t] = sliced[t].slice(-n).reduce((s, r) => s + r, 0) / n
  }

  const cov: Record<string, Record<string, number>> = {}
  for (const t1 of tickers) {
    cov[t1] = {}
    for (const t2 of tickers) {
      let sum = 0
      const r1 = sliced[t1].slice(-n)
      const r2 = sliced[t2].slice(-n)
      for (let i = 0; i < n; i++) {
        sum += (r1[i] - means[t1]) * (r2[i] - means[t2])
      }
      cov[t1][t2] = sum / Math.max(1, n - 1) * 252 // annualized
    }
  }
  return cov
}

/**
 * Equal Risk Contribution (ERC / Risk Parity) weights via iterative algorithm.
 *
 * Each position contributes an equal fraction to total portfolio risk.
 * Converges in ~50-200 iterations for typical portfolios.
 *
 * @param cov        Covariance matrix (annualized)
 * @param maxIter    Max iterations (default 500)
 * @param tolerance  Convergence tolerance (default 1e-8)
 */
export function ercWeights(
  cov: Record<string, Record<string, number>>,
  maxIter = 500,
  tolerance = 1e-8,
): Record<string, number> {
  const tickers = Object.keys(cov)
  const n = tickers.length
  if (n === 0) return {}

  // Build matrix
  const sigma: number[][] = tickers.map(t1 => tickers.map(t2 => cov[t1]?.[t2] ?? 0))

  // Start with equal weights
  let w = tickers.map(() => 1 / n)

  for (let iter = 0; iter < maxIter; iter++) {
    const prevW = [...w]

    // Portfolio variance
    let portVar = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        portVar += w[i] * w[j] * sigma[i][j]
      }
    }
    const portVol = Math.sqrt(Math.max(portVar, 1e-12))

    // Marginal risk contributions (grad of portfolio vol)
    const mrc: number[] = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        mrc[i] += sigma[i][j] * w[j]
      }
      mrc[i] /= portVol
    }

    // Risk contributions
    const rc = w.map((wi, i) => wi * mrc[i])
    const targetRC = portVol / n  // equal contribution target

    // Update weights
    for (let i = 0; i < n; i++) {
      w[i] = w[i] * targetRC / Math.max(rc[i], 1e-12)
    }

    // Normalize
    const sumW = w.reduce((s, x) => s + x, 0)
    w = w.map(x => x / sumW)

    // Check convergence
    const maxChange = Math.max(...w.map((wi, i) => Math.abs(wi - prevW[i])))
    if (maxChange < tolerance) break
  }

  const result: Record<string, number> = {}
  tickers.forEach((t, i) => { result[t] = w[i] })
  return result
}

/**
 * Correlation-adjusted Kelly fraction.
 * Reduces position size when adding a stock increases portfolio correlation.
 *
 * @param baseKelly        Signal-derived Kelly fraction
 * @param stockReturns     Daily returns for the new stock
 * @param portfolioReturns Current portfolio daily returns
 * @param threshold        Max acceptable correlation increase (default 0.2)
 */
export function correlationAdjustedKelly(
  baseKelly: number,
  stockReturns: number[],
  portfolioReturns: number[],
  threshold = 0.20,
): number {
  const n = Math.min(stockReturns.length, portfolioReturns.length, 60)
  if (n < 10) return baseKelly

  const sR = stockReturns.slice(-n)
  const pR = portfolioReturns.slice(-n)

  const meanS = sR.reduce((s, r) => s + r, 0) / n
  const meanP = pR.reduce((s, r) => s + r, 0) / n

  let cov = 0, varS = 0, varP = 0
  for (let i = 0; i < n; i++) {
    cov += (sR[i] - meanS) * (pR[i] - meanP)
    varS += (sR[i] - meanS) ** 2
    varP += (pR[i] - meanP) ** 2
  }

  const corr = (varS > 0 && varP > 0) ? cov / Math.sqrt(varS * varP) : 0

  // If correlation > threshold, scale Kelly down proportionally
  if (corr > threshold) {
    const scale = Math.max(0.3, 1 - (corr - threshold) / (1 - threshold))
    return baseKelly * scale
  }
  return baseKelly
}
