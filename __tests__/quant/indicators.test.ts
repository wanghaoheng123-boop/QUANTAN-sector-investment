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
  wilderSmoothing,
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
  it('returns null for insufficient data (< 30 returns)', () => {
    expect(sortinoRatio([0.01])).toBeNull()
    expect(sortinoRatio(Array.from({ length: 29 }, () => 0.001))).toBeNull()
  })

  it('returns null when negative-deviation count < 30', () => {
    // 100 returns, only 5 negative — n_d = 5 < 30 → null
    const returns = Array.from({ length: 100 }, (_, i) =>
      i < 5 ? -0.01 : 0.01
    )
    expect(sortinoRatio(returns, 0)).toBeNull()
  })

  it('higher than Sharpe for positively skewed returns', () => {
    // 100 returns: 40 negative (n_d threshold met)
    const returns = Array.from({ length: 100 }, (_, i) =>
      i % 5 < 3 ? 0.02 : -0.01
    )
    const sharpe = sharpeRatio(returns)
    const sortino = sortinoRatio(returns)
    expect(sharpe).not.toBeNull()
    expect(sortino).not.toBeNull()
    if (sharpe != null && sortino != null) {
      expect(sortino).toBeGreaterThan(sharpe)
    }
  })

  // F2.1 / F1.16 acceptance test: canonical n_d denominator (Sortino & van der
  // Meer 1991), not N-1.  Hand-computed value below should hold.
  it('uses n_d (negative-period count) denominator, not N', () => {
    // 30 returns of -0.01 + 70 returns of +0.005, MAR = 0:
    //   n = 100, n_d = 30
    //   sum(min(0,r)^2) = 30 * 1e-4 = 3e-3
    //   downsideVariance = 3e-3 / 30 = 1e-4 → dsd = 0.01
    //   mean = (-0.30 + 0.35) / 100 = 0.0005
    //   sortino = 0.0005 / 0.01 * sqrt(252) = 0.05 * sqrt(252) ≈ 0.7937
    const returns = [
      ...Array.from({ length: 30 }, () => -0.01),
      ...Array.from({ length: 70 }, () => 0.005),
    ]
    const sortino = sortinoRatio(returns, 0)
    expect(sortino).not.toBeNull()
    if (sortino != null) {
      expect(sortino).toBeCloseTo(0.05 * Math.sqrt(252), 4)
      // If denom were (N-1)=99 (the old bug), sortino ≈ 1.443. We must NOT match.
      expect(Math.abs(sortino - 1.443)).toBeGreaterThan(0.5)
    }
  })

  it('respects custom MAR — higher MAR shrinks excess and Sortino', () => {
    // 100 returns: 40 negative (-0.005), 60 positive (+0.005)
    const returns = [
      ...Array.from({ length: 40 }, () => -0.005),
      ...Array.from({ length: 60 }, () => 0.005),
    ]
    const sortinoMar0 = sortinoRatio(returns, 0)
    const sortinoMarPos = sortinoRatio(returns, 0.001)
    expect(sortinoMar0).not.toBeNull()
    expect(sortinoMarPos).not.toBeNull()
    if (sortinoMar0 != null && sortinoMarPos != null) {
      expect(sortinoMarPos).toBeLessThan(sortinoMar0)
    }
  })

  it('respects custom annualization (365 for crypto vs 252 for equities)', () => {
    const returns = [
      ...Array.from({ length: 40 }, () => -0.001),
      ...Array.from({ length: 60 }, () => 0.002),
    ]
    const sortino252 = sortinoRatio(returns, 0, 252)
    const sortino365 = sortinoRatio(returns, 0, 365)
    expect(sortino252).not.toBeNull()
    expect(sortino365).not.toBeNull()
    if (sortino252 != null && sortino365 != null) {
      expect(sortino365 / sortino252).toBeCloseTo(Math.sqrt(365 / 252), 3)
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

  it('emits FINITE k/d after warmup under BOTH smoothings (2026-07-16 regression)', () => {
    // Regression: emaFull seeded its EMA from the NaN warmup prefix, so the
    // default-EMA StochRSI returned ALL-NaN k/d for every input — the length
    // check above sailed right past it.
    const longData = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 20)
    for (const smoothing of ['ema', 'sma'] as const) {
      const { k, d } = stochRsiArray(longData, 14, 3, 3, smoothing)
      const finiteK = k.filter(Number.isFinite)
      const finiteD = d.filter(Number.isFinite)
      expect(finiteK.length).toBeGreaterThan(150)
      expect(finiteD.length).toBeGreaterThan(150)
      // StochRSI is bounded in [0, 100]
      // FP epsilon: SMA/EMA round-off can land ~1e-15 outside [0, 100]
      finiteK.forEach((v) => { expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(100 + 1e-9) })
      expect(Number.isFinite(k[k.length - 1])).toBe(true)
      expect(Number.isFinite(d[d.length - 1])).toBe(true)
    }
  })
})

