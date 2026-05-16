import { describe, it, expect } from 'vitest'
import { computeAdaptiveBands } from '@/lib/quant/priceBands'

describe('Adaptive Price Bands', () => {
  it('computes valid bands for single anchor', () => {
    const result = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [120],
      annualizedVol: 0.25,
    })
    expect(result.fairValueMid).toBe(120)
    expect(result.buyZoneHigh).toBeLessThan(120)
    expect(result.sellZoneLow).toBeGreaterThan(120)
  })

  it('uses median of multiple anchors', () => {
    const result = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [100, 120, 200],
      annualizedVol: 0.20,
    })
    expect(result.fairValueMid).toBe(120) // median of [100, 120, 200]
  })

  it('handles even number of anchors (average of middle two)', () => {
    const result = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [100, 110, 120, 130],
      annualizedVol: 0.20,
    })
    expect(result.fairValueMid).toBeCloseTo(115, 5) // avg of 110, 120
  })

  it('buy zone < fair value < sell zone always', () => {
    const vols = [0.05, 0.10, 0.20, 0.40, 0.80]
    for (const vol of vols) {
      const result = computeAdaptiveBands({
        currentPrice: 100,
        anchors: [100, 120, 110],
        annualizedVol: vol,
      })
      expect(result.buyZoneHigh!).toBeLessThan(result.fairValueMid!)
      expect(result.sellZoneLow!).toBeGreaterThan(result.fairValueMid!)
    }
  })

  it('higher vol widens the bands', () => {
    const lowVol = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [120],
      annualizedVol: 0.10,
    })
    const highVol = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [120],
      annualizedVol: 0.40,
    })
    // Higher vol should push buy zone lower and sell zone higher
    expect(highVol.buyZoneHigh!).toBeLessThan(lowVol.buyZoneHigh!)
    expect(highVol.sellZoneLow!).toBeGreaterThan(lowVol.sellZoneLow!)
  })

  it('returns nulls for empty anchors', () => {
    const result = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [],
      annualizedVol: 0.20,
    })
    expect(result.fairValueMid).toBeNull()
    expect(result.buyZoneHigh).toBeNull()
    expect(result.sellZoneLow).toBeNull()
  })

  it('filters out null/undefined/invalid anchors', () => {
    const result = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [null, undefined, -5, 0, 120],
      annualizedVol: 0.20,
    })
    expect(result.fairValueMid).toBe(120)
  })

  it('returns nulls for invalid price', () => {
    const result = computeAdaptiveBands({
      currentPrice: 0,
      anchors: [120],
      annualizedVol: 0.20,
    })
    expect(result.fairValueMid).toBeNull()
  })

  it('clamps vol to [0.05, 0.80]', () => {
    // Even with extreme vol, bands should be reasonable
    const result = computeAdaptiveBands({
      currentPrice: 100,
      anchors: [120],
      annualizedVol: 5.0, // will be clamped to 0.80
    })
    expect(result.fairValueMid).toBe(120)
    expect(result.buyZoneHigh!).toBeGreaterThan(0)
    expect(result.sellZoneLow!).toBeLessThan(500)
  })

  /**
   * Methodology string accurately describes the actual margins it produced.
   * Previously the string used `m` and `m + 0.12` as the buy-zone bounds,
   * but the +0.12 was already inside `m` via Math.min(0.12, vol*0.6) —
   * effectively double-counting and giving users an inflated display.
   */
  describe('methodology string honesty (regression)', () => {
    it('reports the actual buy-zone margin used', () => {
      // baseMargin=0.08, vol=0.10 → m = 0.08 + min(0.12, 0.10*0.6) = 0.14
      const r = computeAdaptiveBands({
        currentPrice: 100,
        anchors: [120],
        annualizedVol: 0.10,
      })
      // Buy zone is 14% below mid: 120 * (1 - 0.14) = 103.2
      expect(r.buyZoneHigh).toBeCloseTo(103.2, 5)
      // Methodology string should mention the 14% buy-zone margin
      expect(r.methodology).toMatch(/14\.0% below fair value/)
    })

    it('reports the dynamic margin range as 8%–20%, not the always-shifted +0.12', () => {
      const r = computeAdaptiveBands({
        currentPrice: 100,
        anchors: [120],
        annualizedVol: 0.30,
      })
      // The dynamic range mentioned should be the global range (8% min,
      // 20% max), not "today's-margin to today's-margin+12".
      expect(r.methodology).toMatch(/8%–20% range/)
    })
  })
})
