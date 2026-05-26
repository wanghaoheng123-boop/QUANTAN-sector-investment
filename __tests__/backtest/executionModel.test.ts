import { describe, it, expect } from 'vitest'
import {
  costBpsPerSide,
  roundTripCostPct,
  netReturnAfterCosts,
  DEFAULT_EXECUTION_COSTS,
} from '@/lib/backtest/executionModel'
import { TX_COST_BPS_PER_SIDE } from '@/lib/backtest/engine'

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
})
