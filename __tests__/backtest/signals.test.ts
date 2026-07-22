import { describe, it, expect } from 'vitest'
import { regimeSignal, enhancedCombinedSignal, DEFAULT_CONFIG } from '@/lib/backtest/signals'
import { smaLatest } from '@/lib/quant/indicators'
import type { OhlcBar, OhlcvBar } from '@/lib/quant/indicators'

// Deterministic LCG (same constants as engine.equity.invariant.test.ts). Fixtures
// MUST NOT use Math.random(): a non-seeded fixture makes stryker-weekly mutation
// scores swing run-to-run (killed↔survived flips on identical commits) because the
// covering test's inputs change. Seed every pseudo-random fixture instead.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xFFFFFFFF
  }
}

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

/**
 * Q05 (program 2026-06-22): deterministic zone-boundary + invariant coverage.
 *
 * `regimeSignal(price, closes, rsi14?)` derives slope/near-SMA from `closes`
 * but the deviation zone from `price`, so we hold slope/near-SMA fixed via the
 * array and drive the zone exactly via the `price` argument:
 *   - `flat`   = 260 bars at 100 → SMA200 = 100, slope = 0 (NOT > 0.005) →
 *                slopePositive false → canBuyDip false (dips are not buyable).
 *   - `rising` = 260 bars at 100 + 0.1·i → SMA200 rising > 0.5% over 20 bars →
 *                slopePositive true + price recently near SMA → canBuyDip true.
 */
