import { describe, it, expect } from 'vitest'
import { regimeSignal, enhancedCombinedSignal, DEFAULT_CONFIG } from '@/lib/backtest/signals'
import type { OhlcBar, OhlcvBar } from '@/lib/quant/indicators'

// Generate synthetic close series for regime testing
function generateCloses(basePrice: number, count: number, trend: number = 0): number[] {
  return Array.from({ length: count }, (_, i) => basePrice + trend * i + (Math.sin(i * 0.3) * 2))
}

function generateBars(closes: number[]): OhlcBar[] {
  return closes.map((c, i) => ({
    open: i === 0 ? c : closes[i - 1],
    high: c + 2,
    low: c - 2,
    close: c,
  }))
}

function generateOhlcvBars(closes: number[], startDate = new Date('2020-01-02')): (OhlcvBar & { time: number })[] {
  const date = new Date(startDate)
  return closes.map((c, i) => {
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1)
    const time = Math.floor(date.getTime() / 1000)
    date.setUTCDate(date.getUTCDate() + 1)
    return {
      open: i === 0 ? c : closes[i - 1],
      high: c + 2,
      low: c - 2,
      close: c,
      volume: 1_000_000 + Math.sin(i) * 100_000,
      time,
    }
  })
}

describe('Regime Signal', () => {
  it('returns INSUFFICIENT_DATA for < 200 bars', () => {
    const closes = generateCloses(100, 100)
    const result = regimeSignal(100, closes)
    expect(result.zone).toBe('INSUFFICIENT_DATA')
    expect(result.action).toBe('HOLD')
    expect(result.confidence).toBe(0)
  })

  /**
   * Regression: prior implementation silently classified non-finite prices
   * as CRASH_ZONE BUY/SELL (78-95% confidence). Bad inputs must fail
   * closed to HOLD with confidence=0, never emit real trading actions.
   */
  it('returns HOLD/0-confidence for non-finite price (fail-closed)', () => {
    const closes = generateCloses(100, 250, 0.1) // sufficient bars
    const nan = regimeSignal(NaN, closes)
    expect(nan.action).toBe('HOLD')
    expect(nan.confidence).toBe(0)
    expect(nan.deviationPct).toBeNull()
    const inf = regimeSignal(Infinity, closes)
    expect(inf.action).toBe('HOLD')
    expect(inf.confidence).toBe(0)
  })

  it('returns HOLD/0-confidence for non-positive price (fail-closed)', () => {
    const closes = generateCloses(100, 250, 0.1)
    const zero = regimeSignal(0, closes)
    expect(zero.action).toBe('HOLD')
    expect(zero.confidence).toBe(0)
    const neg = regimeSignal(-50, closes)
    expect(neg.action).toBe('HOLD')
    expect(neg.confidence).toBe(0)
  })

  it('classifies HEALTHY_BULL when price is 0-10% above SMA200', () => {
    // Create 250 bars with gentle uptrend so SMA200 is below current price
    const closes = generateCloses(100, 250, 0.1)
    const price = closes[closes.length - 1]
    const result = regimeSignal(price, closes)
    // Price should be moderately above SMA200 due to uptrend
    expect(['HEALTHY_BULL', 'EXTENDED_BULL', 'EXTREME_BULL']).toContain(result.zone)
    expect(result.deviationPct).not.toBeNull()
  })

  it('classifies FIRST_DIP when price is 0-10% below SMA200', () => {
    // Create 250 bars of stable price, then drop
    const stable = Array.from({ length: 230 }, () => 100)
    const drop = Array.from({ length: 20 }, (_, i) => 100 - (i * 0.3))
    const closes = [...stable, ...drop]
    const price = closes[closes.length - 1]
    const result = regimeSignal(price, closes)
    expect(result.deviationPct).not.toBeNull()
    if (result.deviationPct! >= -10 && result.deviationPct! < 0) {
      expect(result.zone).toBe('FIRST_DIP')
    }
  })

  it('SELL signals have high confidence in falling knife scenario', () => {
    // Steady decline creating negative slope + deep deviation
    const closes = generateCloses(150, 250, -0.2)
    const price = closes[closes.length - 1]
    const result = regimeSignal(price, closes)
    if (result.dipSignal === 'FALLING_KNIFE') {
      expect(result.action).toBe('SELL')
      expect(result.confidence).toBeGreaterThan(70)
    }
  })

  it('deviationPct is positive when price > SMA200', () => {
    const closes = generateCloses(100, 250, 0.15)
    const price = closes[closes.length - 1]
    const result = regimeSignal(price, closes)
    expect(result.deviationPct).toBeGreaterThan(0)
  })
})

