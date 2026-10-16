/**
 * Q-139 — the Analysis tab's period split (lib/backtest/periodSplit.ts).
 */
import { describe, expect, it } from 'vitest'
import { splitIntoPeriods } from '@/lib/backtest/periodSplit'

const growth = (n: number, daily: number) => Array.from({ length: n }, (_, i) => 100_000 * (1 + daily) ** i)

describe('splitIntoPeriods', () => {
  it('the periods chain to the whole: no return between periods is dropped', () => {
    const curve = growth(1000, 0.0004).map((v, i) => v * (1 + 0.01 * Math.sin(i / 7)))
    const ps = splitIntoPeriods(curve, 252, 0.045)
    expect(ps).toHaveLength(4)
    const chained = ps.reduce((acc, p) => acc * (1 + p.totalReturn), 1) - 1
    const whole = curve[curve.length - 1] / curve[0] - 1
    expect(chained).toBeCloseTo(whole, 12)
  })

  it('annualises on the instrument calendar it is given', () => {
    const curve = growth(1000, 0.0004)
    const eq = splitIntoPeriods(curve, 252, 0)[0]
    const crypto = splitIntoPeriods(curve, 365, 0)[0]
    expect(eq.annualizedReturn).toBeCloseTo((1.0004 ** 249) ** (252 / 249) - 1, 10)
    expect(crypto.annualizedReturn as number).toBeGreaterThan(eq.annualizedReturn as number)
  })

  it('a flat (all-cash) period has no Sharpe rather than ±Infinity', () => {
    const curve = [...growth(500, 0.001), ...Array.from({ length: 500 }, () => 200_000)]
    const ps = splitIntoPeriods(curve, 252, 0.045)
    expect(ps[3].sharpe).toBeNull()
    expect(ps[3].totalReturn).toBe(0)
  })

  it('returns nothing for a curve too short to split', () => {
    expect(splitIntoPeriods(growth(40, 0.001), 252, 0.045)).toEqual([])
  })
})
