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
 * Fail-closed: returns null when the candidate or all peers have insufficient
 * data. Risk-management code should NOT assume "no correlation" when it
 * simply lacks the bars to measure — the conservative interpretation is
 * "unknown, treat as correlated for sizing." Callers (correlationAdjustedKelly)
 * shrink Kelly to zero on null.
 *
 * Returns 0 only when correlation is genuinely measurable AND maxes at 0
 * (truly uncorrelated portfolio).
 *
 * Previous implementation: `if (candidate.length < minWindow) return 0`
 * silently allowed full Kelly for candidates with <20 bars — a fail-OPEN
 * default that gave maximum size to the least-known position.
 */
export function maxCorrelationVsPeers(
  candidate: number[],
  peers: ReadonlyArray<number[]>,
  minWindow = 20,
): number | null {
  if (candidate.length < minWindow) return null
  let maxAbsRho = 0
  let measured = false
  for (const peer of peers) {
    if (peer.length < minWindow) continue
    // Align tails — both series end at the same observation.
    const w = Math.min(candidate.length, peer.length)
    const a = candidate.slice(-w)
    const b = peer.slice(-w)
    const rho = pearsonCorrelation(a, b)
    if (rho == null) continue
    measured = true
    const abs = Math.abs(rho)
    if (abs > maxAbsRho) maxAbsRho = abs
  }
  // If we couldn't measure correlation against ANY peer, return null —
  // the candidate is genuinely-isolated (e.g. brand-new portfolio with
  // no peers, or all peers are too short). Callers treat null per their
  // own fail-mode policy.
  return measured ? maxAbsRho : (peers.length === 0 ? 0 : null)
}

/**
 * Adjust a Kelly fraction downward when the candidate is highly correlated
 * with existing portfolio positions (correlation-Kelly approximation).
 *
 * Continuous-at-gate semantics (previous version had a 20% jump at gate):
 *   - rho ≤ gate:  no shrinkage (returns kelly unchanged).
 *   - rho ∈ (gate, 1]: linearly shrink to zero at rho = 1.
 *       shrink_factor = (1 − rho) / (1 − gate)
 *     so at rho = gate the factor is 1.0 (continuous), and at rho = 1.0
 *     the factor is 0 (no allocation to a perfectly-correlated position).
 *   - rho == null (measurement impossible): fail-CLOSED — return 0.
 *     Risk-management code should not assume an unmeasured correlation
 *     is favourable.
 *
 * Reference: Thorp (2006) §5 — correlated bets reduce effective Kelly.
 *
 * @param kelly       Base Kelly fraction (typically halfKelly output).
 * @param maxRho      Max absolute pairwise correlation, or null if unmeasurable.
 * @param gate        Correlation threshold above which shrinking begins.
 *                    Default 0.20 (matches portfolioBacktest correlationGate).
 */
export function correlationAdjustedKelly(
  kelly: number,
  maxRho: number | null,
  gate = 0.20,
): number {
  if (!Number.isFinite(kelly) || kelly <= 0) return 0
  // Fail-closed on unmeasurable correlation — the candidate could be
  // perfectly correlated with the existing book and we'd never know.
  if (maxRho == null || !Number.isFinite(maxRho)) return 0
  if (maxRho <= gate) return kelly
  // Continuous linear shrink: at rho = gate → kelly; at rho = 1 → 0.
  const denom = Math.max(1e-9, 1 - gate)
  const factor = Math.max(0, (1 - maxRho) / denom)
  return Math.max(0, kelly * factor)
}
