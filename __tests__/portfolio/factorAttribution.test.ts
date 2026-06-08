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

  it('returns zero loadings when input is shorter than minimum bars (n < 60)', () => {
    // Min-N raised from 10 to 60: a 6-parameter regression needs ≥54 residual
    // dof for usable t-stats. n=5 (and indeed anything < 60) is suppressed.
    const result = regressFactorLoadings(flat(0.01, 5), zeroFactors(5))
    expect(result.loadings.MKT).toBe(0)
    expect(result.alpha).toBe(0)
    expect(result.rSquared).toBeNull()
    expect(result.methodology).toBe('multivariate_ols')
  })

  it('suppresses fit at n = 59 but fits at n = 60 (min-N boundary)', () => {
    const mkt59 = Array.from({ length: 59 }, (_, i) => Math.sin(i) * 0.01)
    const below = regressFactorLoadings(mkt59, {
      MKT: mkt59, SMB: flat(0, 59), HML: flat(0, 59), MOM: flat(0, 59), QMJ: flat(0, 59),
    })
    expect(below.rSquared).toBeNull()       // n=59 < 60 → suppressed
    expect(below.loadings.MKT).toBe(0)

    const mkt60 = Array.from({ length: 60 }, (_, i) => Math.sin(i) * 0.01)
    const at = regressFactorLoadings(mkt60, {
      MKT: mkt60, SMB: flat(0, 60), HML: flat(0, 60), MOM: flat(0, 60), QMJ: flat(0, 60),
    })
    expect(at.rSquared).not.toBeNull()       // n=60 → fits
    expect(at.loadings.MKT).toBeCloseTo(1.0, 4)
  })

  it('recovers β_MKT ≈ 1 when asset equals MKT (other factors flat)', () => {
    // Fixture length bumped 50→60 to clear the new min-N=60 floor. β_MKT is
    // EXACT by construction (asset ≡ 1·MKT), so the expected value is unchanged.
    const mkt = Array.from({ length: 60 }, (_, i) => Math.sin(i) * 0.01)
    const factors: FactorReturns = {
      MKT: mkt,
      SMB: flat(0, 60),
      HML: flat(0, 60),
      MOM: flat(0, 60),
      QMJ: flat(0, 60),
    }
    const result = regressFactorLoadings(mkt, factors)
    expect(result.loadings.MKT).toBeCloseTo(1.0, 4)
    expect(result.rSquared).not.toBeNull()
  })

  it('computes intercept when asset = 2×MKT + constant', () => {
    // Fixture length bumped 50→60. asset ≡ 2·MKT + 0.001, so β_MKT=2 and
    // α=0.001 are EXACT by construction — expected values unchanged from before.
    const mkt = Array.from({ length: 60 }, (_, i) => Math.sin(i) * 0.01)
    const asset = mkt.map(x => 2 * x + 0.001)
    const factors: FactorReturns = {
      MKT: mkt,
      SMB: flat(0, 60),
      HML: flat(0, 60),
      MOM: flat(0, 60),
      QMJ: flat(0, 60),
    }
    const result = regressFactorLoadings(asset, factors)
    expect(result.loadings.MKT).toBeCloseTo(2.0, 3)
    expect(result.alpha).toBeCloseTo(0.001, 3)
  })

  it('β-recovery holds AND t-stats/adjR²/condNum are finite on well-conditioned input', () => {
    // Five factors each with INDEPENDENT variance (so none is dropped as a
    // zero-variance column and every coefficient gets a real standard error).
    // Deterministic LCG for reproducibility.
    const N = 120
    let s = 12345 >>> 0
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF - 0.5 }
    const mk = () => Array.from({ length: N }, () => rnd() * 0.02)
    const MKT = mk(), SMB = mk(), HML = mk(), MOM = mk(), QMJ = mk()

    // Known DGP: asset = 1.0·MKT + 0.5·SMB − 0.3·HML + 0.2·MOM + 0.1·QMJ + α + ε
    const ALPHA = 0.0005
    const eps = () => rnd() * 0.001   // small noise so the model is well-specified, not exact
    const asset = Array.from({ length: N }, (_, i) =>
      1.0 * MKT[i] + 0.5 * SMB[i] - 0.3 * HML[i] + 0.2 * MOM[i] + 0.1 * QMJ[i] + ALPHA + eps(),
    )

    const r = regressFactorLoadings(asset, { MKT, SMB, HML, MOM, QMJ })

    // β-recovery: loose tolerance because of the additive noise term ε.
    expect(r.loadings.MKT).toBeCloseTo(1.0, 1)
    expect(r.loadings.SMB).toBeCloseTo(0.5, 1)
    expect(r.loadings.HML).toBeCloseTo(-0.3, 1)

    // Diagnostics present and finite.
    expect(r.nObs).toBe(N)
    expect(r.dof).toBe(N - 6)                       // intercept + 5 active factors
    expect(r.rSquared).not.toBeNull()
    expect(r.adjustedRSquared).not.toBeNull()
    expect(Number.isFinite(r.adjustedRSquared as number)).toBe(true)
    // adjusted R² ≤ R² always (penalty for parameters).
    expect(r.adjustedRSquared as number).toBeLessThanOrEqual(r.rSquared as number)
    expect(r.conditionNumber).not.toBeNull()
    expect(Number.isFinite(r.conditionNumber as number)).toBe(true)
    expect(r.conditionNumber as number).toBeGreaterThan(0)

    // Every coefficient has a finite SE and t-stat (no dropped columns here).
    for (const k of ['alpha', 'MKT', 'SMB', 'HML', 'MOM', 'QMJ'] as const) {
      expect(r.standardErrors?.[k]).not.toBeNull()
      expect(Number.isFinite(r.standardErrors?.[k] as number)).toBe(true)
      expect(r.tStats?.[k]).not.toBeNull()
      expect(Number.isFinite(r.tStats?.[k] as number)).toBe(true)
    }
    // The loaded MKT factor (true β=1, strong signal) should be highly significant.
    expect(Math.abs(r.tStats?.MKT as number)).toBeGreaterThan(2)
  })

  it('reports null SE/t for a dropped zero-variance factor column', () => {
    // SMB/HML/MOM/QMJ are flat (zero variance) → dropped by activeCols. They
    // carry no information, so SE is undefined (null), not a fabricated 0.
    // Asset = MKT + tiny noise so the residual is non-degenerate (RSS > 0) and
    // the ACTIVE columns (intercept + MKT) get finite, non-zero SEs — a perfect
    // fit (RSS=0) would legitimately give SE=0 → null and defeat the contrast.
    const mkt = Array.from({ length: 80 }, (_, i) => Math.sin(i) * 0.01)
    let s = 777 >>> 0
    const noise = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 0xFFFFFFFF - 0.5) * 0.0005 }
    const asset = mkt.map(v => v + noise())
    const r = regressFactorLoadings(asset, {
      MKT: mkt, SMB: flat(0, 80), HML: flat(0, 80), MOM: flat(0, 80), QMJ: flat(0, 80),
    })
    // MKT + intercept are active → finite SE.
    expect(r.standardErrors?.MKT).not.toBeNull()
    expect(r.standardErrors?.alpha).not.toBeNull()
    // Flat factors dropped → null SE/t.
    expect(r.standardErrors?.SMB).toBeNull()
    expect(r.tStats?.SMB).toBeNull()
    expect(r.loadings.SMB).toBe(0)
    // dof reflects only the q=2 active params (intercept + MKT).
    expect(r.dof).toBe(80 - 2)
  })
})
