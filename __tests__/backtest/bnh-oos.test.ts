import { describe, it, expect } from 'vitest'
import { computeBuyAndHoldReturn, computeOosRatio } from '@/lib/backtest/engine'
import type { OhlcvRow } from '@/lib/backtest/engine'

describe('computeBuyAndHoldReturn (Q-021)', () => {
  it('matches price-only return without dividends', () => {
    const rows: OhlcvRow[] = [
      { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { time: 2, open: 110, high: 110, low: 110, close: 110, volume: 1 },
    ]
    expect(computeBuyAndHoldReturn(rows)).toBeCloseTo(0.1, 6)
  })

  it('reinvests optional dividends', () => {
    const rows: OhlcvRow[] = [
      { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { time: 2, open: 100, high: 100, low: 100, close: 100, volume: 1, dividend: 2 },
      { time: 3, open: 105, high: 105, low: 105, close: 105, volume: 1 },
    ]
    const r = computeBuyAndHoldReturn(rows)
    expect(r).toBeGreaterThan(0.05)
  })
})

describe('computeOosRatio (Q-038)', () => {
  it('exposes raw and clamped display', () => {
    const { raw, display } = computeOosRatio(0.1, 0.3)
    expect(raw).toBeCloseTo(3, 4)
    expect(display).toBe(2)
  })
})
