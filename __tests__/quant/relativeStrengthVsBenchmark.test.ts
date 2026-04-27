import { describe, it, expect } from 'vitest'
import { relativeStrengthVsBenchmark } from '@/lib/quant/relativeStrength'

function trend(n: number, start: number, daily: number): number[] {
  const out: number[] = [start]
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + daily))
  return out
}

describe('relativeStrengthVsBenchmark', () => {
  it('returns empty when SPY has insufficient bars', () => {
    expect(relativeStrengthVsBenchmark({ XLK: trend(200, 100, 0.001) }, trend(20, 400, 0.0005))).toEqual([])
  })

  it('skips tickers with fewer than 22 bars', () => {
    const spy = trend(200, 400, 0.0005)
    const result = relativeStrengthVsBenchmark({ XLK: trend(10, 100, 0.001) }, spy)
    expect(result).toEqual([])
  })

  it('outperformer has higher rank (lower number) than underperformer', () => {
    const spy = trend(200, 400, 0.0005)        // SPY +0.05%/day
    const xlk = trend(200, 100, 0.0015)        // outperforming SPY
    const xle = trend(200, 100, -0.0005)       // underperforming SPY
    const result = relativeStrengthVsBenchmark({ XLK: xlk, XLE: xle }, spy)
    expect(result.length).toBe(2)
    const xlkRow = result.find((r) => r.ticker === 'XLK')!
    const xleRow = result.find((r) => r.ticker === 'XLE')!
    expect(xlkRow.rank).toBe(1)
    expect(xleRow.rank).toBe(2)
    expect(xlkRow.pct1m!).toBeGreaterThan(xleRow.pct1m!)
  })

  it('positive pct1m for outperformer, negative for underperformer', () => {
    const spy = trend(200, 400, 0)
    const winner = trend(200, 100, 0.001)
    const loser = trend(200, 100, -0.001)
    const result = relativeStrengthVsBenchmark({ WIN: winner, LOSE: loser }, spy)
    const w = result.find((r) => r.ticker === 'WIN')!
    const l = result.find((r) => r.ticker === 'LOSE')!
    expect(w.pct1m!).toBeGreaterThan(0)
    expect(l.pct1m!).toBeLessThan(0)
  })

  it('ratio matches last-close ratio', () => {
    const spy = trend(200, 400, 0)
    const xlk = trend(200, 100, 0)
    const result = relativeStrengthVsBenchmark({ XLK: xlk }, spy)
    expect(result[0].ratio).toBeCloseTo(100 / 400)
  })

  it('skips tickers with non-positive last close', () => {
    const spy = trend(200, 400, 0)
    const bad = Array(200).fill(0)
    bad[199] = -1
    const result = relativeStrengthVsBenchmark({ BAD: bad }, spy)
    expect(result).toEqual([])
  })
})
