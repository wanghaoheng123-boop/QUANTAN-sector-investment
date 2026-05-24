import { describe, it, expect } from 'vitest'
import { piecewiseRsiScore } from '@/lib/backtest/signals'

describe('piecewiseRsiScore (Q-025)', () => {
  it('returns +1 below 30', () => {
    expect(piecewiseRsiScore(20)).toBe(1)
  })
  it('returns -1 above 70', () => {
    expect(piecewiseRsiScore(80)).toBe(-1)
  })
  it('is linear between 30 and 70', () => {
    expect(piecewiseRsiScore(40)).toBeCloseTo(0.5, 4)
    expect(piecewiseRsiScore(60)).toBeCloseTo(-0.5, 4)
  })
})
