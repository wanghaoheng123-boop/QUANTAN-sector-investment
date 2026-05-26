import { describe, it, expect } from 'vitest'
import { runScenario } from '@/lib/scenarios/engine'

describe('runScenario Taylor P&L', () => {
  it('includes gamma contribution for options-like position', () => {
    const shock = { id: 't', label: 'test', spotPct: -0.1, volPct: 0.2, rateBps: 0 }
    const equityOnly = runScenario(
      [{ ticker: 'SPY', shares: 100, price: 100 }],
      shock,
    )
    const withGamma = runScenario(
      [{ ticker: 'OPT', shares: 1, price: 100, delta: 50, gamma: 2 }],
      shock,
    )
    expect(withGamma.portfolioPnl).not.toBe(equityOnly.portfolioPnl)
  })

  it('aggregates unshocked greeks for display', () => {
    const result = runScenario(
      [{ ticker: 'X', shares: 10, price: 50, delta: 10, gamma: 1 }],
      { id: 't', label: 't', spotPct: 0, volPct: 0, rateBps: 0 },
    )
    expect(result.greeks.delta).toBe(10)
    expect(result.greeks.gamma).toBe(1)
  })
})
