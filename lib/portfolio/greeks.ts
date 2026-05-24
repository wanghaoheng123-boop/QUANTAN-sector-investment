/**
 * Portfolio Greeks aggregation (Phase 15 Q-046-NEW).
 *
 * ⚠️ INPUT CONTRACT — read before using:
 *
 * The `delta`/`gamma`/`vega`/`theta`/`rho` fields on `PositionGreeks` MUST
 * be pre-weighted by the position's *full* economic exposure:
 *
 *     position_delta = per_contract_delta × shares × contract_multiplier
 *
 * For US equity options the contract multiplier is 100. For an outright
 * stock position, `shares` IS the delta and the other Greeks are 0:
 *
 *     stock 100 sh AAPL  → { delta: 100, gamma: 0, vega: 0, theta: 0, rho: 0 }
 *     long 5 calls Δ=0.45 → { delta: 5 × 0.45 × 100 = 225, ... }
 *
 * `aggregatePortfolioGreeks` sums these values verbatim — it does NOT
 * multiply by shares or by any contract multiplier internally. The
 * `shares` field on PositionGreeks is informational (for display) and
 * is not used in the aggregation.
 *
 * Phase 16 may move this contract inside the aggregator (taking raw
 * per-contract Greeks + position size + multiplier and doing the
 * weighting internally), at which point callers will need to pass
 * un-weighted Greeks. Until then, callers MUST pre-weight.
 *
 * Citation: Hull, J. (2017) "Options, Futures and Other Derivatives,"
 * §19 (Greeks of a portfolio).
 */

export interface PositionGreeks {
  ticker: string
  /** Position size — informational only; NOT used in aggregation. */
  shares: number
  /** Position-level delta = per-contract Δ × contracts × multiplier. */
  delta: number
  /** Position-level gamma = per-contract Γ × contracts × multiplier. */
  gamma: number
  /** Position-level vega = per-contract ν × contracts × multiplier. */
  vega: number
  /** Position-level theta = per-contract θ × contracts × multiplier. */
  theta: number
  /** Position-level rho = per-contract ρ × contracts × multiplier. */
  rho: number
}

export interface PortfolioGreeks {
  delta: number
  gamma: number
  vega: number
  theta: number
  rho: number
  positions: PositionGreeks[]
}

export function aggregatePortfolioGreeks(positions: PositionGreeks[]): PortfolioGreeks {
  const sum = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 }
  for (const p of positions) {
    sum.delta += p.delta
    sum.gamma += p.gamma
    sum.vega += p.vega
    sum.theta += p.theta
    sum.rho += p.rho
  }
  return { ...sum, positions }
}
