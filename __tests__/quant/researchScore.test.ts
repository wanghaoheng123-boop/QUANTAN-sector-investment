import { describe, it, expect } from 'vitest'
import { computeResearchScore, bandPosition, rsiScoreDelta } from '@/lib/quant/researchScore'
import type { ResearchScoreInput } from '@/lib/quant/researchScore'

const neutralInput: ResearchScoreInput = {
  trailingPE: null,
  forwardPE: null,
  debtToEquity: null,
  returnOnEquity: null,
  profitMargin: null,
  rsi14: null,
  trendScore: null,
  pctB: null,
  excessVsSpy60d: null,
  bandPosition: null,
}

describe('Research Score', () => {
  it('returns total between 0 and 100', () => {
    const result = computeResearchScore(neutralInput)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
  })

  it('all neutral inputs produce score near 50', () => {
    const result = computeResearchScore(neutralInput)
    expect(result.total).toBeGreaterThan(40)
    expect(result.total).toBeLessThan(60)
  })

  it('returns exactly 5 pillars', () => {
    const result = computeResearchScore(neutralInput)
    expect(result.pillars).toHaveLength(5)
  })

  it('each pillar score is between 0 and 100', () => {
    const inputs: ResearchScoreInput[] = [
      neutralInput,
      { ...neutralInput, forwardPE: 5, returnOnEquity: 0.30, rsi14: 20, excessVsSpy60d: 0.15, bandPosition: 0.1 },
      { ...neutralInput, forwardPE: 50, returnOnEquity: -0.1, rsi14: 85, excessVsSpy60d: -0.20, bandPosition: 0.9 },
    ]
    for (const input of inputs) {
      const result = computeResearchScore(input)
      for (const p of result.pillars) {
        expect(p.score).toBeGreaterThanOrEqual(0)
        expect(p.score).toBeLessThanOrEqual(100)
      }
    }
  })

  it('weights description is provided', () => {
    const result = computeResearchScore(neutralInput)
    expect(result.weights).toContain('20%')
    expect(result.weights).toContain('25%')
    expect(result.weights).toContain('15%')
  })

  it('low PE gives higher value score', () => {
    const lowPE = computeResearchScore({ ...neutralInput, forwardPE: 8 })
    const highPE = computeResearchScore({ ...neutralInput, forwardPE: 35 })
    const valueLow = lowPE.pillars[0].score
    const valueHigh = highPE.pillars[0].score
    expect(valueLow).toBeGreaterThan(valueHigh)
  })

  it('strong ROE and low leverage boost quality', () => {
    const strong = computeResearchScore({
      ...neutralInput,
      returnOnEquity: 0.25,
      debtToEquity: 0.3,
      profitMargin: 0.25,
    })
    const weak = computeResearchScore({
      ...neutralInput,
      returnOnEquity: -0.05,
      debtToEquity: 3.0,
      profitMargin: 0.05,
    })
    expect(strong.pillars[1].score).toBeGreaterThan(weak.pillars[1].score)
  })

  it('oversold RSI boosts momentum', () => {
    const oversold = computeResearchScore({ ...neutralInput, rsi14: 25 })
    const overbought = computeResearchScore({ ...neutralInput, rsi14: 75 })
    expect(oversold.pillars[2].score).toBeGreaterThan(overbought.pillars[2].score)
  })

  it('positive relative strength boosts RS pillar', () => {
    const outperform = computeResearchScore({ ...neutralInput, excessVsSpy60d: 0.10 })
    const underperform = computeResearchScore({ ...neutralInput, excessVsSpy60d: -0.10 })
    expect(outperform.pillars[3].score).toBeGreaterThan(underperform.pillars[3].score)
  })

  it('bullish composite gives high total score', () => {
    const bullish = computeResearchScore({
      trailingPE: 10,
      forwardPE: 8,
      debtToEquity: 0.3,
      returnOnEquity: 0.25,
      profitMargin: 0.25,
      rsi14: 28,
      trendScore: 1,
      pctB: 0.10,
      excessVsSpy60d: 0.12,
      bandPosition: 0.15,
    })
    expect(bullish.total).toBeGreaterThan(70)
  })

  it('bearish composite gives low total score', () => {
    const bearish = computeResearchScore({
      trailingPE: 45,
      forwardPE: 40,
      debtToEquity: 3.0,
      returnOnEquity: -0.05,
      profitMargin: 0.02,
      rsi14: 78,
      trendScore: -1,
      pctB: 0.90,
      excessVsSpy60d: -0.15,
      bandPosition: 0.90,
    })
    expect(bearish.total).toBeLessThan(35)
  })
})

