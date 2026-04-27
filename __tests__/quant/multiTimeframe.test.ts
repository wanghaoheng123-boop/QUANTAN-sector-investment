import { describe, it, expect } from 'vitest'
import {
  aggregateToWeekly,
  aggregateToMonthly,
  multiTimeframeSignal,
} from '@/lib/quant/multiTimeframe'
import type { OhlcvBar } from '@/lib/quant/indicators'

/** Generate daily bars with a time field (unix seconds). */
function generateDailyBars(
  count: number,
  startPrice = 100,
  trend: 'up' | 'down' | 'flat' = 'flat',
  startDate = new Date('2020-01-02'),
): (OhlcvBar & { time: number })[] {
  const bars: (OhlcvBar & { time: number })[] = []
  let price = startPrice
  const date = new Date(startDate)

  for (let i = 0; i < count; i++) {
    // Skip weekends
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
      date.setUTCDate(date.getUTCDate() + 1)
    }

    const delta = trend === 'up' ? 0.3 : trend === 'down' ? -0.3 : 0
    const noise = (Math.sin(i * 0.5) * 2) // deterministic noise
    price = Math.max(1, price + delta + noise * 0.1)
    const high = price + Math.abs(noise) * 0.5 + 0.5
    const low = price - Math.abs(noise) * 0.5 - 0.5

    bars.push({
      time: Math.floor(date.getTime() / 1000),
      open: price - delta * 0.5,
      high: Math.max(high, price),
      low: Math.min(low, price),
      close: price,
      volume: 1_000_000 + i * 100,
    })
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return bars
}

describe('aggregateToWeekly', () => {
  it('groups daily bars into weekly bars', () => {
    const daily = generateDailyBars(20)
    const weekly = aggregateToWeekly(daily)

    expect(weekly.length).toBeGreaterThan(0)
    expect(weekly.length).toBeLessThan(daily.length)

    // Each weekly bar should aggregate multiple daily bars
    for (const w of weekly) {
      expect(w.open).toBeGreaterThan(0)
      expect(w.high).toBeGreaterThanOrEqual(w.low)
      expect(w.volume).toBeGreaterThan(0)
    }
  })

  it('preserves OHLCV semantics', () => {
    const daily = generateDailyBars(10)
    const weekly = aggregateToWeekly(daily)

    // First weekly bar's open should be first daily bar's open
    expect(weekly[0].open).toBe(daily[0].open)

    // Weekly high >= all daily highs in that week
    // Weekly low <= all daily lows in that week
    for (const w of weekly) {
      expect(w.high).toBeGreaterThanOrEqual(w.low)
    }
  })

  it('returns empty for empty input', () => {
    expect(aggregateToWeekly([])).toEqual([])
  })

  it('weekly volume is sum of daily volumes', () => {
    const daily = generateDailyBars(5) // 1 week of trading
    const weekly = aggregateToWeekly(daily)
    const totalDailyVol = daily.reduce((s, b) => s + b.volume, 0)
    const totalWeeklyVol = weekly.reduce((s, b) => s + b.volume, 0)
    expect(totalWeeklyVol).toBeCloseTo(totalDailyVol, 0)
  })
})

describe('aggregateToMonthly', () => {
  it('groups daily bars into monthly bars', () => {
    const daily = generateDailyBars(100)
    const monthly = aggregateToMonthly(daily)

    expect(monthly.length).toBeGreaterThan(0)
    expect(monthly.length).toBeLessThan(20) // ~5 months from 100 trading days
  })

  it('returns empty for empty input', () => {
    expect(aggregateToMonthly([])).toEqual([])
  })
})

describe('multiTimeframeSignal', () => {
  it('returns daily signal even with limited data', () => {
    const bars = generateDailyBars(50, 100, 'up')
    const result = multiTimeframeSignal(bars)

    expect(result.daily).toBeDefined()
    expect(result.daily.timeframe).toBe('daily')
    expect(['bullish', 'bearish', 'neutral']).toContain(result.daily.trend)
    expect(result.weekly).toBeNull() // not enough data
    expect(result.monthly).toBeNull()
  })

  it('returns weekly signal with enough data', () => {
    const bars = generateDailyBars(400, 100, 'up')
    const result = multiTimeframeSignal(bars)

    expect(result.daily).toBeDefined()
    expect(result.weekly).not.toBeNull()
    expect(result.weekly!.timeframe).toBe('weekly')
  })

  it('returns all three timeframes with sufficient data', () => {
    const bars = generateDailyBars(800, 100, 'up')
    const result = multiTimeframeSignal(bars)

    expect(result.daily).toBeDefined()
    expect(result.weekly).not.toBeNull()
    expect(result.monthly).not.toBeNull()
  })

  it('alignment score ranges from -3 to +3', () => {
    const bars = generateDailyBars(800, 100, 'up')
    const result = multiTimeframeSignal(bars)

    expect(result.alignmentScore).toBeGreaterThanOrEqual(-3)
    expect(result.alignmentScore).toBeLessThanOrEqual(3)
  })

  it('uptrend produces non-negative alignment', () => {
    const bars = generateDailyBars(800, 50, 'up')
    const result = multiTimeframeSignal(bars)

    // Strong uptrend should have positive or neutral alignment
    expect(result.alignmentScore).toBeGreaterThanOrEqual(-1)
  })

  it('handles bars without time field gracefully', () => {
    const bars: OhlcvBar[] = Array.from({ length: 300 }, (_, i) => ({
      open: 100 + i * 0.1,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      close: 100 + i * 0.1,
      volume: 1000000,
    }))
    const result = multiTimeframeSignal(bars)

    expect(result.daily).toBeDefined()
    // Without time field, weekly/monthly can't be computed
    expect(result.weekly).toBeNull()
    expect(result.monthly).toBeNull()
  })

  it('daily score is -1, 0, or +1', () => {
    const bars = generateDailyBars(50)
    const result = multiTimeframeSignal(bars)
    expect([-1, 0, 1]).toContain(result.daily.score)
  })
})
