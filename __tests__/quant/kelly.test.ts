import { describe, it, expect } from 'vitest'
import { kellyFraction, halfKelly } from '@/lib/quant/kelly'

describe('Kelly Criterion', () => {
  it('returns positive fraction for positive edge', () => {
    // 60% win rate, 1:1 payoff => f* = 0.6 - 0.4/1 = 0.20
    expect(kellyFraction(0.6, 1, 1)).toBeCloseTo(0.20, 10)
  })

  it('returns zero for coin-flip with equal payoff', () => {
    // 50% win, 1:1 => f* = 0.5 - 0.5/1 = 0
    expect(kellyFraction(0.5, 1, 1)).toBeCloseTo(0, 10)
  })

  it('returns negative for negative edge', () => {
    // 40% win, 1:1 => f* = 0.4 - 0.6/1 = -0.20
    expect(kellyFraction(0.4, 1, 1)).toBeCloseTo(-0.20, 10)
  })

  it('higher win rate increases fraction', () => {
    const f1 = kellyFraction(0.55, 2, 1)!
    const f2 = kellyFraction(0.65, 2, 1)!
    expect(f2).toBeGreaterThan(f1)
  })

  it('higher payoff ratio increases fraction', () => {
    const f1 = kellyFraction(0.5, 1.5, 1)!
    const f2 = kellyFraction(0.5, 3, 1)!
    expect(f2).toBeGreaterThan(f1)
  })

  it('returns null for edge cases', () => {
    expect(kellyFraction(0, 1, 1)).toBeNull()   // winProb = 0
    expect(kellyFraction(1, 1, 1)).toBeNull()   // winProb = 1
    expect(kellyFraction(0.5, 0, 1)).toBeNull()  // avgWin = 0
    expect(kellyFraction(0.5, 1, 0)).toBeNull()  // avgLoss = 0
    expect(kellyFraction(-0.1, 1, 1)).toBeNull() // negative winProb
  })
})

describe('Half Kelly', () => {
  it('returns half of full Kelly', () => {
    const full = kellyFraction(0.6, 2, 1)!
    const half = halfKelly(0.6, 2, 1)!
    expect(half).toBeCloseTo(full / 2, 10)
  })

  it('floors at zero (no negative sizing)', () => {
    // Negative edge: kelly = -0.20, halfKelly should be 0
    const result = halfKelly(0.4, 1, 1)
    expect(result).toBe(0)
  })

  it('returns null for invalid inputs', () => {
    expect(halfKelly(0, 1, 1)).toBeNull()
  })
})
