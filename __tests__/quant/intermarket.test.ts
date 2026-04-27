import { describe, it, expect } from 'vitest'
import {
  intermarketCorrelations,
  classifyRegime,
  analyzeIntermarket,
} from '@/lib/quant/intermarket'
import type { CorrelationMap } from '@/lib/quant/intermarket'

// Generate a smooth price series starting from `base`
function makeSeries(n: number, base = 100, drift = 0.001, noise = 0.01): { closes: number[]; dates: string[] } {
  const closes: number[] = []
  const dates: string[] = []
  let price = base
  const start = new Date('2022-01-01')
  for (let i = 0; i < n; i++) {
    price *= 1 + drift + (Math.random() - 0.5) * noise
    closes.push(price)
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return { closes, dates }
}

// Generates a series that is strongly positively correlated with `base`
function makeCorrelated(base: { closes: number[]; dates: string[] }, multiplier = 1, noiseScale = 0.002): { closes: number[]; dates: string[] } {
  const closes = base.closes.map((c) => c * multiplier * (1 + (Math.random() - 0.5) * noiseScale))
  return { closes, dates: [...base.dates] }
}

// Generates a series that is strongly negatively correlated with `base`
function makeInverse(base: { closes: number[]; dates: string[] }): { closes: number[]; dates: string[] } {
  const closes = base.closes.map((c) => 200 - c * 0.5 * (1 + (Math.random() - 0.5) * 0.001))
  return { closes, dates: [...base.dates] }
}

describe('intermarketCorrelations', () => {
  it('returns null entries when benchmark is missing', () => {
    const target = makeSeries(300)
    const result = intermarketCorrelations(target.closes, target.dates, {})
    expect(result['SPY'].corr63d).toBeNull()
    expect(result['SPY'].corr252d).toBeNull()
  })

  it('returns null corr63d when fewer than 63 aligned points', () => {
    const target = makeSeries(50)
    const spy = makeSeries(50)
    const result = intermarketCorrelations(target.closes, target.dates, { SPY: spy })
    expect(result['SPY'].corr63d).toBeNull()
  })

  it('returns high positive correlation for co-moving series', () => {
    const target = makeSeries(300, 100, 0.001, 0.002)
    // noiseScale=0 → spy prices are exact multiples of target → log returns identical
    const spy = makeCorrelated(target, 1.0, 0)
    const result = intermarketCorrelations(target.closes, target.dates, { SPY: spy })
    expect(result['SPY'].corr63d).not.toBeNull()
    expect(result['SPY'].corr63d!).toBeGreaterThan(0.99)
  })

  it('returns negative correlation for inverse series', () => {
    const target = makeSeries(300, 100, 0.001, 0.002)
    const vix = makeInverse(target)
    const result = intermarketCorrelations(target.closes, target.dates, { '^VIX': vix })
    expect(result['^VIX'].corr63d).not.toBeNull()
    expect(result['^VIX'].corr63d!).toBeLessThan(-0.5)
  })

  it('computes 252d correlation when data is sufficient', () => {
    const target = makeSeries(400)
    const spy = makeCorrelated(target)
    const result = intermarketCorrelations(target.closes, target.dates, { SPY: spy })
    expect(result['SPY'].corr252d).not.toBeNull()
  })

  it('all four benchmarks can be computed', () => {
    const target = makeSeries(300)
    const benchmarks = {
      SPY: makeCorrelated(target),
      '^VIX': makeInverse(target),
      UUP: makeSeries(300, 27, 0.0002),
      TLT: makeSeries(300, 95, -0.0001),
    }
    const result = intermarketCorrelations(target.closes, target.dates, benchmarks)
    expect(result['SPY'].corr63d).not.toBeNull()
    expect(result['^VIX'].corr63d).not.toBeNull()
    expect(result['UUP'].corr63d).not.toBeNull()
    expect(result['TLT'].corr63d).not.toBeNull()
  })
})

describe('classifyRegime', () => {
  function makeCorrs(spyCorr: number | null, vixCorr: number | null): CorrelationMap {
    return {
      'SPY': { corr63d: spyCorr, corr252d: null },
      '^VIX': { corr63d: vixCorr, corr252d: null },
      'UUP': { corr63d: null, corr252d: null },
      'TLT': { corr63d: null, corr252d: null },
    }
  }

  it('returns risk_on when SPY > 0.5 and VIX < -0.3', () => {
    expect(classifyRegime(makeCorrs(0.65, -0.55))).toBe('risk_on')
  })

  it('returns risk_off when SPY < 0 and VIX > 0.3', () => {
    expect(classifyRegime(makeCorrs(-0.20, 0.45))).toBe('risk_off')
  })

  it('returns mixed for ambiguous correlations', () => {
    expect(classifyRegime(makeCorrs(0.3, -0.1))).toBe('mixed')
  })

  it('returns mixed when correlations are null', () => {
    expect(classifyRegime(makeCorrs(null, null))).toBe('mixed')
  })
})

describe('analyzeIntermarket', () => {
  it('returns both correlations and regime', () => {
    const target = makeSeries(300)
    const result = analyzeIntermarket(target.closes, target.dates, {})
    expect(result).toHaveProperty('correlations')
    expect(result).toHaveProperty('regime')
    expect(['risk_on', 'risk_off', 'mixed']).toContain(result.regime)
  })
})