// Phase 13 S2 fix (F1.10): the legacy `combinedSignal` (4-confirmation
// bullishCount-based) was deleted in favour of the canonical
// `enhancedCombinedSignal` (7-factor weighted confluence). Its tests are
// removed here as well — the equivalent assertions are covered by the
// "Enhanced Combined Signal" block below.

describe('Enhanced Combined Signal', () => {
  it('returns valid enhanced signal structure', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const price = closes[closes.length - 1]

    const signal = enhancedCombinedSignal('TEST', '2024-01-01', price, closes, bars, ohlcvBars)
    expect(signal.ticker).toBe('TEST')
    expect(['BUY', 'HOLD', 'SELL']).toContain(signal.action)
    expect(signal.confidence).toBeGreaterThanOrEqual(0)
    expect(signal.confidence).toBeLessThanOrEqual(100)
    expect(signal.totalWeightedScore).toBeDefined()
    expect(signal.volRegime).toBeDefined()
    expect(signal.multiTfScore).toBeDefined()
  })

  it('has 7 weighted confirmation signals', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const signal = enhancedCombinedSignal('TEST', '2024-01-01', closes[249], closes, bars, ohlcvBars)

    expect(signal.weightedConfirms).toHaveLength(7)
    expect(signal.weightedConfirms.map(c => c.name)).toEqual([
      'RSI(14)', 'MACD hist', 'ATR%', 'BB%', 'Vol POC', 'Multi-TF', 'Vol Regime',
    ])
  })

  it('weighted scores are in valid range', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const signal = enhancedCombinedSignal('TEST', '2024-01-01', closes[249], closes, bars, ohlcvBars)

    for (const c of signal.weightedConfirms) {
      expect(c.score).toBeGreaterThanOrEqual(-1)
      expect(c.score).toBeLessThanOrEqual(1)
      expect(c.weight).toBeGreaterThan(0)
      expect(c.weight).toBeLessThanOrEqual(1)
    }
  })

  it('weights sum to approximately 1.0', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const signal = enhancedCombinedSignal('TEST', '2024-01-01', closes[249], closes, bars, ohlcvBars)

    const totalWeight = signal.weightedConfirms.reduce((s, c) => s + c.weight, 0)
    expect(totalWeight).toBeCloseTo(1.0, 5)
  })

  it('totalWeightedScore matches sum of individual weighted scores', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const signal = enhancedCombinedSignal('TEST', '2024-01-01', closes[249], closes, bars, ohlcvBars)

    const manualSum = signal.weightedConfirms.reduce((s, c) => s + c.weightedScore, 0)
    expect(signal.totalWeightedScore).toBeCloseTo(manualSum, 10)
  })

  it('vol regime has valid structure', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const signal = enhancedCombinedSignal('TEST', '2024-01-01', closes[249], closes, bars, ohlcvBars)

    expect(['low', 'normal', 'high', 'crisis']).toContain(signal.volRegime.volatilityRegime)
    expect(['strong_trend', 'weak_trend', 'range_bound']).toContain(signal.volRegime.trendRegime)
    expect(['trend_following', 'mean_reversion', 'neutral']).toContain(signal.volRegime.strategyHint)
  })

  it('SELL gets Kelly fraction of 1.0', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const signal = enhancedCombinedSignal('TEST', '2024-01-01', closes[249], closes, bars, ohlcvBars)
    if (signal.action === 'SELL') {
      expect(signal.KellyFraction).toBe(1.0)
    }
  })

  it('backward-compatible confirms array matches weighted confirms', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const signal = enhancedCombinedSignal('TEST', '2024-01-01', closes[249], closes, bars, ohlcvBars)

    expect(signal.confirms).toHaveLength(7)
    for (let i = 0; i < 7; i++) {
      expect(signal.confirms[i].name).toBe(signal.weightedConfirms[i].name)
    }
  })
})

describe('DEFAULT_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_CONFIG.initialCapital).toBe(100_000)
    expect(DEFAULT_CONFIG.confidenceThreshold).toBe(50)
    expect(DEFAULT_CONFIG.maxDrawdownCap).toBe(0.25)
    expect(DEFAULT_CONFIG.halfKelly).toBe(true)
  })
})

