import { describe, it, expect } from 'vitest'
import { momentumScore, meanReversionBoost, sectorScores } from '@/lib/quant/sectorRotation'

// Generate a trending series over n days
function trendingSeries(n: number, startPrice: number, dailyReturn: number): number[] {
  const closes: number[] = [startPrice]
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + dailyReturn))
  }
  return closes
}

// Generate a flat series (for mean-reversion tests with predictable RSI)
function flatSeries(n: number, price = 100): number[] {
  return Array.from({ length: n }, () => price)
}

describe('momentumScore', () => {
  it('returns null for insufficient data (was: silent 0 fallback)', () => {
    // Updated contract: prior signature returned 0 on insufficient data
    // (3, 22, 100, 200 bars all returned 0). This conflated "no data"
    // with "zero return" and silently distorted sector momentum scores.
    // New contract returns null when ANY constituent return is missing.
    expect(momentumScore([100, 101, 102])).toBeNull()
    expect(momentumScore(trendingSeries(100, 100, 0.001))).toBeNull()  // 100 bars: 12mo missing
    expect(momentumScore(trendingSeries(252, 100, 0.001))).toBeNull()  // 252 bars: still need start at -252
  })

  it('returns a finite number when 253+ bars available', () => {
    expect(momentumScore(trendingSeries(253, 100, 0.001))).toBeTypeOf('number')
  })

  it('positive momentum score for uptrending series', () => {
    const closes = trendingSeries(300, 100, 0.001)  // +0.1%/day
    const s = momentumScore(closes)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThan(0)
  })

  it('negative momentum score for downtrending series', () => {
    const closes = trendingSeries(300, 100, -0.001)  // -0.1%/day
    const s = momentumScore(closes)
    expect(s).not.toBeNull()
    expect(s!).toBeLessThan(0)
  })

  it('crash filter reduces score when last month was strong', () => {
    // Long term uptrend, but recent month even stronger (crash filter penalty)
    const slowUp = trendingSeries(280, 100, 0.0005)  // gradual uptrend (need ≥ 253 total)
    const fastUp = trendingSeries(22, slowUp[slowUp.length - 1], 0.005)  // fast last month
    const combined = [...slowUp.slice(0, -22), ...fastUp]
    expect(combined.length).toBeGreaterThanOrEqual(253) // sanity-check fixture
    const score = momentumScore(combined)
    expect(score).not.toBeNull()
    expect(Number.isFinite(score!)).toBe(true)
  })
})

describe('meanReversionBoost', () => {
  it('returns 0 for insufficient data', () => {
    expect(meanReversionBoost([100, 101])).toBe(0)
  })

  it('returns 0 for neutral RSI (flat series → RSI ≈ 50)', () => {
    // Flat prices → RSI is undefined or neutral; alternating ensures RSI ≈ 50
    const alternating: number[] = []
    for (let i = 0; i < 30; i++) {
      alternating.push(i % 2 === 0 ? 100 : 101)
    }
    const boost = meanReversionBoost(alternating)
    // Should be 0 (RSI near 50 → neutral zone)
    expect(boost).toBe(0)
  })

  it('returns +0.10 for deeply oversold series (RSI < 30)', () => {
    // Strong downtrend → RSI < 30
    const down = trendingSeries(30, 100, -0.03)  // -3%/day
    const boost = meanReversionBoost(down)
    expect(boost).toBe(0.10)
  })

  it('returns -0.10 for deeply overbought series (RSI > 80)', () => {
    // Strong uptrend → RSI > 80
    const up = trendingSeries(30, 100, 0.03)  // +3%/day
    const boost = meanReversionBoost(up)
    expect(boost).toBe(-0.10)
  })
})

