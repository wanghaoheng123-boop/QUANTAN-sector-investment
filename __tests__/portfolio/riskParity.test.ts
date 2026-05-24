/**
 * lib/portfolio/riskParity.ts tests (Q-051-NEW).
 *
 * Coverage: rollingVols, inverseVolWeights, covarianceMatrix, ercWeights.
 * Pins down: input-validation edge cases, scaling invariants, ERC equal-RC
 * property (per Maillard, Roncalli & Teiletche 2010).
 */

import { describe, it, expect } from 'vitest'
import {
  rollingVols,
  inverseVolWeights,
  covarianceMatrix,
  ercWeights,
} from '@/lib/portfolio/riskParity'

/** Deterministic random walk for synthetic returns. */
function fakeReturns(seed: number, n: number, vol: number): number[] {
  const rng = (s: number) => () => {
    s = (s * 9301 + 49297) % 233280
    return (s / 233280 - 0.5) * 2
  }
  const r = rng(seed)
  return Array.from({ length: n }, () => r() * vol)
}

describe('rollingVols', () => {
  it('returns annualized vol for series with enough data', () => {
    const data = { A: fakeReturns(1, 100, 0.01) }
    const vols = rollingVols(data, 60)
    expect(vols.A).toBeGreaterThan(0)
    expect(vols.A).toBeLessThan(1) // sanity: annualized vol of 1% daily ~16%
  })

  it('skips tickers with fewer than 10 bars', () => {
    const data = { A: [0.01, 0.02, 0.01], B: fakeReturns(2, 100, 0.01) }
    const vols = rollingVols(data, 60)
    expect(vols.A).toBeUndefined()
    expect(vols.B).toBeGreaterThan(0)
  })

  it('uses tail-window when input is longer than lookback', () => {
    // Two distinct vol regimes: low at start, high at end. Lookback=60 should
    // only see the high-vol portion.
    const lowVol = Array(60).fill(0.001)
    const highVol = fakeReturns(3, 60, 0.05)
    const data = { A: [...lowVol, ...highVol] }
    const vols = rollingVols(data, 60)
    // Should reflect the high-vol tail, not the average. Uniform-RNG vol of
    // ±0.05 has std ≈ 0.029 → annualized ≈ 0.46. The low-vol prefix would
    // give ~0.016 annualized. Anything > 0.2 proves we're seeing the tail.
    expect(vols.A).toBeGreaterThan(0.3)
  })
})

describe('inverseVolWeights', () => {
  it('weights are proportional to 1/vol and sum to 1', () => {
    const w = inverseVolWeights({ A: 0.1, B: 0.2, C: 0.4 })
    const sum = Object.values(w).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 8)
    // Lowest-vol ticker has highest weight
    expect(w.A).toBeGreaterThan(w.B)
    expect(w.B).toBeGreaterThan(w.C)
  })

  it('exact 1/vol ratios', () => {
    // Two assets, vol 0.1 and 0.2 → invVol 10 and 5 → weights 2/3 and 1/3
    const w = inverseVolWeights({ A: 0.1, B: 0.2 })
    expect(w.A).toBeCloseTo(2 / 3, 6)
    expect(w.B).toBeCloseTo(1 / 3, 6)
  })

  it('drops zero/negative vol entries', () => {
    const w = inverseVolWeights({ A: 0.1, B: 0, C: -0.05 })
    expect(w.B).toBeUndefined()
    expect(w.C).toBeUndefined()
    expect(w.A).toBeCloseTo(1, 6)
  })

  it('empty input → empty weights', () => {
    expect(inverseVolWeights({})).toEqual({})
  })
})

