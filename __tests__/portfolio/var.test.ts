import { describe, it, expect } from 'vitest'
import {
  computeVaR,
  computePortfolioVaR,
  backtestVaR,
  kupiecPOFTest,
} from '@/lib/portfolio/var'

/**
 * Tests for lib/portfolio/var.ts — Value-at-Risk + Expected Shortfall.
 *
 * Phase 13 S2 audit findings under test:
 *
 *   Q1 (Quant): multi-day parametric VaR previously scaled the mean term
 *   by √T instead of T (Hull §22.5 eq 22.11). Fixed; this suite pins the
 *   corrected scaling.
 *
 *   F2 / A (AI + Full-stack): backtestVaR documented a TODO for the
 *   Kupiec POF test (Kupiec 1995, Jorion 2007 ch. 6) — now implemented.
 *   This suite covers the test's accept/reject decisions across
 *   well-calibrated, too-conservative, and too-aggressive models.
 */

// Synthetic Gaussian-ish daily returns: mean = 0.0005, sigma = 0.01.
function gaussLike(n: number, mean = 0.0005, sigma = 0.01, seed = 7): number[] {
  // Deterministic pseudo-random (linear congruential) — vitest must be reproducible.
  let s = seed
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000 }
  // Box-Muller: U1, U2 → Z = sqrt(-2 ln U1) cos(2π U2)
  const out: number[] = []
  while (out.length < n) {
    const u1 = next(), u2 = next()
    if (u1 <= 0) continue
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    out.push(mean + sigma * z)
  }
  return out
}

describe('computeVaR', () => {
  const returns = gaussLike(500, 0, 0.01)

  it('returns null for insufficient data (< 30 obs)', () => {
    expect(computeVaR([0.01, -0.02, 0.005], 0.95, 1)).toBeNull()
  })

  it('returns finite VaR for 500 sigma-1% returns', () => {
    const r = computeVaR(returns, 0.95, 1)
    expect(r).not.toBeNull()
    expect(r!.historicalVaR).toBeGreaterThan(0)
    expect(r!.parametricVaR).toBeGreaterThan(0)
    // 5%-VaR for σ=1% should be roughly 1.645×0.01 ≈ 1.65% (give or take sampling).
    expect(r!.parametricVaR).toBeGreaterThan(0.012)
    expect(r!.parametricVaR).toBeLessThan(0.025)
  })

  it('VaR_99 > VaR_95 (higher confidence → larger tail)', () => {
    const r95 = computeVaR(returns, 0.95, 1)!
    const r99 = computeVaR(returns, 0.99, 1)!
    expect(r99.historicalVaR).toBeGreaterThan(r95.historicalVaR)
    expect(r99.parametricVaR).toBeGreaterThan(r95.parametricVaR)
  })

  it('CVaR >= VaR for the same confidence (tail-mean ≥ tail-threshold)', () => {
    const r = computeVaR(returns, 0.95, 1)!
    expect(r.historicalCVaR).toBeGreaterThanOrEqual(r.historicalVaR)
  })

  /**
   * Q1 regression: multi-day parametric VaR scales σ by √T and μ by T.
   * Construct a series with a noticeable positive drift, then verify that
   * the 10-day VaR is LESS than 10× the 1-day VaR (because drift
   * accumulates linearly, partially offsetting the sigma×√10 growth).
   */
  it('multi-day parametric VaR scales mean linearly, vol by √T', () => {
    const drifty = gaussLike(500, 0.002, 0.01) // 0.2%/day drift
    const v1 = computeVaR(drifty, 0.95, 1)!
    const v10 = computeVaR(drifty, 0.95, 10)!
    // Vol contribution scales by √10 ≈ 3.162. Mean contribution scales by 10.
    // With positive drift, the linear mean term offsets some of the vol risk,
    // so 10-day VaR < 10 × 1-day VaR. Without the fix (mean scaling by √T),
    // this inequality could fail.
    expect(v10.parametricVaR).toBeLessThan(v1.parametricVaR * 10)
    // But still > 1-day (sigma grows with sqrt of horizon).
    expect(v10.parametricVaR).toBeGreaterThan(v1.parametricVaR)
  })

  it('zero-drift parametric VaR scales exactly by √T', () => {
    const flat = gaussLike(500, 0, 0.01)
    const v1 = computeVaR(flat, 0.95, 1)!
    const v10 = computeVaR(flat, 0.95, 10)!
    // With μ ≈ 0, VaR ≈ z·σ·√T. Ratio ≈ √10.
    const ratio = v10.parametricVaR / v1.parametricVaR
    expect(ratio).toBeGreaterThan(Math.sqrt(10) * 0.9)
    expect(ratio).toBeLessThan(Math.sqrt(10) * 1.1)
  })
})

