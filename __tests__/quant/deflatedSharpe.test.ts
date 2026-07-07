/**
 * lib/quant/deflatedSharpe.ts — PSR / DSR (Q-065-NEW, 2026-07-07).
 * Known-value + property tests; references Bailey & López de Prado 2012/2014.
 */
import { describe, expect, it } from 'vitest'
import {
  sampleStd,
  skewness,
  kurtosis,
  normCdf,
  normInv,
  probabilisticSharpe,
  expectedMaxSharpe,
  deflatedSharpe,
} from '@/lib/quant/deflatedSharpe'

describe('moment helpers', () => {
  it('sampleStd matches a hand-computed value', () => {
    // [1,2,3,4]: mean 2.5, var (n-1) = (2.25+0.25+0.25+2.25)/3 = 5/3
    expect(sampleStd([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 12)
  })

  it('skewness ≈ 0 and kurtosis < 3 for a symmetric uniform-ish sample', () => {
    const xs = Array.from({ length: 2001 }, (_, i) => -1 + (2 * i) / 2000)
    expect(skewness(xs)).toBeCloseTo(0, 6)
    // Continuous uniform kurtosis = 1.8
    expect(kurtosis(xs)).toBeCloseTo(1.8, 2)
  })
})

describe('normal CDF / inverse', () => {
  it('normCdf known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7)
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3)
  })

  it('normInv inverts normCdf', () => {
    for (const p of [0.01, 0.25, 0.5, 0.9, 0.999]) {
      expect(normCdf(normInv(p))).toBeCloseTo(p, 5)
    }
  })
})

describe('probabilisticSharpe (BLdP 2012)', () => {
  it('≈ 0.5 for a zero-mean symmetric series (SR≈0 against SR*=0)', () => {
    const xs = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01))
    const psr = probabilisticSharpe(xs, 0)
    expect(psr).not.toBeNull()
    expect(psr!).toBeGreaterThan(0.45)
    expect(psr!).toBeLessThan(0.55)
  })

  it('→ 1 for a consistently positive series', () => {
    const xs = Array.from({ length: 300 }, (_, i) => 0.01 + 0.001 * Math.sin(i))
    expect(probabilisticSharpe(xs, 0)!).toBeGreaterThan(0.999)
  })

  it('null on degenerate inputs (σ=0, tiny samples)', () => {
    expect(probabilisticSharpe([0.01, 0.01, 0.01], 0)).toBeNull()
    expect(probabilisticSharpe([0.01], 0)).toBeNull()
  })
})

describe('expectedMaxSharpe / deflatedSharpe (BLdP 2014)', () => {
  it('expectedMaxSharpe grows with trials and is 0 for a single trial', () => {
    const T = 1000
    expect(expectedMaxSharpe(1, T)).toBe(0)
    const e10 = expectedMaxSharpe(10, T)!
    const e100 = expectedMaxSharpe(100, T)!
    expect(e10).toBeGreaterThan(0)
    expect(e100).toBeGreaterThan(e10)
  })

  it('DSR is monotone non-increasing in assumed trials (DSR100 ≤ DSR10 ≤ PSR)', () => {
    const xs = Array.from({ length: 400 }, (_, i) => 0.002 + 0.01 * Math.sin(i * 1.7))
    const psr = probabilisticSharpe(xs, 0)!
    const d10 = deflatedSharpe(xs, 10)!
    const d100 = deflatedSharpe(xs, 100)!
    expect(d10).toBeLessThanOrEqual(psr)
    expect(d100).toBeLessThanOrEqual(d10)
    expect(d100).toBeGreaterThan(0)
  })
})