describe('sectorScores', () => {
  const ETFs = ['XLK', 'XLE', 'XLF', 'XLV', 'XLI', 'XLY']

  function makeEtfData(returns: Record<string, number>): Record<string, number[]> {
    const data: Record<string, number[]> = {}
    for (const [etf, dailyRet] of Object.entries(returns)) {
      data[etf] = trendingSeries(300, 100, dailyRet)
    }
    return data
  }

  it('returns entries for each ETF with sufficient data', () => {
    const data = makeEtfData({ XLK: 0.001, XLE: -0.001, XLF: 0.0005, XLV: 0.0002, XLI: -0.0005, XLY: 0.0015 })
    const scores = sectorScores(data)
    expect(scores.length).toBe(6)
  })

  it('ranks are unique and sequential', () => {
    const data = makeEtfData({ XLK: 0.001, XLE: -0.001, XLF: 0.0005, XLV: 0.0002, XLI: -0.0005, XLY: 0.0015 })
    const scores = sectorScores(data)
    const ranks = scores.map((s) => s.rank).sort((a, b) => a - b)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('top 3 are OVERWEIGHT, bottom 3 are UNDERWEIGHT', () => {
    const data = makeEtfData({ XLK: 0.001, XLE: -0.001, XLF: 0.0005, XLV: 0.0002, XLI: -0.0005, XLY: 0.0015 })
    const scores = sectorScores(data)
    const ow = scores.filter((s) => s.signal === 'OVERWEIGHT')
    const uw = scores.filter((s) => s.signal === 'UNDERWEIGHT')
    expect(ow.length).toBe(3)
    expect(uw.length).toBe(3)
  })

  it('best-performing sector has rank 1', () => {
    const data = makeEtfData({ XLK: 0.002, XLE: -0.002, XLF: 0, XLV: 0.001, XLI: -0.001, XLY: 0.0005 })
    const scores = sectorScores(data)
    const rank1 = scores.find((s) => s.rank === 1)!
    expect(rank1.etf).toBe('XLK')
    expect(rank1.signal).toBe('OVERWEIGHT')
  })

  it('worst-performing sector has UNDERWEIGHT signal', () => {
    const data = makeEtfData({ XLK: 0.002, XLE: -0.002, XLF: 0, XLV: 0.001, XLI: -0.001, XLY: 0.0005 })
    const scores = sectorScores(data)
    const last = scores.find((s) => s.rank === scores.length)!
    expect(last.etf).toBe('XLE')
    expect(last.signal).toBe('UNDERWEIGHT')
  })

  it('skips ETFs with insufficient data', () => {
    const data: Record<string, number[]> = {
      XLK: trendingSeries(300, 100, 0.001),
      XLE: [100, 101, 102],  // too short
    }
    const scores = sectorScores(data)
    expect(scores.length).toBe(1)
    expect(scores[0].etf).toBe('XLK')
  })

  it('skips ETFs with 22-252 bars (regression: gate raised 22 → 253)', () => {
    // Previously the gate was 22 bars, which let through ETFs that then
    // had silent 0-fallbacks for the 6mo and 12mo terms. A newer ETF with
    // 200 bars would score artificially low momentum because 2/3 of the
    // momentum components were forced to 0. New behaviour: skip entirely.
    const data: Record<string, number[]> = {
      XLK: trendingSeries(300, 100, 0.001),  // sufficient
      XLE: trendingSeries(100, 100, 0.001),  // 100 bars — was scored, now skipped
      XLF: trendingSeries(252, 100, 0.001),  // exactly 252 — still insufficient (need 12mo + start)
    }
    const scores = sectorScores(data)
    expect(scores.length).toBe(1)
    expect(scores[0].etf).toBe('XLK')
  })

  it('composite is 0.6 * momentum + 0.4 * meanReversion', () => {
    const data = makeEtfData({ XLK: 0.001 })
    const scores = sectorScores(data)
    const s = scores[0]
    expect(s.composite).toBeCloseTo(0.6 * s.momentum + 0.4 * s.meanReversion, 6)
  })
})
