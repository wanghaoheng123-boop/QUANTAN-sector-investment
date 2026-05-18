import { describe, it, expect } from 'vitest'
import { detectRegime } from '@/lib/quant/regimeDetection'
import type { OhlcBar } from '@/lib/quant/indicators'

/** Generate closes with controlled volatility. */
function generateCloses(
  count: number,
  startPrice = 100,
  dailyVol = 0.01,
  trend = 0,
): number[] {
  const closes: number[] = [startPrice]
  for (let i = 1; i < count; i++) {
    const noise = Math.sin(i * 1.7) * dailyVol * startPrice
    const trendComponent = trend * i * 0.01
    closes.push(Math.max(1, startPrice + trendComponent + noise))
  }
  return closes
}

/** Generate OhlcBars from closes. */
function closesToBars(closes: number[]): OhlcBar[] {
  return closes.map((c, i) => ({
    open: i > 0 ? closes[i - 1] : c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
  }))
}

describe('detectRegime', () => {
  it('returns valid regime state structure', () => {
    const closes = generateCloses(100)
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    expect(result).toHaveProperty('volatilityRegime')
    expect(result).toHaveProperty('trendRegime')
    expect(result).toHaveProperty('strategyHint')
    expect(result).toHaveProperty('volRatio')
    expect(result).toHaveProperty('adxValue')
    expect(result).toHaveProperty('confidence')
  })

  it('volatilityRegime is a valid value', () => {
    const closes = generateCloses(100)
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    expect(['low', 'normal', 'high', 'crisis']).toContain(result.volatilityRegime)
  })

  it('trendRegime is a valid value', () => {
    const closes = generateCloses(100)
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    expect(['strong_trend', 'weak_trend', 'range_bound']).toContain(result.trendRegime)
  })

  it('strategyHint is a valid value', () => {
    const closes = generateCloses(100)
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    expect(['trend_following', 'mean_reversion', 'neutral']).toContain(result.strategyHint)
  })

  it('confidence is between 0 and 100', () => {
    const closes = generateCloses(100)
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(100)
  })

  it('low volatility regime when vol is compressed', () => {
    // Very low volatility: tight range
    const closes: number[] = []
    for (let i = 0; i < 100; i++) {
      closes.push(100 + Math.sin(i * 0.1) * 0.1) // tiny moves
    }
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    // With very compressed vol, the ratio should be low or normal
    expect(['low', 'normal']).toContain(result.volatilityRegime)
  })

  it('high/crisis vol when recent vol spikes', () => {
    // Normal for 60 days, then spike for 20 days
    const closes: number[] = []
    for (let i = 0; i < 60; i++) {
      closes.push(100 + Math.sin(i * 0.1) * 0.5)
    }
    for (let i = 0; i < 30; i++) {
      closes.push(100 + Math.sin(i * 0.3) * 5) // 10x volatility spike
    }
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    expect(['high', 'crisis']).toContain(result.volatilityRegime)
  })

  it('handles insufficient data gracefully', () => {
    const closes = generateCloses(10) // very short
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    // Should still return a valid result
    expect(result.volatilityRegime).toBeDefined()
    // Phase 14: volRatio is null when vol20/vol60 cannot be measured
    // (insufficient data) — previously returned the misleading 1.0 default.
    expect(result.volRatio).toBeNull()
  })

  it('trend_following hint with strong ADX and non-crisis vol', () => {
    // Strong trending market: consistent upward moves
    const closes: number[] = [50]
    for (let i = 1; i < 100; i++) {
      closes.push(closes[i - 1] + 0.5 + Math.sin(i) * 0.1)
    }
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    // Strong trend should be detected
    if (result.trendRegime === 'strong_trend' && result.volatilityRegime !== 'crisis') {
      expect(result.strategyHint).toBe('trend_following')
    }
  })

  it('volRatio is positive', () => {
    const closes = generateCloses(100)
    const bars = closesToBars(closes)
    const result = detectRegime(closes, bars)

    expect(result.volRatio).toBeGreaterThan(0)
  })

  /**
   * Bug-fix regression: when ADX is unavailable (insufficient bars), the
   * function used to default trendRegime to 'range_bound' and then emit
   * 'mean_reversion' as the strategy hint based on no actual trend signal.
   * This was a fail-open recommendation. Now: strategyHint = 'neutral'
   * whenever adxValue is null.
   */
  describe('regression — fail-closed when ADX unavailable', () => {
    it('returns adxValue = null when bars are insufficient for ADX(14)', () => {
      const closes = generateCloses(8)
      const bars = closesToBars(closes)
      const result = detectRegime(closes, bars)
      expect(result.adxValue).toBeNull()
    })

    it('strategyHint = neutral when adxValue is null (was: mean_reversion)', () => {
      const closes = generateCloses(8)
      const bars = closesToBars(closes)
      const result = detectRegime(closes, bars)
      expect(result.adxValue).toBeNull()
      expect(result.strategyHint).toBe('neutral')
    })

    it('does NOT recommend mean_reversion just because vol is low + no ADX', () => {
      // 10 closes with very low vol — vol regime would be "low" or "normal",
      // but ADX is unavailable so no strategy hint should fire.
      const closes: number[] = []
      for (let i = 0; i < 10; i++) closes.push(100 + Math.sin(i) * 0.05)
      const bars = closesToBars(closes)
      const result = detectRegime(closes, bars)
      expect(result.adxValue).toBeNull()
      expect(result.strategyHint).not.toBe('mean_reversion')
      expect(result.strategyHint).not.toBe('trend_following')
    })

    /**
     * Second regression in the same family: confidence boost for
     * `trendRegime === 'range_bound'` (+10) used to fire even when
     * trendKnown was false (because the variable defaults to 'range_bound').
     * The "unknown trend" therefore got the same confidence boost as a
     * MEASURED range-bound regime. Now gated on trendKnown.
     */
    it('does NOT boost confidence for the default range_bound fallback', () => {
      // Insufficient bars → adxValue null. Volatility regime can't be
      // computed either (vol60 needs 62 bars). So confidence stays
      // ≤ 50 (base) — no trendKnown boost, no vol-normal boost.
      const closes = generateCloses(8)
      const bars = closesToBars(closes)
      const result = detectRegime(closes, bars)
      expect(result.adxValue).toBeNull()
      // Without trendKnown there must be no +10 boost from the
      // (falsely-default) range_bound regime. Base is 50.
      expect(result.confidence).toBeLessThanOrEqual(50)
    })
  })
})
