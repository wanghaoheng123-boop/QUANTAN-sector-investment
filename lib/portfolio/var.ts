/**
 * Value at Risk (VaR) and Conditional VaR (CVaR/Expected Shortfall).
 *
 * Institutional requirement: JPM/Citi/GS risk frameworks require VaR at
 * 95% and 99% confidence levels, both 1-day and 10-day horizons.
 *
 * Methods implemented:
 *   1. Historical simulation VaR — non-parametric, uses rolling window of returns.
 *   2. Parametric VaR (Gaussian) — assumes normal distribution.
 *   3. CVaR (Expected Shortfall) — mean of losses beyond VaR threshold.
 *
 * All functions work on log-returns (more mathematically correct for VaR).
 *
 * References:
 *   - J.P. Risk Management Framework (Basel III)
 *   - Hull, "Risk Management and Financial Institutions", 4th Ed., Ch. 12
 */

// Normal distribution inverse CDF (Probit) approximation — Abramowitz & Stegun
function probitApprox(p: number): number {
  // For VaR we need the left tail, i.e. z such that P(Z < z) = 1 - confidenceLevel
  const a0 = 2.515517, a1 = 0.802853, a2 = 0.010328
  const b1 = 1.432788, b2 = 0.189269, b3 = 0.001308
  const t = Math.sqrt(-2 * Math.log(p))
  const num = a0 + a1 * t + a2 * t * t
  const den = 1 + b1 * t + b2 * t * t + b3 * t * t * t
  return t - num / den
}

function normalQuantile(p: number): number {
  // Returns z such that P(Z < z) = p for Z ~ N(0,1)
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p < 0.5) return -probitApprox(p)
  return probitApprox(1 - p)
}

export interface VaRResult {
  /** Confidence level, e.g. 0.95 or 0.99 */
  confidence: number
  /** Horizon in days */
  horizon: number
  /** Historical simulation VaR (as positive fraction, e.g. 0.03 = 3% loss) */
  historicalVaR: number
  /** Parametric (Gaussian) VaR */
  parametricVaR: number
  /** CVaR / Expected Shortfall (historical) */
  historicalCVaR: number
  /** Annualized volatility used in parametric calc */
  annualizedVol: number
  /** Number of observations used */
  observations: number
}

/**
 * Compute VaR and CVaR from a series of daily log-returns.
 *
 * @param dailyLogReturns  Array of log-returns (len >= 30 recommended)
 * @param confidenceLevel  Confidence level, e.g. 0.95 or 0.99
 * @param horizon          Number of trading days (default 1)
 * @returns VaRResult or null if insufficient data
 */
export function computeVaR(
  dailyLogReturns: number[],
  confidenceLevel: number,
  horizon = 1,
): VaRResult | null {
  const n = dailyLogReturns.length
  if (n < 30) return null

  // 1. Historical simulation
  const sorted = [...dailyLogReturns].sort((a, b) => a - b) // ascending (worst first)
  const alpha = 1 - confidenceLevel  // e.g. 0.05 for 95%
  const varIdx = Math.floor(alpha * n)
  const histVaR1d = -sorted[Math.max(0, varIdx)]  // positive number = loss

  // Scale to horizon: VaR_T = VaR_1 * sqrt(T) (Basel approximation)
  const histVaR = histVaR1d * Math.sqrt(horizon)

  // 2. Historical CVaR (mean of losses beyond VaR)
  const tailReturns = sorted.slice(0, varIdx + 1)
  const histCVaR1d = tailReturns.length > 0
    ? -tailReturns.reduce((s, r) => s + r, 0) / tailReturns.length
    : histVaR1d
  const histCVaR = histCVaR1d * Math.sqrt(horizon)

  // 3. Parametric VaR (Gaussian)
  const mean = dailyLogReturns.reduce((s, r) => s + r, 0) / n
  const variance = dailyLogReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, n - 1)
  const dailyStd = Math.sqrt(Math.max(0, variance))
  const annualizedVol = dailyStd * Math.sqrt(252)
  const zScore = -normalQuantile(alpha)  // positive z-score for left tail
  const paramVaR = (zScore * dailyStd - mean) * Math.sqrt(horizon)

  return {
    confidence: confidenceLevel,
    horizon,
    historicalVaR: Math.max(0, histVaR),
    parametricVaR: Math.max(0, paramVaR),
    historicalCVaR: Math.max(0, histCVaR),
    annualizedVol,
    observations: n,
  }
}

export interface PortfolioVaR {
  var95_1d: VaRResult | null
  var99_1d: VaRResult | null
  var95_10d: VaRResult | null
  var99_10d: VaRResult | null
  /** Summary table for display */
  summary: Array<{
    label: string
    historicalVaR: string
    parametricVaR: string
    cvar: string
  }>
}

/**
 * Compute the full institutional VaR table from portfolio daily returns.
 * Returns 4 metrics: 95%/99% × 1-day/10-day.
 */
