/**
 * Q-078 wave 1 (2026-07-17) — mutation hardening for the options shard
 * (62.13 on run 29553164644). Targets the two largest surviving clusters:
 * greeks.ts (118 survived — Black-Scholes-Merton pure math, pinned to
 * textbook values and no-constant identities) and sentiment.ts (83 —
 * put/call ratio sentinels + hand-computed max-pain payout curves).
 */
import { describe, it, expect } from 'vitest'
import {
  normalCdf,
  normalPdf,
  blackScholesPrice,
  greeks,
  impliedVolatility,
} from '@/lib/options/greeks'
import { putCallRatio, maxPain } from '@/lib/options/sentiment'
import type { CallOrPut } from '@/lib/options/chain'

// ─── normalCdf / normalPdf ───────────────────────────────────────────────────

describe('normalCdf — A&S 26.2.17 pins', () => {
  it('matches standard normal table values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7)
    expect(normalCdf(1.96)).toBeCloseTo(0.975002, 5)
    expect(normalCdf(-1.96)).toBeCloseTo(0.024998, 5)
    expect(normalCdf(1)).toBeCloseTo(0.841345, 5)
    // symmetry identity Φ(x) + Φ(−x) = 1
    for (const x of [0.3, 1.1, 2.7]) {
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 7)
    }
  })
  it('saturates exactly at |x| ≥ 8 and propagates NaN', () => {
    expect(normalCdf(8)).toBe(1)
    expect(normalCdf(-8)).toBe(0)
    expect(normalCdf(9.5)).toBe(1)
    expect(Number.isNaN(normalCdf(NaN))).toBe(true)
  })
  it('normalPdf peaks at 1/√(2π) and is symmetric', () => {
    expect(normalPdf(0)).toBeCloseTo(0.3989422804014327, 12)
    expect(normalPdf(1)).toBeCloseTo(0.24197072451914337, 12)
    expect(normalPdf(-1.7)).toBeCloseTo(normalPdf(1.7), 15)
  })
})

// ─── Black-Scholes-Merton price ──────────────────────────────────────────────

describe('blackScholesPrice — textbook ATM pins (S=K=100, T=1, r=5%, σ=20%)', () => {
  const [S, K, T, r, sigma] = [100, 100, 1, 0.05, 0.2]

  it('call 10.4506 / put 5.5735 (Hull-style reference values)', () => {
    expect(blackScholesPrice(S, K, T, r, sigma, 'call')).toBeCloseTo(10.4506, 3)
    expect(blackScholesPrice(S, K, T, r, sigma, 'put')).toBeCloseTo(5.5735, 3)
  })

  it('put-call parity holds to high precision, with and without dividend yield', () => {
    for (const q of [0, 0.03]) {
      const c = blackScholesPrice(S, K, T, r, sigma, 'call', q)
      const p = blackScholesPrice(S, K, T, r, sigma, 'put', q)
      expect(c - p).toBeCloseTo(S * Math.exp(-q * T) - K * Math.exp(-r * T), 10)
    }
  })

  it('Merton dividend yield lowers calls and raises puts', () => {
    const c0 = blackScholesPrice(S, K, T, r, sigma, 'call')
    const cq = blackScholesPrice(S, K, T, r, sigma, 'call', 0.03)
    const p0 = blackScholesPrice(S, K, T, r, sigma, 'put')
    const pq = blackScholesPrice(S, K, T, r, sigma, 'put', 0.03)
    expect(cq).toBeLessThan(c0)
    expect(pq).toBeGreaterThan(p0)
  })

  it('degenerate inputs price at exactly 0', () => {
    expect(blackScholesPrice(100, 100, 0, r, sigma, 'call')).toBe(0)
    expect(blackScholesPrice(100, 100, T, r, 0, 'call')).toBe(0)
    expect(blackScholesPrice(0, 100, T, r, sigma, 'put')).toBe(0)
    expect(blackScholesPrice(100, 0, T, r, sigma, 'put')).toBe(0)
  })
})

// ─── Greeks ──────────────────────────────────────────────────────────────────

describe('greeks — ATM reference pins + structural identities', () => {
  const [S, K, T, r, sigma] = [100, 100, 1, 0.05, 0.2]
  const call = greeks(S, K, T, r, sigma, 'call')
  const put = greeks(S, K, T, r, sigma, 'put')

  it('pins the five call Greeks at the reference point', () => {
    expect(call.delta).toBeCloseTo(0.6368, 3)
    expect(call.gamma).toBeCloseTo(0.018762, 4)
    expect(call.vega).toBeCloseTo(0.37524, 3) // per 1 vol point
    expect(call.rho).toBeCloseTo(0.53232, 3) // per 1pp rate move
    expect(call.theta).toBeCloseTo(-6.414 / 365, 4) // $/day
  })

  it('put Greeks relate to call Greeks by the BSM identities', () => {
    // delta_call − delta_put = e^{−qT} = 1 at q=0
    expect(call.delta - put.delta).toBeCloseTo(1, 8)
    expect(put.delta).toBeCloseTo(-0.3632, 3)
    expect(put.gamma).toBeCloseTo(call.gamma, 12) // gamma identical
    expect(put.vega).toBeCloseTo(call.vega, 12) // vega identical
    expect(put.rho).toBeLessThan(0)
    // theta_call − theta_put = (annual) [−rK·e^{−rT}] /365 · … sign check only:
    expect(put.theta).toBeLessThan(0)
    expect(call.theta).toBeLessThan(put.theta) // ATM call decays faster at r>0
  })

  it('dividend yield scales delta by e^{−qT}', () => {
    const q = 0.04
    const cq = greeks(S, K, T, r, sigma, 'call', q)
    // Merton: delta = e^{−qT}·N(d1) with d1 shifted by −q — recompute directly
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
    expect(cq.delta).toBeCloseTo(Math.exp(-q * T) * normalCdf(d1), 10)
  })

  it('expiry returns intrinsic delta indicators, all else zero', () => {
    expect(greeks(120, 100, 0, r, sigma, 'call')).toEqual({ delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 })
    expect(greeks(80, 100, 0, r, sigma, 'call').delta).toBe(0)
    expect(greeks(80, 100, 0, r, sigma, 'put').delta).toBe(-1)
    expect(greeks(120, 100, 0, r, sigma, 'put').delta).toBe(0)
    expect(greeks(100, 100, 0, r, sigma, 'call').delta).toBe(0) // ATM at expiry
  })

  it('degenerate live option (σ≤0 / S≤0 / K≤0) zeroes every Greek', () => {
    const zero = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }
    expect(greeks(100, 100, T, r, 0, 'call')).toEqual(zero)
    expect(greeks(0, 100, T, r, sigma, 'put')).toEqual(zero)
    expect(greeks(100, 0, T, r, sigma, 'call')).toEqual(zero)
  })
})

