import { describe, it, expect } from 'vitest'
import { riskParityWeights, rebalanceDeltas, equalWeights } from '@/lib/portfolio/riskParity'

/** Generate a daily return series with given annual vol. */
function syntheticCloses(n: number, annualVol: number, startPrice = 100): number[] {
  const dailySigma = annualVol / Math.sqrt(252)
  const closes: number[] = [startPrice]
  for (let i = 1; i < n; i++) {
    const r = (Math.random() - 0.5) * dailySigma * 2
    closes.push(closes[i - 1] * (1 + r))
  }
  return closes
}

describe('riskParityWeights', () => {
  it('returns empty result for empty assets', () => {
    const r = riskParityWeights([])
    expect(r.weights).toHaveLength(0)
    expect(r.portfolioVol).toBe(0)
  })

  it('weights sum to 1', () => {
    const assets = [
      { ticker: 'A', closes: syntheticCloses(200, 0.20) },
      { ticker: 'B', closes: syntheticCloses(200, 0.30) },
      { ticker: 'C', closes: syntheticCloses(200, 0.15) },
    ]
    const r = riskParityWeights(assets)
    const sum = r.weights.reduce((s, w) => s + w.weight, 0)
    expect(sum).toBeCloseTo(1, 5)
  })

  it('lower-vol asset gets higher weight', () => {
    // Asset A: ~10% vol; Asset B: ~40% vol — A should have larger weight
    const a = syntheticCloses(300, 0.10)
    const b = syntheticCloses(300, 0.40)
    const r = riskParityWeights([
      { ticker: 'A', closes: a },
      { ticker: 'B', closes: b },
    ])
    const wA = r.weights.find((w) => w.ticker === 'A')!
    const wB = r.weights.find((w) => w.ticker === 'B')!
    expect(wA.weight).toBeGreaterThan(wB.weight)
  })

  it('equal vol → equal weights', () => {
    // Same vol → inverse-vol weights identical → 50/50
    const closes = syntheticCloses(300, 0.20)
    const r = riskParityWeights([
      { ticker: 'X', closes },
      { ticker: 'Y', closes },   // same series = same vol
    ])
    expect(r.weights[0].weight).toBeCloseTo(0.5, 2)
    expect(r.weights[1].weight).toBeCloseTo(0.5, 2)
  })

  it('fills allocation when totalValue provided', () => {
    const assets = [
      { ticker: 'A', closes: syntheticCloses(200, 0.15) },
      { ticker: 'B', closes: syntheticCloses(200, 0.30) },
    ]
    const r = riskParityWeights(assets, 100_000)
    const totalAlloc = r.weights.reduce((s, w) => s + (w.allocation ?? 0), 0)
    expect(totalAlloc).toBeCloseTo(100_000, 0)
  })

  it('HHI is in [1/n, 1]', () => {
    const assets = [
      { ticker: 'A', closes: syntheticCloses(200, 0.10) },
      { ticker: 'B', closes: syntheticCloses(200, 0.20) },
      { ticker: 'C', closes: syntheticCloses(200, 0.30) },
    ]
    const r = riskParityWeights(assets)
    const n = assets.length
    expect(r.hhi).toBeGreaterThanOrEqual(1 / n - 1e-9)
    expect(r.hhi).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe('rebalanceDeltas', () => {
  it('returns BUY when underweight', () => {
    const targets = [{ ticker: 'A', weight: 0.6, annualizedVol: 0.2, rawInverseVol: 5, allocation: 60_000 }]
    const current = { A: 40_000 }
    const deltas = rebalanceDeltas(current, targets, 0.01)
    expect(deltas).toHaveLength(1)
    expect(deltas[0].action).toBe('BUY')
    expect(deltas[0].deltaUsd).toBeCloseTo(20_000)
  })

  it('returns SELL when overweight', () => {
    const targets = [{ ticker: 'B', weight: 0.3, annualizedVol: 0.25, rawInverseVol: 4, allocation: 30_000 }]
    const current = { B: 55_000 }
    const deltas = rebalanceDeltas(current, targets, 0.01)
    expect(deltas[0].action).toBe('SELL')
  })

  it('filters trivial changes below threshold', () => {
    const targets = [{ ticker: 'C', weight: 0.5, annualizedVol: 0.2, rawInverseVol: 5, allocation: 50_000 }]
    const current = { C: 49_900 }  // 0.1% off — below default 1% threshold
    const deltas = rebalanceDeltas(current, targets, 0.01)
    expect(deltas).toHaveLength(0)
  })
})

describe('equalWeights', () => {
  it('assigns 1/n to each ticker', () => {
    const weights = equalWeights(['A', 'B', 'C', 'D'])
    for (const w of weights) expect(w.weight).toBeCloseTo(0.25)
  })

  it('assigns allocation proportionally', () => {
    const weights = equalWeights(['X', 'Y'], 80_000)
    for (const w of weights) expect(w.allocation).toBeCloseTo(40_000)
  })
})
