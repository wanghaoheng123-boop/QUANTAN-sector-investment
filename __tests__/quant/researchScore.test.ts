import { describe, it, expect } from 'vitest'
import { computeResearchScore, bandPosition } from '@/lib/quant/researchScore'
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
})
