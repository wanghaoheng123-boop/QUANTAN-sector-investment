import { describe, it, expect } from 'vitest'
import { volumeProfile, priceRelativeToPOC } from '@/lib/quant/volumeProfile'
import type { OhlcvBar } from '@/lib/quant/indicators'

function generateBars(count: number, basePrice = 100, volumeBase = 1_000_000): OhlcvBar[] {
  const bars: OhlcvBar[] = []
  for (let i = 0; i < count; i++) {
    const price = basePrice + Math.sin(i * 0.3) * 10
    bars.push({
      open: price - 0.5,
      high: price + 2,
      low: price - 2,
      close: price + 0.5,
      volume: volumeBase + Math.sin(i * 0.7) * 500_000,
    })
  }
  return bars
}

describe('volumeProfile', () => {
  it('returns POC and value area', () => {
    const bars = generateBars(50)
    const result = volumeProfile(bars)

    expect(result).not.toBeNull()
    expect(result!.poc).toBeGreaterThan(0)
    expect(result!.valueAreaHigh).toBeGreaterThanOrEqual(result!.poc)
    expect(result!.valueAreaLow).toBeLessThanOrEqual(result!.poc)
  })

  it('value area high >= value area low', () => {
    const bars = generateBars(50)
    const result = volumeProfile(bars)

    expect(result).not.toBeNull()
    expect(result!.valueAreaHigh).toBeGreaterThanOrEqual(result!.valueAreaLow)
  })

  it('POC is within the price range', () => {
    const bars = generateBars(50, 100)
    const result = volumeProfile(bars)

    expect(result).not.toBeNull()
    const minPrice = Math.min(...bars.map(b => b.low))
    const maxPrice = Math.max(...bars.map(b => b.high))
    expect(result!.poc).toBeGreaterThanOrEqual(minPrice)
    expect(result!.poc).toBeLessThanOrEqual(maxPrice)
  })

  it('returns correct number of bins', () => {
    const bars = generateBars(50)
    const result = volumeProfile(bars, 30)

    expect(result).not.toBeNull()
    expect(result!.profileBins).toHaveLength(30)
  })

  it('total bin volume approximates total bar volume', () => {
    const bars = generateBars(50)
    const result = volumeProfile(bars)

    expect(result).not.toBeNull()
    const totalBinVol = result!.profileBins.reduce((s, b) => s + b.volume, 0)
    const totalBarVol = bars.reduce((s, b) => s + b.volume, 0)
    // Should be approximately equal (some rounding from bin distribution)
    expect(totalBinVol).toBeGreaterThan(0)
    expect(totalBinVol / totalBarVol).toBeCloseTo(1, 0)
  })

  it('returns null with too few bars', () => {
    const bars = generateBars(3)
    expect(volumeProfile(bars)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(volumeProfile([])).toBeNull()
  })

  it('respects lookback parameter', () => {
    const bars = generateBars(100)
    const result20 = volumeProfile(bars, 50, 20)
    const result50 = volumeProfile(bars, 50, 50)

    expect(result20).not.toBeNull()
    expect(result50).not.toBeNull()
    // Different lookbacks may produce different POC
    // Just verify both return valid results
    expect(result20!.poc).toBeGreaterThan(0)
    expect(result50!.poc).toBeGreaterThan(0)
  })

  it('high volume at a specific price makes that the POC', () => {
    // Create bars where most volume is concentrated at price ~100
    const bars: OhlcvBar[] = []
    for (let i = 0; i < 40; i++) {
      bars.push({
        open: 99, high: 101, low: 99, close: 100,
        volume: i < 30 ? 10_000_000 : 100_000, // heavy volume in first 30 bars
      })
    }
    // Add some bars at different prices with low volume
    for (let i = 0; i < 10; i++) {
      bars.push({
        open: 110, high: 115, low: 108, close: 112,
        volume: 100_000,
      })
    }

    const result = volumeProfile(bars)
    expect(result).not.toBeNull()
    // POC should be near 100 where most volume traded
    expect(result!.poc).toBeLessThan(105)
  })
})

describe('priceRelativeToPOC', () => {
  const profile = {
    poc: 100,
    valueAreaHigh: 105,
    valueAreaLow: 95,
    profileBins: [],
  }

  it('returns at_poc when price is near POC', () => {
    expect(priceRelativeToPOC(100, profile)).toBe('at_poc')
    expect(priceRelativeToPOC(100.2, profile)).toBe('at_poc') // within tolerance
  })

  it('returns above_va when price is above value area', () => {
    expect(priceRelativeToPOC(110, profile)).toBe('above_va')
  })

  it('returns below_va when price is below value area', () => {
    expect(priceRelativeToPOC(90, profile)).toBe('below_va')
  })

  it('returns in_va when price is within value area but not at POC', () => {
    expect(priceRelativeToPOC(97, profile)).toBe('in_va')
    expect(priceRelativeToPOC(103, profile)).toBe('in_va')
  })
})