// ─── Implied volatility ──────────────────────────────────────────────────────

describe('impliedVolatility — Newton-Raphson round trips', () => {
  const [S, T, r] = [100, 0.5, 0.05]

  it('recovers the input vol from a BSM price (ATM Brenner seed + OTM fallback seed)', () => {
    for (const [K, sigma, type] of [
      [100, 0.3, 'call'], // ATM — Brenner-Subrahmanyam seed branch
      [150, 0.45, 'call'], // deep OTM — moneyness fallback seed
      [70, 0.25, 'put'], // deep OTM put
    ] as const) {
      const price = blackScholesPrice(S, K, T, r, sigma, type)
      const iv = impliedVolatility(price, S, K, T, r, type)
      expect(iv).not.toBeNull()
      expect(iv!).toBeCloseTo(sigma, 2)
    }
  })

  it('honours the Merton intrinsic floor with dividend yield', () => {
    const q = 0.06
    const sigma = 0.35
    const price = blackScholesPrice(S, 90, T, r, sigma, 'call', q)
    const iv = impliedVolatility(price, S, 90, T, r, 'call', q)
    expect(iv!).toBeCloseTo(sigma, 2)
  })

  it('fails closed: below intrinsic, expired, or non-positive inputs', () => {
    // deep ITM call priced below intrinsic value
    const intrinsic = 100 - 50 * Math.exp(-r * T)
    expect(impliedVolatility(intrinsic - 1, S, 50, T, r, 'call')).toBeNull()
    expect(impliedVolatility(5, S, 100, 0, r, 'call')).toBeNull()
    expect(impliedVolatility(0, S, 100, T, r, 'call')).toBeNull()
    expect(impliedVolatility(5, 0, 100, T, r, 'call')).toBeNull()
  })
})

// ─── sentiment: put/call ratio ───────────────────────────────────────────────

const row = (o: Partial<CallOrPut>): CallOrPut => o as CallOrPut

describe('putCallRatio — finite-guard sums and the PCR_MAX sentinel', () => {
  it('sums only finite non-negative fields', () => {
    const calls = [row({ volume: 10, openInterest: 0 }), row({ volume: NaN }), row({ volume: -5 })]
    const puts = [row({ volume: 25, openInterest: 7 })]
    const r = putCallRatio(calls, puts)
    expect(r.volumeRatio).toBeCloseTo(2.5, 12) // 25 / 10 — NaN and −5 ignored
    expect(r.oiRatio).toBe(99) // puts have OI, calls none → sentinel, not null
  })

  it('null only when BOTH sides are silent', () => {
    expect(putCallRatio([], [])).toEqual({ volumeRatio: null, oiRatio: null })
    const r = putCallRatio([row({ volume: 4 })], [])
    expect(r.volumeRatio).toBe(0) // calls active, puts zero → 0, not null
  })
})

// ─── sentiment: max pain ─────────────────────────────────────────────────────

describe('maxPain — hand-computed payout curve', () => {
  it('picks the strike minimising total writer payout', () => {
    const calls = [row({ strike: 90, openInterest: 10 }), row({ strike: 100, openInterest: 20 })]
    const puts = [row({ strike: 100, openInterest: 15 }), row({ strike: 110, openInterest: 5 })]
    // payouts: K=90 → 25,000 | K=100 → 15,000 | K=110 → 40,000
    expect(maxPain(calls, puts)).toBe(100)
  })

  it('fails closed on empty strikes and on zero total OI', () => {
    expect(maxPain([], [])).toBeNull()
    expect(maxPain([row({ strike: 100, openInterest: 0 })], [])).toBeNull()
    expect(maxPain([row({ strike: NaN, openInterest: 50 })], [])).toBeNull() // NaN strike dropped
  })

  it('tie-break: nearest to spot when supplied, median otherwise', () => {
    // Only OI sits above every candidate → payout 0 at all three strikes (tie)
    const calls = [
      row({ strike: 90, openInterest: 0 }),
      row({ strike: 100, openInterest: 0 }),
      row({ strike: 110, openInterest: 5 }),
    ]
    expect(maxPain(calls, [], 88)).toBe(90) // nearest spot
    expect(maxPain(calls, [], 108)).toBe(110)
    expect(maxPain(calls, [])).toBe(100) // median of [90, 100, 110]
  })
})
