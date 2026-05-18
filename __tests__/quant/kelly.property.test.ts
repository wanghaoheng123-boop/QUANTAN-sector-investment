/**
 * Property-style tests for `halfKelly`.
 *
 * Phase 14 (R8-H-1): the existing kelly.test.ts covers a handful of
 * hand-picked numeric points. This suite exercises invariants over many
 * deterministically-seeded inputs so we catch regressions in domain handling
 * (NaN, ±Infinity, out-of-[0,1] probabilities, non-positive payoffs) and
 * monotonicity / boundary properties of the formula.
 *
 * No fast-check dependency — a tiny LCG (numerical recipes constants) gives
 * us a deterministic, reproducible pseudo-random stream, which is sufficient
 * for these bounded-domain checks and keeps the test footprint zero-dep.
 */
import { describe, it, expect } from 'vitest'
import { halfKelly, kellyFraction } from '@/lib/quant/kelly'

/** Numerical Recipes LCG — deterministic seeded pseudo-random in [0, 1). */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    // a = 1664525, c = 1013904223, m = 2^32 (modulo via >>> 0)
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const ITERATIONS = 200

describe('halfKelly — property bounds', () => {
  it('returns null for any non-finite or out-of-domain input', () => {
    const rng = makeLcg(0xc0ffee)
    const bad = [NaN, Infinity, -Infinity, 0, -0.5, 1, 1.5, -1]
    for (let i = 0; i < ITERATIONS; i++) {
      // Pick one of the three arguments to corrupt; randomise the others.
      const winProb = bad[Math.floor(rng() * bad.length)]
      const avgWin = 0.01 + rng() * 0.5
      const avgLoss = 0.01 + rng() * 0.5
      expect(halfKelly(winProb, avgWin, avgLoss)).toBeNull()
    }
    for (let i = 0; i < ITERATIONS; i++) {
      const winProb = 0.05 + rng() * 0.9 // valid (0, 1)
      const avgWin = bad[Math.floor(rng() * bad.length)]
      const avgLoss = 0.01 + rng() * 0.5
      // avgWin in {NaN, ±Inf, 0, -0.5, -1} all invalid; some `bad` values
      // (1, 1.5) are positive finite and would yield a valid Kelly — skip
      // those to keep the assertion sharp.
      if (Number.isFinite(avgWin) && avgWin > 0) continue
      expect(halfKelly(winProb, avgWin, avgLoss)).toBeNull()
    }
  })

  it('clamps to 0 when edge is non-positive (negative-edge bet)', () => {
    const rng = makeLcg(0xfeed01)
    // Construct (winProb, avgWin, avgLoss) so that p·avgWin <= (1-p)·avgLoss.
    for (let i = 0; i < ITERATIONS; i++) {
      const winProb = 0.05 + rng() * 0.4 // p in (0.05, 0.45) — below 0.5
      const avgWin = 0.01 + rng() * 0.1
      // Force avgLoss large enough that p·avgWin <= (1-p)·avgLoss.
      const avgLoss = avgWin * (winProb / (1 - winProb)) + 0.01
      const v = halfKelly(winProb, avgWin, avgLoss)
      expect(v).not.toBeNull()
      expect(v!).toBe(0)
    }
  })

  it('is always in [0, 0.5) for any valid input (half-Kelly upper bound)', () => {
    const rng = makeLcg(0x123456)
    for (let i = 0; i < ITERATIONS; i++) {
      // winProb strictly in (0, 1), payoffs strictly positive.
      const winProb = 0.001 + rng() * 0.998
      const avgWin = 0.001 + rng() * 10
      const avgLoss = 0.001 + rng() * 10
      const v = halfKelly(winProb, avgWin, avgLoss)
      expect(v).not.toBeNull()
      expect(v!).toBeGreaterThanOrEqual(0)
      // Full-Kelly f* < 1 strictly when p < 1, so half-Kelly < 0.5 strictly.
      expect(v!).toBeLessThan(0.5)
    }
  })

  it('returns > 0 for a known positive-edge bet (p=0.6, w=0.05, l=0.03)', () => {
    // f* = 0.6 - 0.4 / (0.05/0.03) = 0.6 - 0.4 * 0.6 = 0.6 - 0.24 = 0.36
    // half-Kelly = 0.18
    const v = halfKelly(0.6, 0.05, 0.03)
    expect(v).not.toBeNull()
    expect(v!).toBeGreaterThan(0)
    expect(v!).toBeCloseTo(0.18, 10)
  })

  it('is consistent with kellyFraction: halfKelly = max(0, kellyFraction/2)', () => {
    const rng = makeLcg(0xabcdef)
    for (let i = 0; i < ITERATIONS; i++) {
      const winProb = 0.001 + rng() * 0.998
      const avgWin = 0.001 + rng() * 5
      const avgLoss = 0.001 + rng() * 5
      const f = kellyFraction(winProb, avgWin, avgLoss)
      const h = halfKelly(winProb, avgWin, avgLoss)
      expect(f).not.toBeNull()
      expect(h).not.toBeNull()
      expect(h!).toBeCloseTo(Math.max(0, f! / 2), 12)
    }
  })

  it('is monotonically non-decreasing in winProb (other params fixed)', () => {
    // For fixed avgWin/avgLoss, raising p only ever increases f* (and so
    // half-Kelly, after the >=0 clamp).
    const rng = makeLcg(0x55aa55)
    for (let i = 0; i < 50; i++) {
      const avgWin = 0.01 + rng() * 0.5
      const avgLoss = 0.01 + rng() * 0.5
      const ps = [0.1, 0.3, 0.5, 0.7, 0.9]
      let prev = -Infinity
      for (const p of ps) {
        const v = halfKelly(p, avgWin, avgLoss)
        expect(v).not.toBeNull()
        expect(v!).toBeGreaterThanOrEqual(prev)
        prev = v!
      }
    }
  })
})
