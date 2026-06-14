/**
 * F-6 SSOT guard: sma200DeviationPct / sma200Slope must be a single source of
 * truth. They were previously duplicated in lib/quant/technicals.ts (UI path) and
 * lib/backtest/signalHelpers.ts (engine path) with no test ensuring they agreed.
 *
 * Both modules now re-export the canonical implementation from
 * @/lib/quant/indicators. This test fails if anyone re-introduces a divergent
 * local copy (the references would stop being identical).
 */
import { describe, it, expect } from 'vitest'
import * as indicators from '@/lib/quant/indicators'
import * as technicals from '@/lib/quant/technicals'
import * as signalHelpers from '@/lib/backtest/signalHelpers'

describe('sma200 SSOT (F-6)', () => {
  it('all three modules expose the SAME function reference', () => {
    expect(technicals.sma200DeviationPct).toBe(indicators.sma200DeviationPct)
    expect(signalHelpers.sma200DeviationPct).toBe(indicators.sma200DeviationPct)
    expect(technicals.sma200Slope).toBe(indicators.sma200Slope)
    expect(signalHelpers.sma200Slope).toBe(indicators.sma200Slope)
  })

  it('sma200DeviationPct: percent deviation, null on non-finite/non-positive', () => {
    expect(indicators.sma200DeviationPct(110, 100)).toBeCloseTo(10)
    expect(indicators.sma200DeviationPct(90, 100)).toBeCloseTo(-10)
    expect(indicators.sma200DeviationPct(-50, 100)).toBeNull()
    expect(indicators.sma200DeviationPct(100, 0)).toBeNull()
    expect(indicators.sma200DeviationPct(NaN, 100)).toBeNull()
  })

  it('sma200Slope: null below 221 bars; signed fractional change above', () => {
    expect(indicators.sma200Slope(new Array(220).fill(100))).toBeNull()
    const rising = Array.from({ length: 260 }, (_, i) => 100 + i) // monotonic up
    const slope = indicators.sma200Slope(rising)
    expect(slope).not.toBeNull()
    expect(slope!).toBeGreaterThan(0)
  })
})
