/**
 * Probabilistic / Deflated Sharpe Ratio (Q-065-NEW, 2026-07-07).
 *
 * References:
 *  - Bailey, D. H. & López de Prado, M. (2012). "The Sharpe Ratio Efficient
 *    Frontier." Journal of Risk 15(2) — Probabilistic Sharpe Ratio (PSR).
 *  - Bailey, D. H. & López de Prado, M. (2014). "The Deflated Sharpe Ratio:
 *    Correcting for Selection Bias, Backtest Overfitting and Non-Normality."
 *    Journal of Portfolio Management 40(5) — DSR via expected-max-SR under N
 *    independent trials.
 *
 * All Sharpe ratios here are PER-PERIOD (same frequency as the input returns);
 * annualize outside if needed. Pure functions, no I/O.
 */

const EULER_MASCHERONI = 0.5772156649015329

/** Sample mean. */
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Sample standard deviation (n-1 denominator). */
export function sampleStd(xs: number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/** Sample skewness (biased/moment estimator — matches BLdP usage). */
export function skewness(xs: number[]): number {
  if (xs.length < 3) return NaN
  const m = mean(xs)
  const n = xs.length
  const m2 = xs.reduce((s, x) => s + (x - m) ** 2, 0) / n
  const m3 = xs.reduce((s, x) => s + (x - m) ** 3, 0) / n
  return m2 > 0 ? m3 / m2 ** 1.5 : NaN
}

/** Sample kurtosis (moment estimator; normal = 3, NOT excess). */
export function kurtosis(xs: number[]): number {
  if (xs.length < 4) return NaN
  const m = mean(xs)
  const n = xs.length
  const m2 = xs.reduce((s, x) => s + (x - m) ** 2, 0) / n
  const m4 = xs.reduce((s, x) => s + (x - m) ** 4, 0) / n
  return m2 > 0 ? m4 / m2 ** 2 : NaN
}

/** Standard normal CDF via Abramowitz-Stegun 7.1.26 erf approximation (|ε|<1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const erf =
    1 -
    t *
      (0.254829592 +
        t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

/** Inverse standard normal CDF (Acklam's rational approximation, |ε|~1e-9). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return NaN
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416]
  const pl = 0.02425
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/**
 * Probabilistic Sharpe Ratio: P(true SR > srBenchmark | observed returns).
 * Adjusts for track length, skewness and kurtosis (BLdP 2012, eq. 11).
 * Returns null when undefined (σ=0, T<2, non-finite inputs).
 */
export function probabilisticSharpe(returns: number[], srBenchmark = 0): number | null {
  const T = returns.length
  if (T < 2) return null
  const sd = sampleStd(returns)
  if (!(sd > 0)) return null
  const sr = mean(returns) / sd
  const g3 = skewness(returns)
  const g4 = kurtosis(returns)
  if (!Number.isFinite(sr) || !Number.isFinite(g3) || !Number.isFinite(g4)) return null
  const denom = 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr
  if (!(denom > 0)) return null
  const z = ((sr - srBenchmark) * Math.sqrt(T - 1)) / Math.sqrt(denom)
  return normCdf(z)
}

/**
 * Expected maximum Sharpe ratio among `nTrials` independent zero-skill trials
 * (BLdP 2014, eq. 4) with V[SR] ≈ 1/(T-1) under H0.
 */
export function expectedMaxSharpe(nTrials: number, T: number): number | null {
  if (nTrials < 1 || T < 2) return null
  if (nTrials === 1) return 0
  const sdSr = Math.sqrt(1 / (T - 1))
  return sdSr * ((1 - EULER_MASCHERONI) * normInv(1 - 1 / nTrials) +
    EULER_MASCHERONI * normInv(1 - 1 / (nTrials * Math.E)))
}

/**
 * Deflated Sharpe Ratio: PSR evaluated against the expected max SR from
 * `nTrials` independent trials — P(true SR clears the multiple-testing bar).
 */
export function deflatedSharpe(returns: number[], nTrials: number): number | null {
  const sr0 = expectedMaxSharpe(nTrials, returns.length)
  if (sr0 == null) return null
  return probabilisticSharpe(returns, sr0)
}
