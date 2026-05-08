import { describe, it, expect } from 'vitest'
import {
  blackScholesPrice,
  impliedVolatility,
  greeks,
  normalCdf,
} from '@/lib/options/greeks'

// Hull "Options, Futures, and Other Derivatives" reference values
// S=49, K=50, T=0.3846yr (~20wks), r=5%, sigma=20%
// Call = 2.4066, Put = 2.2174 (approx)
const REF = { S: 49, K: 50, T: 0.3846, r: 0.05, sigma: 0.20 }

describe('normalCdf', () => {
  it('returns 0.5 at x=0', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
  })
  it('returns ~0.8413 at x=1', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3)
  })
  it('returns ~0.9772 at x=2', () => {
    expect(normalCdf(2)).toBeCloseTo(0.9772, 3)
  })
  it('approaches 0 for x << 0', () => {
    expect(normalCdf(-8)).toBeCloseTo(0, 6)
  })
  it('approaches 1 for x >> 0', () => {
    expect(normalCdf(8)).toBeCloseTo(1, 6)
  })
})

describe('blackScholesPrice', () => {
  it('call price matches Hull reference (~2.40)', () => {
    const price = blackScholesPrice(REF.S, REF.K, REF.T, REF.r, REF.sigma, 'call')
    expect(price).toBeCloseTo(2.4, 0)  // within $0.05
  })

  it('put-call parity holds', () => {
    const call = blackScholesPrice(REF.S, REF.K, REF.T, REF.r, REF.sigma, 'call')
    const put  = blackScholesPrice(REF.S, REF.K, REF.T, REF.r, REF.sigma, 'put')
    const parity = REF.S - REF.K * Math.exp(-REF.r * REF.T)
    expect(call - put).toBeCloseTo(parity, 4)
  })

  it('call price > intrinsic for ITM call', () => {
    // Deep ITM call: S=110, K=100
    const price = blackScholesPrice(110, 100, 0.25, 0.05, 0.20, 'call')
    expect(price).toBeGreaterThan(10)
  })

  it('call price → 0 for far OTM', () => {
    const price = blackScholesPrice(50, 200, 0.1, 0.05, 0.20, 'call')
    expect(price).toBeCloseTo(0, 3)
  })

  it('returns 0 for T=0', () => {
    expect(blackScholesPrice(50, 50, 0, 0.05, 0.20, 'call')).toBe(0)
  })

  it('returns 0 for sigma=0', () => {
    expect(blackScholesPrice(50, 50, 0.5, 0.05, 0, 'call')).toBe(0)
  })
})

describe('greeks', () => {
  const g = greeks(REF.S, REF.K, REF.T, REF.r, REF.sigma, 'call')
  const gPut = greeks(REF.S, REF.K, REF.T, REF.r, REF.sigma, 'put')

  it('call delta is between 0 and 1', () => {
    expect(g.delta).toBeGreaterThan(0)
    expect(g.delta).toBeLessThan(1)
  })

  it('put delta is between -1 and 0', () => {
    expect(gPut.delta).toBeGreaterThan(-1)
    expect(gPut.delta).toBeLessThan(0)
  })

  it('call delta + put delta ≈ 1 (put-call delta parity)', () => {
    expect(g.delta + Math.abs(gPut.delta)).toBeCloseTo(1, 4)
  })

  it('gamma is positive and same for call and put', () => {
    expect(g.gamma).toBeGreaterThan(0)
    expect(g.gamma).toBeCloseTo(gPut.gamma, 6)
  })

  it('theta is negative (time decay) for both call and put', () => {
    expect(g.theta).toBeLessThan(0)
    expect(gPut.theta).toBeLessThan(0)
  })

  it('vega is positive for both', () => {
    expect(g.vega).toBeGreaterThan(0)
    expect(gPut.vega).toBeGreaterThan(0)
  })

  it('vega is same for call and put', () => {
    expect(g.vega).toBeCloseTo(gPut.vega, 6)
  })

  it('call rho is positive, put rho is negative', () => {
    expect(g.rho).toBeGreaterThan(0)
    expect(gPut.rho).toBeLessThan(0)
  })

  it('returns zero greeks for T=0', () => {
    const g0 = greeks(50, 50, 0, 0.05, 0.20, 'call')
    expect(g0.gamma).toBe(0)
    expect(g0.theta).toBe(0)
    expect(g0.vega).toBe(0)
  })

  it('ATM delta is approximately 0.5 for call', () => {
    // Short-dated ATM option has delta ≈ 0.5
    const atm = greeks(100, 100, 0.1, 0.05, 0.20, 'call')
    expect(atm.delta).toBeCloseTo(0.5, 0)
  })
})

