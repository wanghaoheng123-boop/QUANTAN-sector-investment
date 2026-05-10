/**
 * Pairwise return correlation helpers for portfolio risk management.
 *
 * Phase 13 S2 (F1.7): correlation-adjusted Kelly sizing in portfolioBacktest
 * was documented + configured but never implemented. This module provides
 * the missing primitive.
 *
 * Reference:
 *   Thorp, E. O. (2006). "The Kelly Criterion in Blackjack, Sports Betting,
 *     and the Stock Market." Handbook of Asset and Liability Management 1,
 *     p385–428. (Correlation-adjusted Kelly formulation.)
 *   Maillard, S., Roncalli, T., Teiletche, J. (2010). "The Properties of
 *     Equally Weighted Risk Contribution Portfolios." JPM 36(4), p60–70.
 */

/**
 * Pearson correlation coefficient between two equal-length return series.
 * Returns null when:
 *   - Series have different lengths
 *   - Either series has fewer than 2 elements
 *   - Either series has zero variance (degenerate; correlation undefined)
 */
export function pearsonCorrelation(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null

  const n = a.length
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < n; i++) {
    sumA += a[i]
    sumB += b[i]
  }
  const meanA = sumA / n
  const meanB = sumB / n

  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }

  if (varA <= 0 || varB <= 0) return null
  const r = cov / Math.sqrt(varA * varB)
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null
}

/**
 * Compute the maximum pairwise correlation between a candidate return series
 * and a set of existing position return series.
 *
 * Returns 0 if no peer series have enough data — interpreted as "no
 * correlation pressure to shrink Kelly."
 */
export function maxCorrelationVsPeers(
  candidate: number[],
  peers: ReadonlyArray<number[]>,
  minWindow = 20,
): number {
  if (candidate.length < minWindow) return 0
  let maxAbsRho = 0
  for (const peer of peers) {
    if (peer.length < minWindow) continue
    // Align tails — both series end at the same observation.
    const w = Math.min(candidate.length, peer.length)
    const a = candidate.slice(-w)
    const b = peer.slice(-w)
    const rho = pearsonCorrelation(a, b)
    if (rho == null) continue
    const abs = Math.abs(rho)
    if (abs > maxAbsRho) maxAbsRho = abs
  }
  return maxAbsRho
}

/**
 * Adjust a Kelly fraction downward when the candidate is highly correlated
 * with existing portfolio positions (correlation-Kelly approximation).
 *
 * - When max correlation < gate: no shrinkage (returns kelly unchanged).
 * - When max correlation >= gate: shrink Kelly by `(1 - rho)` factor —
 *   at rho = 1.0 the candidate gets zero new allocation; at rho = gate
 *   the candidate gets `kelly * (1 - gate)`.
 *
 * Reference: Thorp (2006) §5 — correlated bets reduce effective Kelly.
 *
 * @param kelly       Base Kelly fraction (typically halfKelly output).
 * @param maxRho      Max absolute pairwise correlation vs existing positions.
 * @param gate        Correlation threshold above which shrinking begins.
 *                    Default 0.20 (matches portfolioBacktest correlationGate).
 */
export function correlationAdjustedKelly(
  kelly: number,
  maxRho: number,
  gate = 0.20,
): number {
  if (!Number.isFinite(kelly) || kelly <= 0) return 0
  if (!Number.isFinite(maxRho) || maxRho <= gate) return kelly
  // Linear shrink from kelly at rho=gate to 0 at rho=1.
  const remaining = Math.max(0, 1 - maxRho)
  return Math.max(0, kelly * remaining)
}
