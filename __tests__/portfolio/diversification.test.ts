import { describe, it, expect } from 'vitest'
import {
  correlationMatrix,
  herfindahlIndex,
  sectorExposure,
  diversificationRatio,
} from '@/lib/portfolio/diversification'

/**
 * Phase 13 S2 audit regressions for lib/portfolio/diversification.ts.
 *
 * Q (Quant) findings under test:
 *   - pearsonCorr now adapts the SSOT primitive; backward-compat for
 *     the existing `return 0` convention on degenerate inputs.
 *   - diversificationRatio no longer fail-OPENs on missing data
 *     (Math.min(...lengths)=0 used to silently return ratio=1).
 *     New contract returns { ratio, observations, warnings }.
 *
 * Citation: Choueifaty & Coignard (2008) — diversification ratio.
 */

function ones(n: number): number[] {
  return Array.from({ length: n }, () => 0.01)
}

function alternating(n: number, base = 0.01): number[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? base : -base))
}

describe('correlationMatrix', () => {
  it('returns identity matrix for single-asset (n=1) safely', () => {
    const m = correlationMatrix({ AAPL: ones(30) }, 30)
    expect(m.tickers).toEqual(['AAPL'])
    expect(m.matrix).toEqual([[0]])  // n<2 short-circuit
    expect(m.avgPairwiseCorr).toBe(0)
  })

  it('full-correlation matrix has all diagonals = 1', () => {
    const r1 = Array.from({ length: 60 }, (_, i) => i * 0.001)
    const r2 = r1.slice()  // perfectly correlated
    const m = correlationMatrix({ AAPL: r1, MSFT: r2 }, 60)
    expect(m.matrix[0][0]).toBe(1)
    expect(m.matrix[1][1]).toBe(1)
    expect(m.matrix[0][1]).toBeCloseTo(1, 5)
    expect(m.matrix[1][0]).toBeCloseTo(1, 5)
    expect(m.avgPairwiseCorr).toBeCloseTo(1, 5)
  })

  it('finds max and min correlations correctly across triplet', () => {
    const a = Array.from({ length: 60 }, (_, i) => i * 0.001)
    const b = a.slice() // corr(a,b)=1
    const c = a.map(x => -x) // corr(a,c)=-1
    const m = correlationMatrix({ A: a, B: b, C: c }, 60)
    expect(m.maxCorr.corr).toBeCloseTo(1, 5)
    expect(m.minCorr.corr).toBeCloseTo(-1, 5)
  })
})

describe('herfindahlIndex', () => {
  it('returns concentrated for single 100% weight (HHI=1)', () => {
    const r = herfindahlIndex({ AAPL: 1.0 })
    expect(r.hhi).toBe(1)
    expect(r.interpretation).toBe('concentrated')
    expect(r.effectiveN).toBe(1)
  })

  it('returns diversified for 5 equal weights (HHI=0.2, normalized=0)', () => {
    const r = herfindahlIndex({ A: 0.2, B: 0.2, C: 0.2, D: 0.2, E: 0.2 })
    expect(r.hhi).toBeCloseTo(0.2, 6)
    expect(r.normalizedHHI).toBeCloseTo(0, 6)
    expect(r.effectiveN).toBeCloseTo(5, 6)
    expect(r.interpretation).toBe('diversified')
  })

  it('returns moderate at concentrated-but-not-extreme weights', () => {
    // 40/30/20/10 → HHI = 0.30, normalized ≈ 0.067 — diversified band
    const r = herfindahlIndex({ A: 0.4, B: 0.3, C: 0.2, D: 0.1 })
    expect(r.hhi).toBeCloseTo(0.30, 4)
  })

  it('filters zero weights from the count', () => {
    const r = herfindahlIndex({ A: 0.5, B: 0.5, ZERO: 0 })
    expect(r.effectiveN).toBeCloseTo(2, 6)
  })
})

