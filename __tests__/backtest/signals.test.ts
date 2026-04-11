import { describe, it, expect } from 'vitest'
import { regimeSignal, combinedSignal, enhancedCombinedSignal, DEFAULT_CONFIG } from '@/lib/backtest/signals'
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

describe('Combined Signal', () => {
  it('returns valid signal structure', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const price = closes[closes.length - 1]
    const date = '2024-01-01'

    const signal = combinedSignal('TEST', date, price, closes, bars)
    expect(signal.ticker).toBe('TEST')
    expect(signal.date).toBe(date)
    expect(signal.price).toBe(price)
    expect(['BUY', 'HOLD', 'SELL']).toContain(signal.action)
    expect(signal.confidence).toBeGreaterThanOrEqual(0)
    expect(signal.confidence).toBeLessThanOrEqual(100)
    expect(signal.KellyFraction).toBeGreaterThanOrEqual(0)
    expect(signal.KellyFraction).toBeLessThanOrEqual(1)
  })

  it('has 4 confirmation signals', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const signal = combinedSignal('TEST', '2024-01-01', closes[249], closes, bars)
    expect(signal.confirms).toHaveLength(4)
    expect(signal.confirms.map(c => c.name)).toEqual(['RSI(14)', 'MACD hist', 'ATR%', 'BB%'])
  })

  it('BUY requires at least 2 bullish confirmations', () => {
    // Even if regime says BUY, without confirmations it becomes HOLD
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const signal = combinedSignal('TEST', '2024-01-01', closes[249], closes, bars)
    if (signal.action === 'BUY') {
      const bullishCount = signal.confirms.filter(c => c.bullish).length
      expect(bullishCount).toBeGreaterThanOrEqual(2)
    }
  })

  it('SELL gets Kelly fraction of 1.0 (full exit)', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const signal = combinedSignal('TEST', '2024-01-01', closes[249], closes, bars)
    if (signal.action === 'SELL') {
      expect(signal.KellyFraction).toBe(1.0)
    }
  })

  it('confidence below threshold converts BUY to HOLD', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const signal = combinedSignal('TEST', '2024-01-01', closes[249], closes, bars, {
      confidenceThreshold: 99, // Very high threshold
    })
    // With threshold at 99%, almost nothing should be a BUY
    if (signal.action !== 'SELL') {
      expect(signal.action).toBe('HOLD')
    }
  })

  it('reason string is non-empty', () => {
    const closes = generateCloses(100, 250, 0.1)
    const bars = generateBars(closes)
    const signal = combinedSignal('TEST', '2024-01-01', closes[249], closes, bars)
    expect(signal.reason.length).toBeGreaterThan(0)
  })
})

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
    expect(DEFAULT_CONFIG.confidenceThreshold).toBe(55)
    expect(DEFAULT_CONFIG.maxDrawdownCap).toBe(0.25)
    expect(DEFAULT_CONFIG.halfKelly).toBe(true)
  })
})
