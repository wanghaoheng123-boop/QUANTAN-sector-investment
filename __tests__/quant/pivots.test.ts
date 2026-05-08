import { describe, it, expect } from 'vitest'
import { classicPivots } from '@/lib/quant/pivots'

describe('classicPivots', () => {
  it('computes pivot from H+L+C / 3', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.pivot).toBeCloseTo(100, 6)  // (110+90+100)/3
  })

  it('R1 = 2P - L', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.r1).toBeCloseTo(2 * 100 - 90, 6)  // = 110
  })

  it('S1 = 2P - H', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.s1).toBeCloseTo(2 * 100 - 110, 6)  // = 90
  })

  it('R2 = P + (H - L)', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.r2).toBeCloseTo(100 + (110 - 90), 6)  // = 120
  })

  it('S2 = P - (H - L)', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.s2).toBeCloseTo(100 - (110 - 90), 6)  // = 80
  })

  it('R3 = H + 2(P - L)', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.r3).toBeCloseTo(110 + 2 * (100 - 90), 6)  // = 130
  })

  it('S3 = L - 2(H - P)', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.s3).toBeCloseTo(90 - 2 * (110 - 100), 6)  // = 70
  })

  it('preserves R1>P>S1 ordering (basic invariant)', () => {
    const p = classicPivots(105, 95, 100)
    expect(p.r1).toBeGreaterThan(p.pivot)
    expect(p.pivot).toBeGreaterThan(p.s1)
  })

  it('expands R1<R2<R3 and S1>S2>S3', () => {
    const p = classicPivots(110, 90, 100)
    expect(p.r2).toBeGreaterThan(p.r1)
    expect(p.r3).toBeGreaterThan(p.r2)
    expect(p.s2).toBeLessThan(p.s1)
    expect(p.s3).toBeLessThan(p.s2)
  })

  it('handles flat day (high == low == close)', () => {
    const p = classicPivots(100, 100, 100)
    expect(p.pivot).toBe(100)
    expect(p.r1).toBe(100)
    expect(p.s1).toBe(100)
    expect(p.r2).toBe(100)
    expect(p.s2).toBe(100)
  })
})
