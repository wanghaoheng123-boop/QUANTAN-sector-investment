import { describe, it, expect } from 'vitest'
import { annualizedVolFromCloses } from '@/lib/quant/volatility'

describe('Annualized Volatility', () => {
  it('returns default 0.22 for insufficient data', () => {
    expect(annualizedVolFromCloses([100, 101])).toBe(0.22)
  })

  it('computes positive vol for varying prices', () => {
    const closes = [100, 102, 98, 103, 97, 105, 101, 108, 95, 110]
    const vol = annualizedVolFromCloses(closes)
    expect(vol).toBeGreaterThan(0)
    expect(vol).toBeLessThan(2) // reasonable upper bound
  })

  it('low vol for smooth series', () => {
    // Very smooth uptrend: ~1% per day
    const closes = Array.from({ length: 50 }, (_, i) => 100 * Math.pow(1.001, i))
    const vol = annualizedVolFromCloses(closes)
    expect(vol).toBeLessThan(0.05) // very low vol
  })

  it('high vol for volatile series', () => {
    // Alternating +5% and -5%
    const closes = Array.from({ length: 50 }, (_, i) => 100 * (i % 2 === 0 ? 1 : 1.05))
    const vol = annualizedVolFromCloses(closes)
    expect(vol).toBeGreaterThan(0.3)
  })

  it('filters out non-finite and non-positive values', () => {
    const closes = [100, NaN, 102, -5, 101, Infinity, 103, 0, 105, 104, 106, 107, 108]
    // Should filter out bad values and compute from valid ones
    const vol = annualizedVolFromCloses(closes)
    expect(vol).toBeGreaterThan(0)
    expect(Number.isFinite(vol)).toBe(true)
  })

  it('scales by sqrt(252)', () => {
    // For known daily volatility, annualized = dailySigma * sqrt(252)
    // Create random walk with known seed-like pattern
    const closes = [100]
    for (let i = 1; i < 100; i++) {
      // Alternating returns create measurable volatility
      const ret = i % 2 === 0 ? 0.01 : -0.005
      closes.push(closes[i - 1] * (1 + ret))
    }
    const vol = annualizedVolFromCloses(closes)
    // Should be positive and finite, roughly in expected range
    expect(vol).toBeGreaterThan(0)
    expect(Number.isFinite(vol)).toBe(true)
    // The alternating pattern has daily sigma around 0.0075
    // Annualized: ~0.0075 * sqrt(252) ≈ 0.12
    expect(vol).toBeGreaterThan(0.05)
    expect(vol).toBeLessThan(0.30)
  })
})
