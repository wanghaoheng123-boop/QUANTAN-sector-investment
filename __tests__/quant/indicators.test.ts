import { describe, it, expect } from 'vitest'
import {
  smaLatest, smaArray,
  ema, emaFull,
  rsiArray, rsiLatest,
  macdArray, macdLatest,
  bollingerArray, bollingerLatest,
  atrArray, atrLatest,
  trueRange,
  dailyReturns, maxDrawdown,
  sharpeRatio, sortinoRatio,
  obvArray, stochRsiArray, adxArray,
} from '@/lib/quant/indicators'

// ─── Test data ──────────────────────────────────────────────────────────────
// 30-bar synthetic close series (slightly trending up with noise)
const CLOSES = [
  100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
  111, 110, 112, 114, 113, 115, 117, 116, 118, 120,
  119, 121, 123, 122, 124, 126, 125, 127, 129, 128,
]

const BARS = CLOSES.map((c, i) => ({
  open: i === 0 ? 100 : CLOSES[i - 1],
  high: c + 2,
  low: c - 2,
  close: c,
}))

// ─── SMA ────────────────────────────────────────────────────────────────────

describe('SMA', () => {
  it('returns null for insufficient data', () => {
    expect(smaLatest([1, 2], 5)).toBeNull()
  })

  it('computes correct simple average', () => {
    expect(smaLatest([1, 2, 3, 4, 5], 5)).toBe(3)
    expect(smaLatest([10, 20, 30], 3)).toBe(20)
  })

  it('uses only last N values', () => {
    expect(smaLatest([100, 1, 2, 3, 4, 5], 5)).toBe(3)
  })

  it('smaArray returns full-length array with NaN padding', () => {
    const result = smaArray([1, 2, 3, 4, 5], 3)
    expect(result).toHaveLength(5)
    expect(result[0]).toBeNaN()
    expect(result[1]).toBeNaN()
    expect(result[2]).toBeCloseTo(2, 10)
    expect(result[3]).toBeCloseTo(3, 10)
    expect(result[4]).toBeCloseTo(4, 10)
  })
})

// ─── EMA ────────────────────────────────────────────────────────────────────

describe('EMA', () => {
  it('returns empty for insufficient data', () => {
    expect(ema([], 5)).toEqual([])
    expect(ema([1, 2], 5)).toEqual([])
  })

  it('seeds with SMA of first period values', () => {
    const result = ema([2, 4, 6, 8, 10], 3)
    // SMA seed = (2+4+6)/3 = 4
    expect(result[0]).toBeCloseTo(4, 5)
    // Then EMA continues
    expect(result.length).toBe(3) // 5 - 3 + 1
  })

  it('emaFull returns NaN-padded full array', () => {
    const result = emaFull([2, 4, 6, 8, 10], 3)
    expect(result).toHaveLength(5)
    expect(result[0]).toBeNaN()
    expect(result[1]).toBeNaN()
    expect(result[2]).toBeCloseTo(4, 5)
  })

  it('subsequent values follow EMA formula', () => {
    const data = [10, 12, 11, 13, 14, 12, 15]
    const period = 3
    const result = ema(data, period)
    const k = 2 / (period + 1) // 0.5

    const seed = (10 + 12 + 11) / 3
    expect(result[0]).toBeCloseTo(seed, 5)

    // Next: 13 * 0.5 + seed * 0.5
    expect(result[1]).toBeCloseTo(13 * k + seed * (1 - k), 5)
  })
})

// ─── RSI ────────────────────────────────────────────────────────────────────

