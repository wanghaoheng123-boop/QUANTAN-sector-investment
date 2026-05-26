import { describe, it, expect } from 'vitest'
import { aggregatePortfolioGreeks } from '@/lib/portfolio/greeks'
import type { PositionGreeks } from '@/lib/portfolio/greeks'

describe('aggregatePortfolioGreeks (Q-046-NEW)', () => {
  const stock: PositionGreeks = {
    ticker: 'AAPL',
    shares: 100,
    // Stock: delta is share count; other Greeks 0.
    delta: 100,
    gamma: 0,
    vega: 0,
    theta: 0,
    rho: 0,
  }

  const longCall: PositionGreeks = {
    ticker: 'AAPL_C',
    shares: 5,
    // Pre-weighted: per-contract Δ=0.45 × 5 contracts × 100 multiplier = 225
    delta: 225,
    gamma: 0.04 * 5 * 100, // 20
    vega: 0.12 * 5 * 100,  // 60
    theta: -0.05 * 5 * 100, // -25
    rho: 0.08 * 5 * 100,   // 40
  }

  it('empty portfolio → all zeros', () => {
    const result = aggregatePortfolioGreeks([])
    expect(result.delta).toBe(0)
    expect(result.gamma).toBe(0)
    expect(result.vega).toBe(0)
    expect(result.theta).toBe(0)
    expect(result.rho).toBe(0)
    expect(result.positions).toEqual([])
  })

  it('sums all Greek fields verbatim across positions', () => {
    const result = aggregatePortfolioGreeks([stock, longCall])
    expect(result.delta).toBe(100 + 225) // 325
    expect(result.gamma).toBe(0 + 20)
    expect(result.vega).toBe(0 + 60)
    expect(result.theta).toBe(0 + -25)
    expect(result.rho).toBe(0 + 40)
  })

  it('exposes the input positions array verbatim (informational only)', () => {
    const result = aggregatePortfolioGreeks([stock])
    expect(result.positions).toEqual([stock])
    // `shares` is informational — NOT used in aggregation. A position with
    // shares=999 and delta=1 contributes delta=1, not delta=999.
    const oddPosition: PositionGreeks = { ticker: 'X', shares: 999, delta: 1, gamma: 0, vega: 0, theta: 0, rho: 0 }
    const oddResult = aggregatePortfolioGreeks([oddPosition])
    expect(oddResult.delta).toBe(1)
  })

  it('handles short positions (negative Greeks)', () => {
    const shortPut: PositionGreeks = {
      ticker: 'AAPL_P',
      shares: 5,
      // Short put: positive delta exposure, negative gamma+vega, positive theta
      delta: 200,
      gamma: -20,
      vega: -60,
      theta: 25,
      rho: -15,
    }
    const result = aggregatePortfolioGreeks([longCall, shortPut])
    expect(result.delta).toBe(225 + 200) // 425
    expect(result.gamma).toBe(20 - 20) // 0 — gamma-neutral
    expect(result.vega).toBe(60 - 60) // 0 — vega-neutral
    expect(result.theta).toBe(-25 + 25) // 0
    expect(result.rho).toBe(40 - 15) // 25
  })
})