export function computePortfolioVaR(dailyLogReturns: number[]): PortfolioVaR {
  const var95_1d = computeVaR(dailyLogReturns, 0.95, 1)
  const var99_1d = computeVaR(dailyLogReturns, 0.99, 1)
  const var95_10d = computeVaR(dailyLogReturns, 0.95, 10)
  const var99_10d = computeVaR(dailyLogReturns, 0.99, 10)

  const fmt = (v: VaRResult | null) => v ? `${(v.historicalVaR * 100).toFixed(2)}%` : 'N/A'
  const fmtP = (v: VaRResult | null) => v ? `${(v.parametricVaR * 100).toFixed(2)}%` : 'N/A'
  const fmtC = (v: VaRResult | null) => v ? `${(v.historicalCVaR * 100).toFixed(2)}%` : 'N/A'

  const summary = [
    { label: 'VaR 95% (1-day)',  historicalVaR: fmt(var95_1d),  parametricVaR: fmtP(var95_1d),  cvar: fmtC(var95_1d) },
    { label: 'VaR 99% (1-day)',  historicalVaR: fmt(var99_1d),  parametricVaR: fmtP(var99_1d),  cvar: fmtC(var99_1d) },
    { label: 'VaR 95% (10-day)', historicalVaR: fmt(var95_10d), parametricVaR: fmtP(var95_10d), cvar: fmtC(var95_10d) },
    { label: 'VaR 99% (10-day)', historicalVaR: fmt(var99_10d), parametricVaR: fmtP(var99_10d), cvar: fmtC(var99_10d) },
  ]

  return { var95_1d, var99_1d, var95_10d, var99_10d, summary }
}

/**
 * Simple VaR back-test: count how often actual losses exceeded VaR.
 *
 * NOTE: This is a quick 3× heuristic check, NOT the Kupiec likelihood-ratio
 * test. The Kupiec test uses a binomial log-likelihood framework to formally
 * test whether the breach rate is statistically consistent with the VaR
 * confidence level. For production use, implement the full Kupiec (1995)
 * POF test using a chi-squared comparison.
 *
 * @param dailyLogReturns  Full return series
 * @param lookback         Rolling window for VaR estimation (default 252)
 */
export function backtestVaR(
  dailyLogReturns: number[],
  confidenceLevel = 0.99,
  lookback = 252,
): { breaches: number; total: number; breachRate: number; heuristicPass: boolean } {
  let breaches = 0
  const testPeriod = dailyLogReturns.length - lookback
  if (testPeriod <= 0) return { breaches: 0, total: 0, breachRate: 0, heuristicPass: true }

  for (let i = lookback; i < dailyLogReturns.length; i++) {
    const window = dailyLogReturns.slice(i - lookback, i)
    const result = computeVaR(window, confidenceLevel, 1)
    if (!result) continue
    const actualLoss = -dailyLogReturns[i]  // positive = loss
    if (actualLoss > result.historicalVaR) breaches++
  }

  const total = testPeriod
  const breachRate = total > 0 ? breaches / total : 0
  // Simple heuristic: accept if breach rate is within 3× the expected rate.
  // This is NOT a formal statistical test; the Kupiec (1995) POF test should
  // be used for regulatory reporting.
  const expectedRate = 1 - confidenceLevel
  const heuristicPass = breachRate <= expectedRate * 3

  return { breaches, total, breachRate, heuristicPass }
}

/**
 * Marginal VaR contribution per position.
 * Measures how much adding (or removing) a position changes portfolio VaR.
 *
 * @param portfolioReturns  Portfolio-level daily returns
 * @param positionReturns   Record of ticker -> daily returns (same length)
 * @param weights           Record of ticker -> current weight
 */
export function marginalVaR(
  portfolioReturns: number[],
  positionReturns: Record<string, number[]>,
  weights: Record<string, number>,
  confidenceLevel = 0.99,
): Record<string, number> {
  const baseVaR = computeVaR(portfolioReturns, confidenceLevel, 1)
  if (!baseVaR) return {}

  const result: Record<string, number> = {}
  const epsilon = 0.01  // 1% weight shift

  for (const [ticker, returns] of Object.entries(positionReturns)) {
    const weight = weights[ticker] ?? 0
    if (returns.length !== portfolioReturns.length) continue

    // Proper weight perturbation: add epsilon × position return to the
    // original portfolio return series. This computes the actual marginal
    // effect of increasing the position weight by epsilon.
    const perturbedReturns = portfolioReturns.map((r, i) =>
      r + epsilon * returns[i],
    )
    const perturbedVaR = computeVaR(perturbedReturns, confidenceLevel, 1)
    if (!perturbedVaR) continue

    result[ticker] = (perturbedVaR.historicalVaR - baseVaR.historicalVaR) / epsilon
  }

  return result
}
