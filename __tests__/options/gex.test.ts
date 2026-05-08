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

  // F3.5 (Phase 13 S2): expose ALL flip points, not just the first.
  describe('flipPoints (F3.5 multi-flip)', () => {
    it('returns empty array when GEX stays uniformly positive', () => {
      const calls = [90, 100, 110].map((s) => makeEnriched(s, 2000, 0.05, 'call'))
      const puts  = [90, 100, 110].map((s) => makeEnriched(s,  100, 0.05, 'put'))
      const result = computeGex(calls, puts, SPOT)
      expect(result.flipPoints).toEqual([])
      expect(result.flipPoint).toBeNull()
    })

    it('returns single-flip array when only one sign change', () => {
      // Lower strikes negative (puts dominate), upper strikes positive (calls)
      const calls = [
        makeEnriched(90, 100, 0.05, 'call'),
        makeEnriched(100, 2000, 0.05, 'call'),
        makeEnriched(110, 2000, 0.05, 'call'),
      ]
      const puts = [
        makeEnriched(90, 2000, 0.05, 'put'),
        makeEnriched(100, 100, 0.05, 'put'),
        makeEnriched(110, 100, 0.05, 'put'),
      ]
      const result = computeGex(calls, puts, SPOT)
      expect(result.flipPoints).toHaveLength(1)
      expect(result.flipPoint).toBe(result.flipPoints[0])
    })

    it('returns multi-flip array when cumulative GEX crosses zero multiple times', () => {
      // Construct asymmetric values so cumulative GEX zigzags:
      //   strike 80:  callOI=100, putOI=10000  → contribution very negative
      //   strike 90:  callOI=20000, putOI=100  → strong positive (cum > 0)
      //   strike 100: callOI=100, putOI=30000  → strong negative (cum < 0 again)
      //   strike 110: callOI=40000, putOI=100  → strong positive (cum > 0 again)
      const calls = [
        makeEnriched(80, 100, 0.05, 'call'),
        makeEnriched(90, 20000, 0.05, 'call'),
        makeEnriched(100, 100, 0.05, 'call'),
        makeEnriched(110, 40000, 0.05, 'call'),
      ]
      const puts = [
        makeEnriched(80, 10000, 0.05, 'put'),
        makeEnriched(90, 100, 0.05, 'put'),
        makeEnriched(100, 30000, 0.05, 'put'),
        makeEnriched(110, 100, 0.05, 'put'),
      ]
      const result = computeGex(calls, puts, SPOT)
      // Hand check cumulative gex (gamma=0.05, 100×100²×0.01 = 1e4 weight):
      //   strike 80:  (100 - 10000) × 5e2 = -4_950_000        cum = -4_950_000
      //   strike 90:  (20000 - 100) × 5e2 = +9_950_000         cum = +5_000_000  ← flip 1
      //   strike 100: (100 - 30000) × 5e2 = -14_950_000        cum = -9_950_000  ← flip 2
      //   strike 110: (40000 - 100) × 5e2 = +19_950_000        cum = +10_000_000 ← flip 3
      expect(result.flipPoints.length).toBeGreaterThanOrEqual(2)
      expect(result.flipPoint).toBe(result.flipPoints[0])
      for (const fp of result.flipPoints) {
        expect(fp).toBeGreaterThanOrEqual(80)
        expect(fp).toBeLessThanOrEqual(110)
      }
      // Flip points must be sorted ascending (since we iterate strikes ascending)
      for (let i = 1; i < result.flipPoints.length; i++) {
        expect(result.flipPoints[i]).toBeGreaterThanOrEqual(result.flipPoints[i - 1])
      }
    })

    it('handles empty arrays — flipPoints is empty', () => {
      const result = computeGex([], [], SPOT)
      expect(result.flipPoints).toEqual([])
    })
  })

  // F3.3 (Phase 13 S2): per-side gamma — call_gamma and put_gamma tracked
  // independently so vol skew correctly weights each side.
  describe('per-side gamma (F3.3)', () => {
    it('matches old behavior when call_gamma === put_gamma at every strike', () => {
      // With uniform gamma, per-side and averaged give identical results.
      const calls = [makeEnriched(100, 1000, 0.04, 'call')]
      const puts = [makeEnriched(100, 1000, 0.04, 'put')]
      const result = computeGex(calls, puts, SPOT)
      expect(result.strikeGex[0].gex).toBeCloseTo(0, 4)  // equal OI cancels
    })

    it('differs from averaged-gamma when call/put gammas diverge under skew', () => {
      // Skew scenario: at-the-money put has higher gamma than ATM call (typical
      // put skew on equity indices). Per-side weights the dominant put more.
      const calls = [makeEnriched(100, 5000, 0.03, 'call')]   // call gamma 0.03
      const puts = [makeEnriched(100, 5000, 0.06, 'put')]     // put gamma 0.06 (skew)
      const result = computeGex(calls, puts, SPOT)
      // Per-side: gex = (5000·0.03 - 5000·0.06) × 1e4 = -1_500_000
      // Averaged-gamma (old buggy): gex = (5000-5000) × 0.045 × 1e4 = 0
      // The fix MUST produce non-zero GEX in this scenario.
      expect(Math.abs(result.strikeGex[0].gex)).toBeGreaterThan(0)
      // And direction should be negative (put gamma dominates).
      expect(result.strikeGex[0].gex).toBeLessThan(0)
    })

    it('isolates gamma per side (zero-OI side does not pollute)', () => {
      // Strike 100: only calls (no put data). Old impl averaged 0+gamma → wrong.
      // Per-side: only call_gamma is used.
      const calls = [makeEnriched(100, 5000, 0.05, 'call')]
      const puts: ReturnType<typeof makeEnriched>[] = []
      const result = computeGex(calls, puts, SPOT)
      // gex = 5000 × 0.05 × 1e4 = 2_500_000
      expect(result.strikeGex[0].gex).toBeCloseTo(5000 * 0.05 * 1e4, 0)
    })
  })
})
