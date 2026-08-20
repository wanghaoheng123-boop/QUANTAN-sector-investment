/**
 * Effective sample size under clustering — the Kish design effect.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Q-081` corrected the Deflated Sharpe Ratio from a pooled OVERLAPPING trade
 * series (n=3394) to a per-instrument NON-OVERLAPPING one (n=345), which moved
 * the published headline from a saturated 1.0000 to 0.4858. Adversarial
 * validation then showed 345 is still far too flattering, because de-overlapping
 * fixes only the WITHIN-instrument dependence:
 *
 *   56 names, many in the same sector, trading the same 2021-2026 window, have
 *   strongly correlated returns on the same dates. Trades that share a calendar
 *   block are not independent observations — they are one bet on the market
 *   placed 9 times.
 *
 * The sample spans ~49 occupied 21-bar blocks. Counting 345 "observations" over
 * ~49 periods of market time is the same category error as counting 3394
 * overlapping trades over 345 independent ones, one level up.
 *
 * METHOD
 * ------
 * Kish's design effect for cluster sampling (Kish, *Survey Sampling*, 1965,
 * §11.7; standard in the clustered-standard-error literature, e.g. Cameron &
 * Miller 2015, "A Practitioner's Guide to Cluster-Robust Inference", JHR 50(2)):
 *
 *     DEFF   = 1 + (m̄ − 1) · ρ
 *     n_eff  = n / DEFF
 *
 * where `m̄` is the size-weighted mean cluster size and `ρ` the intra-cluster
 * correlation. Here a cluster is a calendar block of one holding period, and `ρ`
 * is estimated by the mean pairwise correlation of instrument daily returns.
 *
 * Size-weighting `m̄` matters: with unequal clusters the plain mean understates
 * the effect, because the large clusters contain most of the observations.
 */

/** Size-weighted mean cluster size: Σm² / Σm, not Σm / k. */
export function meanClusterSize(sizes: readonly number[]): number {
  const valid = sizes.filter((m) => m > 0)
  if (valid.length === 0) return 0
  const sum = valid.reduce((a, b) => a + b, 0)
  const sumSq = valid.reduce((a, b) => a + b * b, 0)
  return sumSq / sum
}

/**
 * Kish design effect. Clamped at >= 1: a design effect below one would claim
 * clustering ADDS information, which it cannot. Negative `rho` (diversifying
 * clusters) is treated as zero for the same reason — this is a correction that
 * may only ever make the sample smaller, never larger, so it cannot flatter.
 */
export function designEffect(meanSize: number, rho: number): number {
  if (!Number.isFinite(meanSize) || !Number.isFinite(rho)) return 1
  return Math.max(1, 1 + (meanSize - 1) * Math.max(0, rho))
}

/** Effective sample size. Never exceeds `n`, never below 2 (PSR needs T >= 2). */
export function effectiveSampleSize(n: number, meanSize: number, rho: number): number {
  if (n <= 0) return 0
  const deff = designEffect(meanSize, rho)
  return Math.max(2, Math.min(n, n / deff))
}

/** Pearson correlation. Returns null when either series is constant. */
export function correlation(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 3) return null
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    sa += a[i]
    sb += b[i]
  }
  const ma = sa / n
  const mb = sb / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  if (!(da > 0) || !(db > 0)) return null
  return num / Math.sqrt(da * db)
}

/**
 * Mean pairwise correlation across series, aligned on a common date index.
 * This is the `rho` estimator for `designEffect`.
 */
export function meanPairwiseCorrelation(series: readonly (readonly number[])[]): number | null {
  const usable = series.filter((s) => s.length >= 3)
  if (usable.length < 2) return null
  let total = 0
  let pairs = 0
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const r = correlation(usable[i], usable[j])
      if (r != null && Number.isFinite(r)) {
        total += r
        pairs++
      }
    }
  }
  return pairs === 0 ? null : total / pairs
}