/**
 * Phase 13 S2 — TEAM AUDIT regression suite for `enhancedCombinedSignal`.
 *
 * Q (Quant) + A (AI) + F (Full-stack) cross-validated finding:
 *   Per-indicator scores must lie in [-1, +1] so that the weighted sum
 *   Σ wᵢ · sᵢ is bounded in [-1, +1] (since Σ wᵢ = 1). Without the bound,
 *   a single overshoot can dominate the ensemble and silently flip the
 *   decision. Kuncheva (2014) §4.2 — weighted-combination ensemble
 *   bounds require homogeneous base-learner output ranges.
 *
 * These tests pin the bound property by constructing synthetic price
 * series that drive Bollinger pctB outside [0, 1] (price overshoots
 * the upper / lower band) and verifying every weightedConfirm score
 * stays within the contract.
 */
describe('enhancedCombinedSignal — TEAM AUDIT: per-indicator score bounds', () => {
  it('all weightedConfirm scores remain in [-1, +1] under typical market', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const sig = enhancedCombinedSignal('TEST', '2026-01-01', closes[closes.length - 1], closes, bars, ohlcvBars)
    for (const c of sig.weightedConfirms) {
      expect(c.score).toBeGreaterThanOrEqual(-1)
      expect(c.score).toBeLessThanOrEqual(1)
    }
  })

  it('all weightedConfirm scores remain in [-1, +1] under a Bollinger UPPER overshoot', () => {
    // Build a series with a sharp recent rally so pctB exceeds 1.0.
    // The rally needs to be large enough to push price meaningfully above
    // the 20-period mean + 2σ band, which requires ~5-10% above the mean
    // on a tight prior series.
    const base = Array.from({ length: 230 }, () => 100 + (Math.random() - 0.5) * 0.1)
    // Sharp last 20 bars: vertical ramp.
    const rally = Array.from({ length: 20 }, (_, i) => 100 + (i + 1) * 1.5)
    const closes = [...base, ...rally]
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const sig = enhancedCombinedSignal('TEST', '2026-01-01', closes[closes.length - 1], closes, bars, ohlcvBars)
    for (const c of sig.weightedConfirms) {
      expect(c.score).toBeGreaterThanOrEqual(-1)
      expect(c.score).toBeLessThanOrEqual(1)
      // weightedScore = weight × score; with weight ≤ 0.25, |weightedScore| ≤ 0.25
      expect(Math.abs(c.weightedScore)).toBeLessThanOrEqual(0.30)
    }
  })

  it('all weightedConfirm scores remain in [-1, +1] under a Bollinger LOWER overshoot', () => {
    // Sharp recent decline so pctB drops below 0.
    const base = Array.from({ length: 230 }, () => 100 + (Math.random() - 0.5) * 0.1)
    const crash = Array.from({ length: 20 }, (_, i) => 100 - (i + 1) * 1.5)
    const closes = [...base, ...crash]
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const sig = enhancedCombinedSignal('TEST', '2026-01-01', closes[closes.length - 1], closes, bars, ohlcvBars)
    for (const c of sig.weightedConfirms) {
      expect(c.score).toBeGreaterThanOrEqual(-1)
      expect(c.score).toBeLessThanOrEqual(1)
      expect(Math.abs(c.weightedScore)).toBeLessThanOrEqual(0.30)
    }
  })

  it('totalWeightedScore base (pre-bonus) is bounded by Σ |wᵢ| = 1', () => {
    // With unclamped scores a single indicator's weighted contribution
    // could push the SUM outside [-1, +1]. With the clamp, even adversarial
    // inputs must respect the bound.
    const closes = Array.from({ length: 250 }, (_, i) => 100 + Math.sin(i * 0.1) * 50)
    const bars = generateBars(closes)
    const ohlcvBars = generateOhlcvBars(closes)
    const sig = enhancedCombinedSignal('TEST', '2026-01-01', closes[closes.length - 1], closes, bars, ohlcvBars)
    // Reconstruct the pre-bonus sum from individual weighted contributions.
    const baseSum = sig.weightedConfirms.reduce((s, c) => s + c.weightedScore, 0)
    expect(baseSum).toBeGreaterThanOrEqual(-1)
    expect(baseSum).toBeLessThanOrEqual(1)
  })
})
