import { describe, it, expect } from 'vitest'
import {
  costBpsPerSide,
  perSideCostPct,
  roundTripCostPct,
  netReturnAfterCosts,
  DEFAULT_EXECUTION_COSTS,
} from '@/lib/backtest/executionModel'
import { TX_COST_BPS_PER_SIDE, TX_COST_PCT_PER_SIDE } from '@/lib/backtest/engine'

describe('executionModel', () => {
  it('default costs sum to 11 bps per side', () => {
    expect(costBpsPerSide()).toBe(11)
    expect(roundTripCostPct()).toBeCloseTo(0.0022, 8)
  })

  it('net return subtracts round-trip decimal cost', () => {
    expect(netReturnAfterCosts(0.05)).toBeCloseTo(0.05 - roundTripCostPct(), 8)
  })

  it('engine TX_COST_BPS_PER_SIDE matches executionModel SSOT', () => {
    expect(TX_COST_BPS_PER_SIDE).toBe(costBpsPerSide(DEFAULT_EXECUTION_COSTS))
  })

  it('perSideCostPct is the SSOT for the 0.0011 literal (portfolioBacktest parity)', () => {
    // portfolioBacktest.ts previously hardcoded 0.0011 at 4 sites; they now call
    // perSideCostPct(). Lock the value so a future cost-model change can't
    // silently desync the two modules.
    expect(perSideCostPct()).toBeCloseTo(0.0011, 10)
    expect(perSideCostPct()).toBe(costBpsPerSide() / 10000)
    expect(roundTripCostPct()).toBeCloseTo(2 * perSideCostPct(), 12)
    expect(TX_COST_PCT_PER_SIDE).toBe(perSideCostPct())
  })

  // Q06: the config argument was never exercised — only the default was tested,
  // so a regression in the parameterization (e.g. a function ignoring its config)
  // would pass silently. These lock the config-injection path.
  it('honours a custom ExecutionCostConfig (parameterization flows through)', () => {
    const custom = { spreadBpsPerSide: 10, slippageBpsPerSide: 3, commissionBpsPerSide: 7 } // 20/side
    expect(costBpsPerSide(custom)).toBe(20)
    expect(perSideCostPct(custom)).toBeCloseTo(0.0020, 10)
    expect(roundTripCostPct(custom)).toBeCloseTo(0.0040, 10)
    expect(netReturnAfterCosts(0.05, custom)).toBeCloseTo(0.05 - 0.0040, 10)
  })

  it('zero-cost config is a frictionless identity (net == gross)', () => {
    const free = { spreadBpsPerSide: 0, slippageBpsPerSide: 0, commissionBpsPerSide: 0 }
    expect(costBpsPerSide(free)).toBe(0)
    expect(roundTripCostPct(free)).toBe(0)
    expect(netReturnAfterCosts(0.0731, free)).toBe(0.0731)
    expect(netReturnAfterCosts(-0.042, free)).toBe(-0.042)
  })
})
