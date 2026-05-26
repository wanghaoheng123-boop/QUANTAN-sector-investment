import { describe, it, expect } from 'vitest'
import { regressFactorLoadings } from '@/lib/portfolio/factorAttribution'
import type { FactorReturns } from '@/lib/portfolio/factorAttribution'

/**
 * NOTE: These tests pin down the CURRENT BEHAVIOUR of the naive univariate
 * proxy (see `lib/portfolio/factorAttribution.ts` top-of-file disclaimer).
 * They are NOT validation that the implementation matches canonical
 * Fama-French / Carhart attribution — those tests will land alongside the
 * multivariate OLS rewrite in Phase 16.
 */
describe('regressFactorLoadings (Q-044-NEW — naive proxy)', () => {
  function flat(value: number, len: number): number[] {
    return Array.from({ length: len }, () => value)
  }

  function zeroFactors(len: number): FactorReturns {
    return { MKT: flat(0, len), SMB: flat(0, len), HML: flat(0, len), MOM: flat(0, len), QMJ: flat(0, len) }
  }

  it('returns zero loadings when input is shorter than 10 bars', () => {
    const result = regressFactorLoadings(flat(0.01, 5), zeroFactors(5))
    expect(result.loadings.MKT).toBe(0)
    expect(result.loadings.SMB).toBe(0)
    expect(result.loadings.HML).toBe(0)
    expect(result.loadings.MOM).toBe(0)
    expect(result.loadings.QMJ).toBe(0)
    expect(result.alpha).toBe(0)
    expect(result.rSquared).toBeNull()
    expect(result.methodology).toBe('naive_univariate_proxy')
  })

  it('zero-variance factors yield zero betas (no division-by-zero)', () => {
    const asset = flat(0.01, 50)
    const factors = zeroFactors(50) // all flat → variance 0 → beta defined as 0 by olsBeta guard
    const result = regressFactorLoadings(asset, factors)
    expect(result.loadings.MKT).toBe(0)
    expect(result.loadings.SMB).toBe(0)
  })

  it('univariate β recovers when asset = MKT exactly (β_MKT ~ 1)', () => {
    // Generate a deterministic MKT series; asset returns identical.
    const mkt = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.01)
    const factors: FactorReturns = {
      MKT: mkt,
      SMB: flat(0, 50),
      HML: flat(0, 50),
      MOM: flat(0, 50),
      QMJ: flat(0, 50),
    }
    const result = regressFactorLoadings(mkt, factors)
    expect(result.loadings.MKT).toBeCloseTo(1.0, 6)
    // Other betas are 0 (factors are flat → β=0 by guard)
    expect(result.loadings.SMB).toBe(0)
  })

  it('alpha is single-factor (only MKT contribution removed) — documents the gap', () => {
    // Use varying inputs so olsBeta is well-defined (flat inputs produce
    // floating-point noise in β through the (x - mean)*(y - mean) accumulator).
    // Asset = 2 × MKT + 0.001 constant offset → univariate β_MKT = 2, alpha = 0.001.
    const mkt = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.01)
    const asset = mkt.map((x) => 2 * x + 0.001)
    const factors: FactorReturns = {
      MKT: mkt,
      SMB: flat(0, 50),
      HML: flat(0, 50),
      MOM: flat(0, 50),
      QMJ: flat(0, 50),
    }
    const result = regressFactorLoadings(asset, factors)
    // β_MKT ≈ 2; alpha = mean(asset) - 2 × mean(MKT) ≈ 0.001. The "single-factor"
    // gap: a real Carhart attribution would remove SMB/HML/MOM/QMJ contributions
    // too. In this naive proxy with zero-variance non-MKT factors, those β's
    // contribute nothing — but a real implementation would not exhibit this
    // dependency on the *variance* structure of the non-MKT factors.
    expect(result.loadings.MKT).toBeCloseTo(2.0, 4)
    expect(result.alpha).toBeCloseTo(0.001, 4)
  })

  it('rSquared is null (real multivariate R² deferred)', () => {
    const mkt = Array.from({ length: 50 }, (_, i) => Math.cos(i) * 0.01)
    const factors: FactorReturns = { MKT: mkt, SMB: flat(0, 50), HML: flat(0, 50), MOM: flat(0, 50), QMJ: flat(0, 50) }
    const result = regressFactorLoadings(mkt, factors)
    expect(result.rSquared).toBeNull()
    expect(result.disclaimer).toContain('not Fama-French')
  })
})
