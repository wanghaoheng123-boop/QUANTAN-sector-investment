/**
 * Q04: signalHelpers coverage — focus on detectVolumeClimax robustness.
 *
 * Regression for the Q04 guard: a corrupt last-bar `open` (0 / NaN) made
 * `bodyPct = |close-open|/open` Infinity/NaN, so `largePanic` could spuriously
 * fire. A bar that can't be measured can't be a climax → return false.
 */
import { describe, it, expect } from 'vitest'
import { detectVolumeClimax } from '@/lib/backtest/signalHelpers'
import type { OhlcvBar } from '@/lib/quant/indicators'

const mk = (open: number, high: number, low: number, close: number, volume: number): OhlcvBar =>
  ({ open, high, low, close, volume })

/** 22 bars: 21 calm bars + a final selling-climax bar (volume spike, large
 *  bearish body, closes above the prior bar's midpoint). */
function climaxSeries(): OhlcvBar[] {
  const bars: OhlcvBar[] = []
  for (let i = 0; i < 20; i++) bars.push(mk(100, 101, 99, 100, 1_000_000))
  bars.push(mk(97, 98, 96, 97, 1_000_000)) // prev bar → mid = 97
  bars.push(mk(100, 100.5, 97.5, 98, 3_000_000)) // climax: body 2%, vol 3×, close 98 > 97
  return bars
}

describe('detectVolumeClimax (Q04)', () => {
  it('detects a valid selling climax', () => {
    expect(detectVolumeClimax(climaxSeries())).toBe(true)
  })

  it('returns false when the last open is 0 (no NaN/Infinity body, no spurious fire)', () => {
    const bars = climaxSeries()
    bars[bars.length - 1] = { ...bars[bars.length - 1], open: 0 }
    expect(detectVolumeClimax(bars)).toBe(false)
  })

  it('returns false when the last open is NaN', () => {
    const bars = climaxSeries()
    bars[bars.length - 1] = { ...bars[bars.length - 1], open: NaN }
    expect(detectVolumeClimax(bars)).toBe(false)
  })

  it('returns false on calm bars (no volume spike / no panic body)', () => {
    const bars: OhlcvBar[] = []
    for (let i = 0; i < 22; i++) bars.push(mk(100, 101, 99, 100.2, 1_000_000))
    expect(detectVolumeClimax(bars)).toBe(false)
  })

  it('returns false with insufficient bars', () => {
    expect(detectVolumeClimax([mk(100, 101, 99, 100, 1_000_000)])).toBe(false)
  })
})