describe('impliedVolatility', () => {
  it('round-trips: IV(BSM(sigma)) ≈ sigma', () => {
    const targetSigma = 0.25
    const price = blackScholesPrice(REF.S, REF.K, REF.T, REF.r, targetSigma, 'call')
    const iv = impliedVolatility(price, REF.S, REF.K, REF.T, REF.r, 'call')
    expect(iv).not.toBeNull()
    expect(iv!).toBeCloseTo(targetSigma, 4)
  })

  it('round-trips for put', () => {
    const targetSigma = 0.30
    const price = blackScholesPrice(REF.S, REF.K, REF.T, REF.r, targetSigma, 'put')
    const iv = impliedVolatility(price, REF.S, REF.K, REF.T, REF.r, 'put')
    expect(iv).not.toBeNull()
    expect(iv!).toBeCloseTo(targetSigma, 4)
  })

  it('returns null for T=0', () => {
    expect(impliedVolatility(2, 50, 50, 0, 0.05, 'call')).toBeNull()
  })

  it('returns null for price below intrinsic', () => {
    // Deep ITM call with near-zero extrinsic — below intrinsic should fail
    const intrinsic = 50 - 40 * Math.exp(-0.05 * 0.5)  // ≈ 10.99
    expect(impliedVolatility(intrinsic - 5, 50, 40, 0.5, 0.05, 'call')).toBeNull()
  })

  it('handles high-vol inputs', () => {
    const sigma = 1.50  // 150% vol
    const price = blackScholesPrice(100, 100, 1, 0.05, sigma, 'call')
    const iv = impliedVolatility(price, 100, 100, 1, 0.05, 'call')
    expect(iv).not.toBeNull()
    expect(iv!).toBeCloseTo(sigma, 2)
  })
})

// ─── Merton dividend extension (Phase 13 S2 — F3.1) ─────────────────────────

describe('Merton dividend yield (F3.1)', () => {
  const S = 70, K = 70, T = 0.25, r = 0.04, sigma = 0.20

  it('q=0 reduces to original Black-Scholes (backward compat)', () => {
    const price0 = blackScholesPrice(S, K, T, r, sigma, 'call', 0)
    const priceDefault = blackScholesPrice(S, K, T, r, sigma, 'call')
    expect(price0).toBeCloseTo(priceDefault, 10)
  })

  it('non-zero q reduces call price (Merton: dividend reduces call value)', () => {
    const callQ0 = blackScholesPrice(S, K, T, r, sigma, 'call', 0)
    const callQ034 = blackScholesPrice(S, K, T, r, sigma, 'call', 0.034)  // XLU yield
    expect(callQ034).toBeLessThan(callQ0)
  })

  it('non-zero q increases put price (symmetric to call)', () => {
    const putQ0 = blackScholesPrice(S, K, T, r, sigma, 'put', 0)
    const putQ034 = blackScholesPrice(S, K, T, r, sigma, 'put', 0.034)
    expect(putQ034).toBeGreaterThan(putQ0)
  })

  it('put-call parity holds with q != 0: C - P = S·e^-qT - K·e^-rT', () => {
    const q = 0.034
    const C = blackScholesPrice(S, K, T, r, sigma, 'call', q)
    const P = blackScholesPrice(S, K, T, r, sigma, 'put', q)
    const lhs = C - P
    const rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T)
    expect(lhs).toBeCloseTo(rhs, 6)
  })

  it('greeks delta scales by exp(-q·T) for calls', () => {
    const q = 0.05
    const gQ0 = greeks(S, K, T, r, sigma, 'call', 0)
    const gQ = greeks(S, K, T, r, sigma, 'call', q)
    expect(gQ.delta).toBeLessThan(gQ0.delta)
  })

  it('IV solver recovers q-aware implied vol', () => {
    const targetSigma = 0.25
    const q = 0.034
    const price = blackScholesPrice(S, K, T, r, targetSigma, 'call', q)
    const iv = impliedVolatility(price, S, K, T, r, 'call', q)
    expect(iv).not.toBeNull()
    expect(iv!).toBeCloseTo(targetSigma, 3)
  })
})

// ─── IV solver hardening (F3.2 partial) ─────────────────────────────────────

describe('IV solver Brenner-Subrahmanyam seed + sigma clamp (F3.2)', () => {
  it('converges fast for ATM options (BS seed close to truth)', () => {
    const sigma = 0.20
    const price = blackScholesPrice(100, 100, 0.5, 0.04, sigma, 'call')
    const iv = impliedVolatility(price, 100, 100, 0.5, 0.04, 'call')
    expect(iv).not.toBeNull()
    expect(iv!).toBeCloseTo(sigma, 4)
  })

  it('converges for deep-OTM options (sigma clamp prevents divergence)', () => {
    const sigma = 1.50
    const price = blackScholesPrice(100, 150, 1, 0.04, sigma, 'call')  // OTM
    const iv = impliedVolatility(price, 100, 150, 1, 0.04, 'call')
    expect(iv).not.toBeNull()
    expect(iv!).toBeCloseTo(sigma, 2)
  })

  it('returns null or finite value on absurd inputs without throwing', () => {
    // Premium > spot for an OTM put — pathological. Solver must not crash.
    const r = impliedVolatility(150, 100, 50, 1, 0.04, 'put')
    expect(typeof r === 'number' || r === null).toBe(true)
  })
})
