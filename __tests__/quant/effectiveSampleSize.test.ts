import { describe, it, expect } from 'vitest'
import {
  meanClusterSize,
  designEffect,
  effectiveSampleSize,
  correlation,
  meanPairwiseCorrelation,
} from '@/lib/quant/effectiveSampleSize'
import { deflatedSharpe, probabilisticSharpe } from '@/lib/quant/deflatedSharpe'

describe('meanClusterSize — SIZE-WEIGHTED, not the plain mean', () => {
  it('weights by size, so large clusters dominate as they should', () => {
    // Plain mean of [1,1,10] is 4; size-weighted is (1+1+100)/12 = 8.5.
    // With unequal clusters the plain mean UNDERSTATES the design effect,
    // because most observations live in the large clusters.
    expect(meanClusterSize([1, 1, 10])).toBeCloseTo(8.5, 6)
  })

  it('equals the common size when clusters are equal', () => {
    expect(meanClusterSize([4, 4, 4])).toBeCloseTo(4, 10)
  })

  it('ignores empty clusters rather than counting them as zero', () => {
    expect(meanClusterSize([0, 5, 5])).toBeCloseTo(5, 10)
  })

  it('returns 0 for no clusters, so callers must fail rather than divide', () => {
    expect(meanClusterSize([])).toBe(0)
  })
})

describe('designEffect — may only ever shrink the sample', () => {
  it('is 1 when observations are uncorrelated', () => {
    expect(designEffect(10, 0)).toBeCloseTo(1, 10)
  })

  it('is 1 for singleton clusters however correlated', () => {
    expect(designEffect(1, 0.9)).toBeCloseTo(1, 10)
  })

  it('matches Kish: 1 + (m-1)*rho', () => {
    expect(designEffect(9.16, 0.2494)).toBeCloseTo(1 + 8.16 * 0.2494, 6)
  })

  it('clamps NEGATIVE rho to zero — clustering must never add information', () => {
    // A diversifying cluster would otherwise produce DEFF < 1 and an n_eff
    // LARGER than n, i.e. a correction that flatters. Not permitted.
    expect(designEffect(10, -0.5)).toBe(1)
  })

  it('is 1 on non-finite input rather than propagating NaN', () => {
    expect(designEffect(NaN, 0.3)).toBe(1)
    expect(designEffect(10, NaN)).toBe(1)
  })
})

describe('effectiveSampleSize', () => {
  it('never exceeds n', () => {
    expect(effectiveSampleSize(345, 1, 0)).toBe(345)
    expect(effectiveSampleSize(345, 10, -1)).toBe(345)
  })

  it('shrinks by the design effect', () => {
    expect(effectiveSampleSize(345, 9.16, 0.2494)).toBeCloseTo(345 / (1 + 8.16 * 0.2494), 4)
  })

  it('reproduces the published figure: n=345 -> n_eff ~ 114', () => {
    expect(Math.round(effectiveSampleSize(345, 9.16, 0.2494))).toBe(114)
  })

  it('never returns below 2, since PSR needs T >= 2', () => {
    expect(effectiveSampleSize(5, 100, 1)).toBe(2)
  })
})

describe('correlation', () => {
  it('is 1 for a perfectly increasing copy and -1 for its negation', () => {
    const a = [1, 2, 3, 4, 5]
    expect(correlation(a, a)).toBeCloseTo(1, 10)
    expect(correlation(a, a.map((x) => -x))).toBeCloseTo(-1, 10)
  })

  it('returns null for a constant series rather than dividing by zero', () => {
    expect(correlation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull()
  })

  it('returns null when there is too little data to mean anything', () => {
    expect(correlation([1, 2], [1, 2])).toBeNull()
  })
})

describe('meanPairwiseCorrelation', () => {
  it('averages over all pairs', () => {
    const a = [1, 2, 3, 4, 5]
    // a vs a = 1, a vs -a = -1, -a vs a... three pairs: 1, -1, -1 => -1/3
    expect(meanPairwiseCorrelation([a, a, a.map((x) => -x)])).toBeCloseTo((1 - 1 - 1) / 3, 6)
  })

  it('returns null with fewer than two usable series, so the caller fails closed', () => {
    expect(meanPairwiseCorrelation([[1, 2, 3]])).toBeNull()
    expect(meanPairwiseCorrelation([])).toBeNull()
  })
})

describe('deflatedSharpe — the effectiveT argument is load-bearing', () => {
  // A series with a small positive drift, deterministic so the test is stable.
  const returns = Array.from({ length: 345 }, (_, i) => 0.015 + 0.06 * Math.sin(i * 1.7))

  it('defaults to returns.length, preserving pre-existing behaviour', () => {
    expect(deflatedSharpe(returns, 100)).toBe(deflatedSharpe(returns, 100, returns.length))
    expect(probabilisticSharpe(returns, 0)).toBe(probabilisticSharpe(returns, 0, returns.length))
  })

  it('a SMALLER effective T lowers the deflated Sharpe', () => {
    // This is the whole point: clustering must move the number in the
    // conservative direction. If it did not, the correction would be cosmetic.
    const full = deflatedSharpe(returns, 1053, returns.length)!
    const clustered = deflatedSharpe(returns, 1053, 114)!
    expect(clustered).toBeLessThan(full)
  })

  it('discounts BOTH the PSR z and the expected-max bar, not just one', () => {
    // Passing effectiveT must change the result even at nTrials=1, where the
    // expected-max bar is 0 — proving the PSR half is discounted too.
    expect(deflatedSharpe(returns, 1, 114)).not.toBe(deflatedSharpe(returns, 1, returns.length))
  })

  it('is monotonically decreasing in nTrials — the property that broke the first gate', () => {
    const a = deflatedSharpe(returns, 45, 114)!
    const b = deflatedSharpe(returns, 1053, 114)!
    expect(b).toBeLessThan(a)
  })
})