describe('Band Position', () => {
  it('returns 0.15 when price <= buyHigh', () => {
    expect(bandPosition(90, 100, 150, 125)).toBe(0.15)
  })

  it('returns 0.85 when price >= sellLow', () => {
    expect(bandPosition(160, 100, 150, 125)).toBe(0.85)
  })

  it('returns value between 0 and 1 for mid-range price', () => {
    const pos = bandPosition(125, 100, 150, 125)!
    expect(pos).toBeGreaterThan(0)
    expect(pos).toBeLessThan(1)
  })

  it('returns null for invalid inputs', () => {
    expect(bandPosition(100, null, 150, 125)).toBeNull()
    expect(bandPosition(0, 100, 150, 125)).toBeNull()
  })

  it('mid-band linear interpolation: at midpoint of band, position = 0.5', () => {
    // buyHigh=100, sellLow=200 → midpoint=150 → position = (150-100)/(200-100) = 0.5
    expect(bandPosition(150, 100, 200, 175)).toBe(0.5)
  })

  it('mid-band linear interpolation: 25% into the band', () => {
    // buyHigh=100, sellLow=200 → 25% in = 125 → position = 0.25
    expect(bandPosition(125, 100, 200, 150)).toBe(0.25)
  })

  it('returns null for inverted band (buyHigh > sellLow malformed input)', () => {
    // Previously: silently returned a negative-denominator result via the
    // dead `sellLow === buyHigh` branch. Now correctly refused.
    expect(bandPosition(140, 150, 100, 125)).toBeNull()
  })

  it('handles edge case price === buyHigh (clamps to 0.15)', () => {
    expect(bandPosition(100, 100, 200, 150)).toBe(0.15)
  })

  it('handles edge case price === sellLow (clamps to 0.85)', () => {
    expect(bandPosition(200, 100, 200, 150)).toBe(0.85)
  })
})

describe('rsiScoreDelta (F1.11 piecewise-linear)', () => {
  it('returns 0 in the neutral 30..70 band', () => {
    expect(rsiScoreDelta(30).delta).toBe(0)
    expect(rsiScoreDelta(50).delta).toBe(0)
    expect(rsiScoreDelta(70).delta).toBe(0)
  })

  it('caps positive delta at +15 when RSI = 0 (extreme oversold)', () => {
    expect(rsiScoreDelta(0).delta).toBeCloseTo(15, 6)
  })

  it('caps negative delta at -10 when RSI = 100 (extreme overbought)', () => {
    expect(rsiScoreDelta(100).delta).toBeCloseTo(-10, 6)
  })

  it('linearly interpolates in the oversold band: RSI=15 → +7.5', () => {
    expect(rsiScoreDelta(15).delta).toBeCloseTo(7.5, 6)
  })

  it('linearly interpolates in the overbought band: RSI=85 → -5', () => {
    expect(rsiScoreDelta(85).delta).toBeCloseTo(-5, 6)
  })

  it('is continuous at thresholds (no step at RSI=30)', () => {
    const d29 = rsiScoreDelta(29).delta
    const d30 = rsiScoreDelta(30).delta
    const d31 = rsiScoreDelta(31).delta
    // Old step: d30 = +15, d31 = 0 (15-pt jump). New: smooth across boundary.
    expect(Math.abs(d30 - d31)).toBeLessThan(1)
    expect(Math.abs(d29 - d30)).toBeLessThan(1)
  })

  it('is continuous at thresholds (no step at RSI=70)', () => {
    const d69 = rsiScoreDelta(69).delta
    const d70 = rsiScoreDelta(70).delta
    const d71 = rsiScoreDelta(71).delta
    expect(Math.abs(d70 - d71)).toBeLessThan(1)
    expect(Math.abs(d69 - d70)).toBeLessThan(1)
  })

  it('is monotonically non-increasing in RSI', () => {
    let prev = rsiScoreDelta(0).delta
    for (let r = 1; r <= 100; r++) {
      const cur = rsiScoreDelta(r).delta
      expect(cur).toBeLessThanOrEqual(prev + 1e-9)
      prev = cur
    }
  })

  it('clamps RSI inputs out of [0,100] range', () => {
    expect(rsiScoreDelta(-5).delta).toBeCloseTo(15, 6)
    expect(rsiScoreDelta(150).delta).toBeCloseTo(-10, 6)
  })

  it('non-finite RSI yields no contribution', () => {
    expect(rsiScoreDelta(NaN).delta).toBe(0)
    expect(rsiScoreDelta(Infinity).delta).toBe(0)
  })

  it('label reflects band: oversold / overbought / neutral', () => {
    expect(rsiScoreDelta(20).label).toBe('RSI oversold')
    expect(rsiScoreDelta(80).label).toBe('RSI overbought')
    expect(rsiScoreDelta(50).label).toMatch(/^RSI \d+$/)
  })
})

describe('Quality pillar — negative-margin penalty', () => {
  const base: ResearchScoreInput = {
    trailingPE: null,
    forwardPE: null,
    debtToEquity: null,
    returnOnEquity: null,
    profitMargin: null,
    rsi14: null,
    trendScore: null,
    pctB: null,
    excessVsSpy60d: null,
    bandPosition: null,
  }

  it('negative profit margin produces lower quality score than 0% margin', () => {
    const lossy = computeResearchScore({ ...base, profitMargin: -0.30 })
    const breakeven = computeResearchScore({ ...base, profitMargin: 0 })
    // Quality pillar is index 1
    expect(lossy.pillars[1].score).toBeLessThan(breakeven.pillars[1].score)
  })

  it('healthy margin (>20%) still produces higher quality score than break-even', () => {
    const healthy = computeResearchScore({ ...base, profitMargin: 0.25 })
    const breakeven = computeResearchScore({ ...base, profitMargin: 0 })
    expect(healthy.pillars[1].score).toBeGreaterThan(breakeven.pillars[1].score)
  })

  it('negative margin detail string mentions the penalty', () => {
    const lossy = computeResearchScore({ ...base, profitMargin: -0.30 })
    expect(lossy.pillars[1].detail).toMatch(/negative margins/i)
  })
})