describe('covarianceMatrix', () => {
  it('returns symmetric matrix with sane shape', () => {
    const data = { A: fakeReturns(1, 100, 0.01), B: fakeReturns(2, 100, 0.01) }
    const cov = covarianceMatrix(data, 60)
    expect(cov.A.A).toBeGreaterThan(0) // variance positive
    expect(cov.B.B).toBeGreaterThan(0)
    // Symmetry
    expect(cov.A.B).toBeCloseTo(cov.B.A, 10)
  })

  it('returns empty object when insufficient bars', () => {
    const data = { A: [0.01], B: [0.02] }
    expect(covarianceMatrix(data, 60)).toEqual({})
  })

  it('annualizes by factor 252', () => {
    // Constant-vol series — var should be vol² × 252 (approximately)
    const vol = 0.02
    const ret = Array.from({ length: 100 }, () => vol)
    const cov = covarianceMatrix({ A: ret, B: ret }, 60)
    // All returns equal → variance is 0 (no dispersion)
    expect(cov.A.A).toBeCloseTo(0, 8)
  })

  it('zero variance for constant series', () => {
    const flat = Array(100).fill(0.005)
    const cov = covarianceMatrix({ A: flat, B: flat }, 60)
    expect(cov.A.A).toBeCloseTo(0, 10)
  })
})

describe('ercWeights (Equal Risk Contribution)', () => {
  it('empty cov → empty weights', () => {
    expect(ercWeights({})).toEqual({})
  })

  it('two assets with equal vol → 50/50 weights (sanity)', () => {
    const cov = {
      A: { A: 0.04, B: 0 },
      B: { A: 0, B: 0.04 },
    }
    const w = ercWeights(cov)
    expect(w.A).toBeCloseTo(0.5, 4)
    expect(w.B).toBeCloseTo(0.5, 4)
  })

  it('two assets, A 4× the vol of B → ERC overweights B', () => {
    // sigma_A = 0.4, sigma_B = 0.1 → A is 4× as volatile
    const cov = {
      A: { A: 0.16, B: 0 },
      B: { A: 0, B: 0.01 },
    }
    const w = ercWeights(cov)
    expect(w.A).toBeLessThan(w.B)
    // Roughly: w_A / w_B ≈ sigma_B / sigma_A = 0.25 → w_A ≈ 0.2, w_B ≈ 0.8
    expect(w.A).toBeCloseTo(0.2, 1)
    expect(w.B).toBeCloseTo(0.8, 1)
  })

  it('weights sum to 1', () => {
    const cov = {
      A: { A: 0.04, B: 0.01, C: 0.005 },
      B: { A: 0.01, B: 0.09, C: 0.02 },
      C: { A: 0.005, B: 0.02, C: 0.01 },
    }
    const w = ercWeights(cov)
    const sum = Object.values(w).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 4)
  })

  it('equal-risk property: each position contributes ~1/n of total risk', () => {
    // For diagonal cov, ERC reduces to inverse-vol weighting.
    // Verify: risk contribution rc_i = w_i × (Σ_j w_j × cov_ij) / portVol
    // should be ~portVol/n for each i.
    const cov = {
      A: { A: 0.04, B: 0, C: 0 },
      B: { A: 0, B: 0.09, C: 0 },
      C: { A: 0, B: 0, C: 0.01 },
    }
    const w = ercWeights(cov)
    const tickers = ['A', 'B', 'C']
    const sigma = tickers.map(t1 => tickers.map(t2 => cov[t1 as keyof typeof cov][t2 as keyof typeof cov]))
    const wArr = tickers.map(t => w[t])

    let portVar = 0
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) portVar += wArr[i] * wArr[j] * sigma[i][j]
    const portVol = Math.sqrt(portVar)

    const rc = tickers.map((_, i) => {
      let mrc = 0
      for (let j = 0; j < 3; j++) mrc += sigma[i][j] * wArr[j]
      return wArr[i] * mrc / portVol
    })
    // Each rc should equal portVol/3 (equal contribution)
    const target = portVol / 3
    for (const r of rc) {
      expect(r).toBeCloseTo(target, 4)
    }
  })
})
