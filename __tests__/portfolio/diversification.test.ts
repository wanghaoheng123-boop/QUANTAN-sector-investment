import { describe, it, expect } from 'vitest'
import {
  buildCorrelationMatrix,
  diversificationReport,
  diversificationGrade,
} from '@/lib/portfolio/diversification'

function syntheticCloses(n: number, drift = 0.001, noise = 0.02, start = 100): number[] {
  const out = [start]
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1] * (1 + drift + (Math.random() - 0.5) * noise))
  }
  return out
}

function correlatedCloses(base: number[], scale = 1, noiseLevel = 0): number[] {
  return base.map((c) => c * scale * (1 + (Math.random() - 0.5) * noiseLevel))
}

describe('buildCorrelationMatrix', () => {
  it('diagonal is always 1', () => {
    const assets = [
      { ticker: 'A', closes: syntheticCloses(100) },
      { ticker: 'B', closes: syntheticCloses(100) },
    ]
    const m = buildCorrelationMatrix(assets)
    expect(m.get(0, 0)).toBe(1)
    expect(m.get(1, 1)).toBe(1)
  })

  it('is symmetric', () => {
    const assets = [
      { ticker: 'A', closes: syntheticCloses(200) },
      { ticker: 'B', closes: syntheticCloses(200) },
      { ticker: 'C', closes: syntheticCloses(200) },
    ]
    const m = buildCorrelationMatrix(assets)
    expect(m.get(0, 1)).toBeCloseTo(m.get(1, 0), 10)
    expect(m.get(0, 2)).toBeCloseTo(m.get(2, 0), 10)
    expect(m.get(1, 2)).toBeCloseTo(m.get(2, 1), 10)
  })

  it('identical series → correlation 1', () => {
    const closes = syntheticCloses(200, 0.001, 0.01)
    const assets = [
      { ticker: 'A', closes },
      { ticker: 'B', closes: [...closes] },
    ]
    const m = buildCorrelationMatrix(assets)
    expect(m.get(0, 1)).toBeCloseTo(1, 5)
  })

  it('values are in [-1, 1]', () => {
    const n = 3
    const assets = Array.from({ length: n }, (_, i) => ({
      ticker: String(i),
      closes: syntheticCloses(250, 0.001, 0.03 * (i + 1)),
    }))
    const m = buildCorrelationMatrix(assets)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(m.get(i, j)).toBeGreaterThanOrEqual(-1 - 1e-9)
        expect(m.get(i, j)).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })
})

describe('diversificationReport', () => {
  it('HHI = 1 for single asset', () => {
    const report = diversificationReport([{ ticker: 'SPY', closes: syntheticCloses(200) }])
    expect(report.hhi).toBeCloseTo(1, 5)
    expect(report.effectiveN).toBeCloseTo(1, 5)
  })

  it('equal weights → HHI = 1/n', () => {
    const n = 4
    const assets = Array.from({ length: n }, (_, i) => ({
      ticker: `T${i}`,
      closes: syntheticCloses(200),
    }))
    const report = diversificationReport(assets)  // defaults to equal weight
    expect(report.hhi).toBeCloseTo(1 / n, 3)
    expect(report.effectiveN).toBeCloseTo(n, 1)
  })

  it('perfectly correlated assets → diversificationRatio near 1', () => {
    const base = syntheticCloses(200, 0.001, 0.02)
    const assets = [
      { ticker: 'A', closes: base },
      { ticker: 'B', closes: correlatedCloses(base, 1.0, 0) },  // identical
    ]
    const report = diversificationReport(assets)
    // No diversification benefit when perfectly correlated
    expect(report.diversificationRatio).toBeCloseTo(1, 1)
  })

  it('portfolioVol is positive and finite', () => {
    const assets = [
      { ticker: 'A', closes: syntheticCloses(300) },
      { ticker: 'B', closes: syntheticCloses(300) },
    ]
    const report = diversificationReport(assets)
    expect(report.portfolioVol).toBeGreaterThan(0)
    expect(isFinite(report.portfolioVol)).toBe(true)
  })

  it('avgPairwiseCorr is within [-1, 1]', () => {
    const assets = [
      { ticker: 'A', closes: syntheticCloses(200) },
      { ticker: 'B', closes: syntheticCloses(200) },
      { ticker: 'C', closes: syntheticCloses(200) },
    ]
    const report = diversificationReport(assets)
    expect(report.avgPairwiseCorr).toBeGreaterThanOrEqual(-1 - 1e-9)
    expect(report.avgPairwiseCorr).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('handles empty assets gracefully', () => {
    const report = diversificationReport([])
    expect(report.hhi).toBe(0)
    expect(report.effectiveN).toBe(0)
    expect(report.portfolioVol).toBe(0)
  })
})

describe('diversificationGrade', () => {
  it('grades A for high effectiveN and low correlation', () => {
    const grade = diversificationGrade({ hhi: 1/10, effectiveN: 10, avgPairwiseCorr: 0.1, portfolioVol: 0.1, diversificationRatio: 1.5, correlationMatrix: { tickers: [], matrix: [], get: () => 0 } })
    expect(grade).toBe('A')
  })

  it('grades D for low effectiveN and high correlation', () => {
    const grade = diversificationGrade({ hhi: 0.9, effectiveN: 1.1, avgPairwiseCorr: 0.85, portfolioVol: 0.3, diversificationRatio: 1.0, correlationMatrix: { tickers: [], matrix: [], get: () => 0 } })
    expect(grade).toBe('D')
  })

  it('grades B for moderate diversification', () => {
    const grade = diversificationGrade({ hhi: 0.2, effectiveN: 5, avgPairwiseCorr: 0.40, portfolioVol: 0.15, diversificationRatio: 1.2, correlationMatrix: { tickers: [], matrix: [], get: () => 0 } })
    expect(grade).toBe('B')
  })
})