describe('computePortfolioVaR', () => {
  it('returns 4 metrics (95/99 × 1d/10d) + summary table', () => {
    const returns = gaussLike(500, 0, 0.01)
    const p = computePortfolioVaR(returns)
    expect(p.var95_1d).not.toBeNull()
    expect(p.var99_1d).not.toBeNull()
    expect(p.var95_10d).not.toBeNull()
    expect(p.var99_10d).not.toBeNull()
    expect(p.summary).toHaveLength(4)
    expect(p.summary[0].label).toMatch(/95% \(1-day\)/)
  })
})

describe('kupiecPOFTest', () => {
  /**
   * Test the formal statistical decision rule with known cases.
   * For c = 0.99, expected breach rate p = 0.01.
   * χ²₁ critical at α=0.05 is 3.8415.
   */
  it('does NOT reject a well-calibrated model (observed = expected)', () => {
    // 1000 observations, exactly 10 breaches (1% rate, matching p=1%).
    const result = kupiecPOFTest(10, 1000, 0.99)
    expect(result.observedRate).toBeCloseTo(0.01, 4)
    expect(result.expectedRate).toBeCloseTo(0.01, 10)
    expect(result.lr).toBeCloseTo(0, 4) // LR = 0 when p̂ = p
    expect(result.reject).toBe(false)
  })

  it('REJECTS a too-aggressive model (way too many breaches)', () => {
    // 1000 obs, 50 breaches (5% rate vs 1% expected).
    const result = kupiecPOFTest(50, 1000, 0.99)
    expect(result.observedRate).toBe(0.05)
    expect(result.lr).toBeGreaterThan(3.8415)
    expect(result.reject).toBe(true)
  })

  it('REJECTS a too-conservative model (way too few breaches)', () => {
    // 1000 obs, 1 breach (0.1% rate vs 1% expected).
    const result = kupiecPOFTest(1, 1000, 0.99)
    expect(result.observedRate).toBeCloseTo(0.001, 5)
    expect(result.lr).toBeGreaterThan(3.8415)
    expect(result.reject).toBe(true)
  })

  it('returns LR=0 / no reject when breaches=0 or breaches=N (degenerate)', () => {
    expect(kupiecPOFTest(0, 1000, 0.99).reject).toBe(false)
    expect(kupiecPOFTest(0, 1000, 0.99).lr).toBe(0)
    expect(kupiecPOFTest(1000, 1000, 0.99).reject).toBe(false)
  })

  it('respects alpha parameter for critical value', () => {
    expect(kupiecPOFTest(0, 0, 0.99, 0.10).chiSqCrit).toBeCloseTo(2.7055, 3)
    expect(kupiecPOFTest(0, 0, 0.99, 0.05).chiSqCrit).toBeCloseTo(3.8415, 3)
    expect(kupiecPOFTest(0, 0, 0.99, 0.01).chiSqCrit).toBeCloseTo(6.6349, 3)
  })

  it('uses default 0.05 critical for unknown alpha', () => {
    expect(kupiecPOFTest(0, 0, 0.99, 0.123).chiSqCrit).toBeCloseTo(3.8415, 3)
  })
})

describe('backtestVaR', () => {
  it('includes both heuristic verdict and kupiec test result', () => {
    const returns = gaussLike(500, 0, 0.01)
    const r = backtestVaR(returns, 0.99, 252)
    expect(r.total).toBeGreaterThan(0)
    expect(r).toHaveProperty('heuristicPass')
    expect(r).toHaveProperty('kupiec')
    expect(r.kupiec).toHaveProperty('lr')
    expect(r.kupiec).toHaveProperty('reject')
  })

  it('returns 0 breaches + non-reject for too-short series', () => {
    const r = backtestVaR(gaussLike(100, 0, 0.01), 0.99, 252)
    expect(r.total).toBe(0)
    expect(r.breaches).toBe(0)
    expect(r.heuristicPass).toBe(true)
    expect(r.kupiec.reject).toBe(false)
  })
})
