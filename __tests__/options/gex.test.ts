import { describe, it, expect } from 'vitest'
import { computeGex } from '@/lib/options/gex'
import type { EnrichedContract } from '@/lib/options/chain'

function makeEnriched(
  strike: number,
  openInterest: number,
  gamma: number,
  type: 'call' | 'put',
): EnrichedContract {
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  return {
    contractSymbol: `TEST${type === 'call' ? 'C' : 'P'}${strike}`,
    strike,
    lastPrice: 1.0,
    change: 0,
    contractSize: 'REGULAR',
    expiration: expiry,
    lastTradeDate: new Date(),
    impliedVolatility: 0.25,
    inTheMoney: false,
    openInterest,
    volume: 0,
    delta: type === 'call' ? 0.5 : -0.5,
    gamma,
    theta: -0.05,
    vega: 0.1,
    rho: 0.02,
  }
}

describe('computeGex', () => {
  const SPOT = 100

  it('returns zero GEX when calls and puts have equal OI', () => {
    const calls = [makeEnriched(100, 1000, 0.05, 'call')]
    const puts  = [makeEnriched(100, 1000, 0.05, 'put')]
    const result = computeGex(calls, puts, SPOT)
    expect(result.totalGex).toBeCloseTo(0, 6)
    expect(result.flipPoint).toBeNull()
  })

  it('positive GEX when calls OI > puts OI', () => {
    const calls = [makeEnriched(100, 2000, 0.05, 'call')]
    const puts  = [makeEnriched(100,  500, 0.05, 'put')]
    const result = computeGex(calls, puts, SPOT)
    expect(result.totalGex).toBeGreaterThan(0)
  })

  it('negative GEX when puts OI > calls OI', () => {
    const calls = [makeEnriched(100,  500, 0.05, 'call')]
    const puts  = [makeEnriched(100, 2000, 0.05, 'put')]
    const result = computeGex(calls, puts, SPOT)
    expect(result.totalGex).toBeLessThan(0)
  })

  it('strikeGex is sorted ascending by strike', () => {
    const calls = [110, 100, 90].map((s) => makeEnriched(s, 1000, 0.05, 'call'))
    const puts  = [110, 100, 90].map((s) => makeEnriched(s,  500, 0.05, 'put'))
    const { strikeGex } = computeGex(calls, puts, SPOT)
    for (let i = 1; i < strikeGex.length; i++) {
      expect(strikeGex[i].strike).toBeGreaterThan(strikeGex[i - 1].strike)
    }
  })

  it('detects flip point between two strikes', () => {
    // Low strikes: puts > calls → negative GEX
    // High strikes: calls > puts → positive GEX
    // Cumulative from low to high: starts negative, crosses to positive somewhere
    const calls = [
      makeEnriched(90,  100, 0.05, 'call'),   // low call OI → negative contribution
      makeEnriched(110, 2000, 0.05, 'call'),  // high call OI → positive contribution
    ]
    const puts = [
      makeEnriched(90,  2000, 0.05, 'put'),   // high put OI
      makeEnriched(110,  100, 0.05, 'put'),   // low put OI
    ]
    // Cumulative from 90→110: 90 is negative, 110 pushes it positive
    // We look for negative→positive transition... our code looks for positive→negative
    // Let's reverse: calls dominate at low strike
    const calls2 = [
      makeEnriched(90,  2000, 0.05, 'call'),
      makeEnriched(110,  100, 0.05, 'call'),
    ]
    const puts2 = [
      makeEnriched(90,   100, 0.05, 'put'),
      makeEnriched(110, 2000, 0.05, 'put'),
    ]
    const result = computeGex(calls2, puts2, SPOT)
    // Cumulative at 90: positive (calls >> puts)
    // Cumulative at 110: might go negative (puts >> calls)
    expect(result.flipPoint).not.toBeNull()
    expect(result.flipPoint!).toBeGreaterThan(90)
    expect(result.flipPoint!).toBeLessThanOrEqual(110)
  })

  it('returns null flipPoint when GEX stays uniformly positive', () => {
    const calls = [90, 100, 110].map((s) => makeEnriched(s, 2000, 0.05, 'call'))
    const puts  = [90, 100, 110].map((s) => makeEnriched(s,  100, 0.05, 'put'))
    const result = computeGex(calls, puts, SPOT)
    expect(result.totalGex).toBeGreaterThan(0)
    expect(result.flipPoint).toBeNull()
  })

  it('handles empty arrays', () => {
    const result = computeGex([], [], SPOT)
    expect(result.totalGex).toBe(0)
    expect(result.strikeGex).toHaveLength(0)
    expect(result.flipPoint).toBeNull()
  })
})