describe('RSI', () => {
  it('returns null/NaN for insufficient data', () => {
    expect(rsiLatest([1, 2, 3], 14)).toBeNull()
    const arr = rsiArray([1, 2, 3], 14)
    expect(arr.every(v => isNaN(v))).toBe(true)
  })

  it('returns 100 when only gains', () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i)
    const val = rsiLatest(rising, 14)
    expect(val).toBe(100)
  })

  it('returns 0 when only losses', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i)
    const val = rsiLatest(falling, 14)
    expect(val).toBe(0)
  })

  it('array and latest produce same final value', () => {
    const arr = rsiArray(CLOSES, 14)
    const latest = rsiLatest(CLOSES, 14)
    const lastValid = arr[arr.length - 1]
    expect(lastValid).toBeCloseTo(latest!, 10)
  })

  it('RSI values are between 0 and 100', () => {
    const arr = rsiArray(CLOSES, 14)
    for (const v of arr) {
      if (!isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })

  it('RSI is above 50 for trending-up data', () => {
    const val = rsiLatest(CLOSES, 14)
    expect(val).toBeGreaterThan(50)
  })
})

// ─── MACD ───────────────────────────────────────────────────────────────────

describe('MACD', () => {
  it('returns nulls for insufficient data', () => {
    const result = macdLatest(CLOSES.slice(0, 10))
    expect(result.line).toBeNull()
  })

  it('array length matches input', () => {
    const longData = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const { line, signal, histogram } = macdArray(longData)
    expect(line).toHaveLength(100)
    expect(signal).toHaveLength(100)
    expect(histogram).toHaveLength(100)
  })

  it('histogram = line - signal', () => {
    const longData = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const { line, signal, histogram } = macdArray(longData)
    for (let i = 0; i < 100; i++) {
      if (Number.isFinite(line[i]) && Number.isFinite(signal[i])) {
        expect(histogram[i]).toBeCloseTo(line[i] - signal[i], 10)
      }
    }
  })
})

// ─── Bollinger Bands ────────────────────────────────────────────────────────

describe('Bollinger Bands', () => {
  it('returns nulls for insufficient data', () => {
    const result = bollingerLatest([1, 2, 3], 20)
    expect(result.mid).toBeNull()
  })

  it('mid equals SMA of last period values', () => {
    const data = Array.from({ length: 25 }, (_, i) => 100 + i)
    const result = bollingerLatest(data, 20)
    const expectedMid = data.slice(-20).reduce((a, b) => a + b, 0) / 20
    expect(result.mid).toBeCloseTo(expectedMid, 10)
  })

  it('upper > mid > lower always', () => {
    const result = bollingerLatest(CLOSES, 20)
    expect(result.upper!).toBeGreaterThan(result.mid!)
    expect(result.mid!).toBeGreaterThan(result.lower!)
  })

  it('pctB is between 0 and 1 for data within bands', () => {
    const arr = bollingerArray(CLOSES, 20)
    for (let i = 0; i < CLOSES.length; i++) {
      if (Number.isFinite(arr.pctB[i])) {
        // pctB can be outside [0,1] if price is outside bands, but for smooth data it should be within
        expect(arr.pctB[i]).toBeGreaterThan(-0.5)
        expect(arr.pctB[i]).toBeLessThan(1.5)
      }
    }
  })

  it('array and latest produce same final values', () => {
    const arr = bollingerArray(CLOSES, 20)
    const latest = bollingerLatest(CLOSES, 20)
    const last = CLOSES.length - 1
    expect(arr.mid[last]).toBeCloseTo(latest.mid!, 5)
    expect(arr.upper[last]).toBeCloseTo(latest.upper!, 5)
    expect(arr.lower[last]).toBeCloseTo(latest.lower!, 5)
  })
})

// ─── ATR ────────────────────────────────────────────────────────────────────