describe('sectorExposure', () => {
  it('aggregates weights by sector', () => {
    const w = { AAPL: 0.3, MSFT: 0.2, XOM: 0.5 }
    const s = { AAPL: 'Tech', MSFT: 'Tech', XOM: 'Energy' }
    const exp = sectorExposure(w, s)
    const tech = exp.find(e => e.sector === 'Tech')!
    const energy = exp.find(e => e.sector === 'Energy')!
    expect(tech.weight).toBeCloseTo(0.5, 6)
    expect(energy.weight).toBeCloseTo(0.5, 6)
    expect(tech.tickers.sort()).toEqual(['AAPL', 'MSFT'])
  })

  it('sorts by weight descending', () => {
    const w = { AAPL: 0.2, XOM: 0.6, JPM: 0.2 }
    const s = { AAPL: 'Tech', XOM: 'Energy', JPM: 'Financials' }
    const exp = sectorExposure(w, s)
    expect(exp[0].sector).toBe('Energy')
    expect(exp[0].weight).toBeCloseTo(0.6, 6)
  })

  it('groups unknown sectors as "Unknown"', () => {
    const exp = sectorExposure({ FOO: 1.0 }, {})
    expect(exp[0].sector).toBe('Unknown')
  })
})

describe('diversificationRatio — Phase 13 S2 fail-closed contract', () => {
  it('empty portfolio → ratio=1, warning, observations=0', () => {
    const r = diversificationRatio({}, {})
    expect(r.ratio).toBe(1)
    expect(r.observations).toBe(0)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings[0]).toMatch(/Empty portfolio/)
  })

  it('single-asset portfolio → ratio=1, definitionally-1 warning', () => {
    const r = diversificationRatio({ A: ones(60) }, { A: 1.0 })
    expect(r.ratio).toBe(1)
    expect(r.warnings[0]).toMatch(/Single-asset/)
  })

  it('two perfectly-correlated assets → ratio ≈ 1', () => {
    const series = Array.from({ length: 60 }, (_, i) => i * 0.0001)
    const r = diversificationRatio({ A: series, B: series.slice() }, { A: 0.5, B: 0.5 })
    expect(r.ratio).toBeCloseTo(1, 1)
    expect(r.warnings).toEqual([])
  })

  it('two imperfectly anti-correlated assets → ratio > 1 (diversification benefit)', () => {
    // Perfect anti-correlation with equal weights makes portfolio variance
    // exactly 0 (perfect hedge), so DR is undefined (∞). Use an imperfect
    // hedge so portfolio vol > 0 and the diversification benefit is finite.
    const up = Array.from({ length: 60 }, (_, i) => Math.sin(i * 0.3) * 0.02)
    const partialDown = up.map((x, i) => -x + Math.cos(i * 0.5) * 0.003)
    const r = diversificationRatio({ A: up, B: partialDown }, { A: 0.5, B: 0.5 })
    expect(r.ratio).toBeGreaterThan(1)
    expect(r.warnings).toEqual([])
  })

  it('two perfectly anti-correlated assets → ratio=1 (portfolio vol degenerate)', () => {
    const up = Array.from({ length: 60 }, (_, i) => 0.01 + Math.sin(i) * 0.005)
    const down = up.map(x => -x)
    const r = diversificationRatio({ A: up, B: down }, { A: 0.5, B: 0.5 })
    // portVol = 0 → ratio falls back to 1 (undefined case)
    expect(r.ratio).toBe(1)
  })

  /**
   * Regression: prior implementation used Math.min(...lengths). If even
   * one ticker had zero history in the lookback, min=0 → return 1 with
   * no signal that the computation was degraded.
   */
  it('one missing-data ticker → warning + computed result (not silent 1)', () => {
    const series = alternating(60)
    const r = diversificationRatio(
      { A: series, B: [] },
      { A: 0.5, B: 0.5 },
    )
    // B excluded from vol average; A still computed.
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings.some(w => w.includes('B') || w.includes('1 ticker'))).toBe(true)
  })

  it('all tickers short on data → warning + ratio=1 with honest observations', () => {
    const r = diversificationRatio(
      { A: [0.01, 0.02], B: [0.01] },
      { A: 0.5, B: 0.5 },
    )
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.ratio).toBe(1)
  })
})