// ─── Wilder smoothing (Phase 13 S2 — F2.2) ──────────────────────────────────

describe('Wilder smoothing', () => {
  it('returns NaN-padded array of input length', () => {
    const out = wilderSmoothing([1, 2, 3, 4, 5], 3)
    expect(out).toHaveLength(5)
    expect(isNaN(out[0])).toBe(true)
    expect(isNaN(out[1])).toBe(true)
    expect(out[2]).toBe(2) // SMA seed of [1,2,3]
  })

  it('seeds at index period-1 with the SMA of the first period values', () => {
    const out = wilderSmoothing([10, 20, 30, 40, 50], 3)
    expect(out[2]).toBe(20) // (10+20+30)/3 = 20
  })

  it('uses recursive Wilder formula: prev + (current - prev)/period', () => {
    // [1,2,3,4,5,6,7], period=3
    // out[2] = 2 (seed)
    // out[3] = 2 + (4-2)/3 = 2.666...
    // out[4] = 2.666 + (5-2.666)/3 = 3.444...
    const out = wilderSmoothing([1, 2, 3, 4, 5, 6, 7], 3)
    expect(out[2]).toBeCloseTo(2, 6)
    expect(out[3]).toBeCloseTo(2.666666, 4)
    expect(out[4]).toBeCloseTo(3.444444, 4)
  })

  it('produces values that lag a standard EMA on a step input', () => {
    // Step from 0 to 100 at index 5; both seed at index 2 (period=3).
    // Wilder smoothing has alpha=1/3 ≈ 0.333; standard EMA span=3 alpha=2/4=0.5.
    // After the step, the EMA should track the new value faster than Wilder.
    const input = [0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100, 100]
    const wilder = wilderSmoothing(input, 3)
    const ema = emaFull(input, 3)
    // After several bars, EMA should be closer to 100 than Wilder.
    expect(ema[ema.length - 1]).toBeGreaterThan(wilder[wilder.length - 1])
  })

  it('returns full-NaN array on insufficient data', () => {
    const out = wilderSmoothing([1, 2], 5)
    expect(out.every((x) => isNaN(x))).toBe(true)
  })

  it('rejects period <= 0 with full-NaN array', () => {
    const out = wilderSmoothing([1, 2, 3, 4, 5], 0)
    expect(out.every((x) => isNaN(x))).toBe(true)
  })
})

// ─── ADX (Phase 13 S2 — F2.2: Wilder smoothing) ─────────────────────────────

describe('ADX with Wilder smoothing', () => {
  it('returns NaN arrays for insufficient data', () => {
    const bars = BARS.slice(0, 10)
    const { adx, plusDI, minusDI } = adxArray(bars, 14)
    // First valid ADX value is at index 2*period (after DM smoothing + DX smoothing)
    // For 10 bars, all should be NaN
    expect(adx.every((v) => isNaN(v))).toBe(true)
    expect(plusDI.every((v) => isNaN(v))).toBe(true)
    expect(minusDI.every((v) => isNaN(v))).toBe(true)
  })

  it('produces +DI > -DI on a strong uptrend', () => {
    // Linear uptrend: high keeps rising, low keeps rising slower.
    const bars = Array.from({ length: 60 }, (_, i) => ({
      open: 100 + i,
      high: 100 + i + 2,
      low: 100 + i - 1,
      close: 100 + i + 1,
    }))
    const { plusDI, minusDI } = adxArray(bars, 14)
    const last = bars.length - 1
    expect(plusDI[last]).toBeGreaterThan(minusDI[last])
  })

  it('produces -DI > +DI on a strong downtrend', () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({
      open: 200 - i,
      high: 200 - i + 1,
      low: 200 - i - 2,
      close: 200 - i - 1,
    }))
    const { plusDI, minusDI } = adxArray(bars, 14)
    const last = bars.length - 1
    expect(minusDI[last]).toBeGreaterThan(plusDI[last])
  })

  it('returns ADX in plausible 0-100 range on trending input', () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      open: 100 + i * 0.5,
      high: 100 + i * 0.5 + 1.5,
      low: 100 + i * 0.5 - 0.5,
      close: 100 + i * 0.5 + 0.5,
    }))
    const { adx } = adxArray(bars, 14)
    const validAdx = adx.filter((v) => Number.isFinite(v))
    expect(validAdx.length).toBeGreaterThan(0)
    for (const v of validAdx) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })
})
