/**
 * Configurable execution costs for label benchmarks and engine alignment.
 * SSOT for round-trip friction assumptions (spread + slippage + commission per side).
 */

export interface ExecutionCostConfig {
  /** Half-spread paid per side (bps) */
  spreadBpsPerSide: number
  /** Adverse selection / open friction per side (bps) */
  slippageBpsPerSide: number
  /** Commission + fees per side (bps) */
  commissionBpsPerSide: number
}

/** Matches engine.ts TX_COST_BPS_PER_SIDE = 11 (5 + 2 + 4). */
export const DEFAULT_EXECUTION_COSTS: ExecutionCostConfig = {
  spreadBpsPerSide: 5,
  slippageBpsPerSide: 2,
  commissionBpsPerSide: 4,
}

export function costBpsPerSide(config: ExecutionCostConfig = DEFAULT_EXECUTION_COSTS): number {
  return config.spreadBpsPerSide + config.slippageBpsPerSide + config.commissionBpsPerSide
}

/** Decimal per-side cost (entry OR exit). SSOT for the 0.0011 (11 bps) literal. */
export function perSideCostPct(config: ExecutionCostConfig = DEFAULT_EXECUTION_COSTS): number {
  return costBpsPerSide(config) / 10000
}

/** Decimal round-trip cost (entry + exit). */
export function roundTripCostPct(config: ExecutionCostConfig = DEFAULT_EXECUTION_COSTS): number {
  return 2 * perSideCostPct(config)
}

/** Gross holding-period return minus round-trip costs. */
export function netReturnAfterCosts(
  grossReturn: number,
  config: ExecutionCostConfig = DEFAULT_EXECUTION_COSTS,
): number {
  return grossReturn - roundTripCostPct(config)
}