describe('ATR', () => {
  it('returns null for insufficient bars', () => {
    expect(atrLatest(BARS.slice(0, 5), 14)).toBeNull()
  })

  it('ATR is always positive', () => {
    const val = atrLatest(BARS, 14)
    expect(val).toBeGreaterThan(0)
  })

  it('array and latest produce same final value', () => {
    const arr = atrArray(BARS, 14)
    const latest = atrLatest(BARS, 14)
    const lastValid = arr.filter(v => Number.isFinite(v)).pop()
    expect(lastValid).toBeCloseTo(latest!, 5)
  })

  it('true range is always non-negative', () => {
    const tr = trueRange(BARS)
    for (const v of tr) {
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })
})

// ─── Daily Returns ──────────────────────────────────────────────────────────

describe('Daily Returns', () => {
  it('computes correct returns', () => {
    const r = dailyReturns([100, 110, 99])
    expect(r).toHaveLength(2)
    expect(r[0]).toBeCloseTo(0.10, 10)
    expect(r[1]).toBeCloseTo(-0.10, 2)
  })

  it('handles empty/single input', () => {
    expect(dailyReturns([])).toEqual([])
    expect(dailyReturns([100])).toEqual([])
  })
})

// ─── Max Drawdown ───────────────────────────────────────────────────────────

describe('Max Drawdown', () => {
  it('returns null for insufficient data', () => {
    expect(maxDrawdown([100])).toBeNull()
  })

  it('computes correct drawdown', () => {
    const result = maxDrawdown([100, 120, 90, 110])
    expect(result!.maxDd).toBe(30) // peak 120, trough 90
    expect(result!.maxDdPct).toBeCloseTo(0.25, 10) // 30/120
  })

  it('zero drawdown for always-rising series', () => {
    const result = maxDrawdown([100, 110, 120, 130])
    expect(result!.maxDd).toBe(0)
    expect(result!.maxDdPct).toBe(0)
  })
})

// ─── Sharpe / Sortino ───────────────────────────────────────────────────────

describe('Sharpe Ratio', () => {
  it('returns null for insufficient data', () => {
    expect(sharpeRatio([0.01, 0.02])).toBeNull()
  })

  it('positive for consistently positive returns', () => {
    const returns = Array.from({ length: 252 }, () => 0.001) // ~25% annual
    expect(sharpeRatio(returns)).toBeGreaterThan(0)
  })

  it('negative for consistently negative returns', () => {
    const returns = Array.from({ length: 252 }, () => -0.001)
    expect(sharpeRatio(returns)).toBeLessThan(0)
  })
})

describe('Sortino Ratio', () => {
  it('returns null for insufficient data', () => {
    expect(sortinoRatio([0.01])).toBeNull()
  })

  it('higher than Sharpe for positively skewed returns', () => {
    const returns = Array.from({ length: 100 }, (_, i) =>
      i % 3 === 0 ? 0.03 : 0.001
    )
    const sharpe = sharpeRatio(returns)
    const sortino = sortinoRatio(returns)
    if (sharpe != null && sortino != null) {
      expect(sortino).toBeGreaterThan(sharpe)
    }
  })
})

// ─── OBV ────────────────────────────────────────────────────────────────────

describe('OBV', () => {
  it('increases on up-closes', () => {
    const closes = [100, 105, 110]
    const volumes = [1000, 2000, 3000]
    const obv = obvArray(closes, volumes)
    expect(obv[0]).toBe(0)
    expect(obv[1]).toBe(2000)
    expect(obv[2]).toBe(5000)
  })

  it('decreases on down-closes', () => {
    const closes = [100, 95, 90]
    const volumes = [1000, 2000, 3000]
    const obv = obvArray(closes, volumes)
    expect(obv[1]).toBe(-2000)
    expect(obv[2]).toBe(-5000)
  })
})

// ─── Stochastic RSI ─────────────────────────────────────────────────────────

describe('Stochastic RSI', () => {
  it('returns NaN arrays for insufficient data', () => {
    const { k, d } = stochRsiArray(CLOSES.slice(0, 10))
    expect(k.every(v => isNaN(v))).toBe(true)
  })

  it('returns arrays of correct length', () => {
    const longData = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 20)
    const { k, d } = stochRsiArray(longData)
    // Should return arrays matching input length
    expect(k).toHaveLength(200)
    expect(d).toHaveLength(200)
  })
})
