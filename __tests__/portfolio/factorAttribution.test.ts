import { describe, it, expect } from 'vitest'
import { regressFactorLoadings } from '@/lib/portfolio/factorAttribution'
import type { FactorReturns } from '@/lib/portfolio/factorAttribution'

describe('regressFactorLoadings (multivariate OLS)', () => {
  function flat(value: number, len: number): number[] {
    return Array.from({ length: len }, () => value)
  }

  function zeroFactors(len: number): FactorReturns {
    return { MKT: flat(0, len), SMB: flat(0, len), HML: flat(0, len), MOM: flat(0, len), QMJ: flat(0, len) }
  }

  it('returns zero loadings when input is shorter than minimum bars', () => {
    const result = regressFactorLoadings(flat(0.01, 5), zeroFactors(5))
    expect(result.loadings.MKT).toBe(0)
    expect(result.alpha).toBe(0)
    expect(result.rSquared).toBeNull()
    expect(result.methodology).toBe('multivariate_ols')
  })

  it('recovers β_MKT ≈ 1 when asset equals MKT (other factors flat)', () => {
    const mkt = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.01)
    const factors: FactorReturns = {
      MKT: mkt,
      SMB: flat(0, 50),
      HML: flat(0, 50),
      MOM: flat(0, 50),
      QMJ: flat(0, 50),
    }
    const result = regressFactorLoadings(mkt, factors)
    expect(result.loadings.MKT).toBeCloseTo(1.0, 4)
    expect(result.rSquared).not.toBeNull()
  })

  it('computes intercept when asset = 2×MKT + constant', () => {
    const mkt = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.01)
    const asset = mkt.map(x => 2 * x + 0.001)
    const factors: FactorReturns = {
      MKT: mkt,
      SMB: flat(0, 50),
      HML: flat(0, 50),
      MOM: flat(0, 50),
      QMJ: flat(0, 50),
    }
    const result = regressFactorLoadings(asset, factors)
    expect(result.loadings.MKT).toBeCloseTo(2.0, 3)
    expect(result.alpha).toBeCloseTo(0.001, 3)
  })
})