describe('Regime Signal — zone boundaries & invariants', () => {
  const flat = Array.from({ length: 260 }, () => 100)        // SMA200 = 100, slope 0
  const rising = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1) // rising SMA
  const sFlat = smaLatest(flat, 200)!
  const sRising = smaLatest(rising, 200)!

  it('flat series has zero (non-positive) slope → dips are not buyable', () => {
    const r = regimeSignal(sFlat * 0.95, flat)
    expect(r.slopePositive).toBe(false)
  })

  it('rising series has positive slope and recent near-SMA → dips buyable', () => {
    const r = regimeSignal(sRising * 0.97, rising)
    expect(r.slopePositive).toBe(true)
  })

  // ── Bull-zone thresholds (price above SMA200; canBuyDip irrelevant) ──
  it.each([
    [1.25, 'EXTREME_BULL', 40],
    [1.15, 'EXTENDED_BULL', 45],
    [1.05, 'HEALTHY_BULL', 55],
    [1.00, 'HEALTHY_BULL', 55], // dev exactly 0 → HEALTHY_BULL (>= 0)
  ] as const)('price %s× SMA200 → %s (HOLD, conf %d)', (mult, zone, conf) => {
    const r = regimeSignal(sFlat * mult, flat)
    expect(r.zone).toBe(zone)
    expect(r.action).toBe('HOLD')
    expect(r.confidence).toBe(conf)
    expect(r.deviationPct).toBeGreaterThanOrEqual(0)
  })

  // ── Dip zones with NON-positive slope → never BUY (HOLD or SELL knife) ──
  it('FIRST_DIP without positive slope → WATCH_DIP HOLD (not a falling knife)', () => {
    const r = regimeSignal(sFlat * 0.95, flat) // dev -5%
    expect(r.zone).toBe('FIRST_DIP')
    expect(r.dipSignal).toBe('WATCH_DIP')
    expect(r.action).toBe('HOLD')
    expect(r.confidence).toBe(35)
  })

  it.each([
    [0.85, 'DEEP_DIP', 82],
    [0.75, 'BEAR_ALERT', 90],
    [0.60, 'CRASH_ZONE', 95],
  ] as const)('price %s× SMA200, falling → %s FALLING_KNIFE SELL (conf %d)', (mult, zone, conf) => {
    const r = regimeSignal(sFlat * mult, flat)
    expect(r.zone).toBe(zone)
    expect(r.dipSignal).toBe('FALLING_KNIFE')
    expect(r.action).toBe('SELL')
    expect(r.confidence).toBe(conf)
    expect(r.deviationPct!).toBeLessThan(0)
  })

  // ── Dip zones WITH positive slope + near SMA → BUY (canBuyDip true) ──
  it.each([
    [0.97, 'FIRST_DIP', 75],
    [0.85, 'DEEP_DIP', 88],
    [0.75, 'BEAR_ALERT', 80],
    [0.60, 'CRASH_ZONE', 78],
  ] as const)('price %s× SMA200, uptrend → %s STRONG_DIP BUY (conf %d)', (mult, zone, conf) => {
    const r = regimeSignal(sRising * mult, rising)
    expect(r.zone).toBe(zone)
    expect(r.dipSignal).toBe('STRONG_DIP')
    expect(r.action).toBe('BUY')
    expect(r.confidence).toBe(conf)
    expect(r.slopePositive).toBe(true)
  })

  it('FIRST_DIP BUY confidence is boosted when RSI < 35', () => {
    expect(regimeSignal(sRising * 0.97, rising).confidence).toBe(75)
    expect(regimeSignal(sRising * 0.97, rising, 30).confidence).toBe(90)
    expect(regimeSignal(sRising * 0.97, rising, 50).confidence).toBe(75)
  })

  // ── Cross-cutting invariants (hold for every classification) ──
  it('invariants: BUY⇒slopePositive, SELL⟺FALLING_KNIFE, confidence∈[0,100]', () => {
    const cases = [
      ...[1.25, 1.15, 1.05, 1.0, 0.95, 0.85, 0.75, 0.6].map((m) => regimeSignal(sFlat * m, flat)),
      ...[0.97, 0.85, 0.75, 0.6].map((m) => regimeSignal(sRising * m, rising)),
    ]
    for (const r of cases) {
      expect(r.confidence).toBeGreaterThanOrEqual(0)
      expect(r.confidence).toBeLessThanOrEqual(100)
      if (r.action === 'BUY') expect(r.slopePositive).toBe(true)
      expect(r.action === 'SELL').toBe(r.dipSignal === 'FALLING_KNIFE')
    }
  })

  it('is a pure function — identical inputs yield identical output', () => {
    expect(regimeSignal(sRising * 0.97, rising, 30)).toEqual(regimeSignal(sRising * 0.97, rising, 30))
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
    const rng = makeRng(20260719)
    const base = Array.from({ length: 230 }, () => 100 + (rng() - 0.5) * 0.1)
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
    const rng = makeRng(20260720)
    const base = Array.from({ length: 230 }, () => 100 + (rng() - 0.5) * 0.1)
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

// ─── Q05-1 (2026-07-06): unknown 200SMA slope must fail closed, not SELL ─────
describe('Regime Signal — Q05-1 null-slope fail-closed', () => {
  it('unknown slope (200-220 bars) in a dip zone → HOLD, never FALLING_KNIFE SELL', () => {
    // 210 bars: sma200Slope() needs ≥ 221, so the slope is UNKNOWN here.
    const stable = Array.from({ length: 205 }, () => 100)
    const drop = [85, 83, 81, 79, 77]
    const closes = [...stable, ...drop] // length 210
    const price = closes[closes.length - 1] // ≈ -22.6% vs SMA200 → BEAR_ALERT zone
    const result = regimeSignal(price, closes)
    expect(result.slopePositive).toBeNull()
    expect(result.deviationPct).toBeLessThan(-10)
    expect(result.action).toBe('HOLD')
    expect(result.dipSignal).toBe('WATCH_DIP')
    expect(result.confidence).toBeLessThanOrEqual(20)
  })

  it('with ≥ 221 bars the same falling-knife shape still SELLs (behavior preserved)', () => {
    const stable = Array.from({ length: 230 }, () => 100)
    const drop = Array.from({ length: 25 }, (_, i) => 95 - i) // 95 → 71
    const closes = [...stable, ...drop] // length 255 — slope computable (negative)
    const price = closes[closes.length - 1]
    const result = regimeSignal(price, closes)
    expect(result.slopePositive).toBe(false) // known-negative, NOT null
    expect(result.deviationPct).toBeLessThan(-10)
    expect(result.action).toBe('SELL')
    expect(result.dipSignal).toBe('FALLING_KNIFE')
  })
})
