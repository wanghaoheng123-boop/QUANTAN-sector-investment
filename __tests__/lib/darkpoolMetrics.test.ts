/**
 * Q-149 — the dark-pool metrics read only fields yahoo-finance2 types, in the
 * units the UI prints.
 */
import { describe, expect, it } from 'vitest'
import {
  NO_SHORT_DATA_NOTE,
  FLOAT_IDENTITY_TOLERANCE,
  SHORT_PERCENT_OF_FLOAT_SCALE,
  buildDarkPoolMetrics,
  hasShortOrShareData,
  isoDateOrNull,
} from '@/lib/darkpool'

describe('buildDarkPoolMetrics', () => {
  it('scales the fraction Yahoo returns into percent units', () => {
    expect(SHORT_PERCENT_OF_FLOAT_SCALE).toBe(100)
    expect(buildDarkPoolMetrics({ shortPercentOfFloat: 0.0071 }, {}).shortFloatPct).toBeCloseTo(0.71, 10)
    // More than all of the float can be short (GME, January 2021); that is not invalid.
    expect(buildDarkPoolMetrics({ shortPercentOfFloat: 1.4 }, {}).shortFloatPct).toBeCloseTo(140, 10)
    expect(buildDarkPoolMetrics({ shortPercentOfFloat: -0.01 }, {}).shortFloatPct).toBeNull()
  })

  it('an ETF summary (no key statistics) yields no short or share data', () => {
    const m = buildDarkPoolMetrics({}, { averageDailyVolume10Day: 6_000_000 })
    expect(m.avgDailyVolume).toBe(6_000_000)
    expect(hasShortOrShareData(m)).toBe(false)
    expect(NO_SHORT_DATA_NOTE).not.toMatch(/off-exchange/i)
  })

  it('does not read the untyped fields the route used to read', () => {
    const m = buildDarkPoolMetrics(
      { ordinarySharesNumber: 1e9, offExchangeShares: 5e8, marketStore: 5e8, averageDailyVolume10Day: 7 },
      { averageDailyVolume: 8 },
    )
    expect(Object.values(m).every((v) => v === null)).toBe(true)
  })

  it('reads the float from floatShares, and drops a float larger than shares outstanding', () => {
    expect(buildDarkPoolMetrics({ floatShares: 9e8, sharesOutstanding: 1e9 }, {}).sharesFloat).toBe(9e8)
    // BRK-A, 2026-10-17: float ~1.2M against ~0.49M shares out — different units.
    expect(buildDarkPoolMetrics({ floatShares: 1.2e6, sharesOutstanding: 4.9e5 }, {}).sharesFloat).toBeNull()
    expect(buildDarkPoolMetrics({ floatShares: 1.2e6 }, {}).sharesFloat).toBe(1.2e6)
    expect(buildDarkPoolMetrics({ floatShares: 0, sharesOutstanding: 0 }, {})).toMatchObject({ sharesFloat: null, sharesOutstanding: null })
  })

  it('drops a float in different units from the short count it sits beside (BRK-B)', () => {
    expect(FLOAT_IDENTITY_TOLERANCE).toBe(2)
    // Magnitudes from the 2026-10-17 probe: float 1.2e6 (Class-A equivalent),
    // short 1.2e7 (Class B), short % 0.99%.
    const brkB = buildDarkPoolMetrics({ floatShares: 1.2e6, sharesOutstanding: 1.4e9, sharesShort: 1.2e7, shortPercentOfFloat: 0.0099 }, {})
    expect(brkB.sharesFloat).toBeNull()
    expect(brkB.shortFloatPct).toBeCloseTo(0.99, 10)
    expect(brkB.sharesOutstanding).toBe(1.4e9)
    // A consistent single-class name keeps its float (AAPL-like: ratio 1.00).
    const consistent = buildDarkPoolMetrics({ floatShares: 1.47e10, sharesOutstanding: 1.48e10, sharesShort: 1.04e8, shortPercentOfFloat: 1.04e8 / 1.47e10 }, {})
    expect(consistent.sharesFloat).toBe(1.47e10)
    // Inside the tolerance either way is kept; outside it either way is dropped.
    const f = (ratio: number) => buildDarkPoolMetrics({ floatShares: 1e9, sharesShort: 1e7 * ratio, shortPercentOfFloat: 0.01 }, {}).sharesFloat
    expect(f(1.9)).toBe(1e9)
    expect(f(1 / 1.9)).toBe(1e9)
    expect(f(2.1)).toBeNull()
    expect(f(1 / 2.1)).toBeNull()
  })

  it('carries the short-interest settlement date as a UTC calendar date', () => {
    expect(buildDarkPoolMetrics({ dateShortInterest: new Date('2026-09-30T00:00:00Z') }, {}).shortInterestAsOf).toBe('2026-09-30')
    expect(isoDateOrNull('2026-09-15T00:00:00.000Z')).toBe('2026-09-15')
    expect(isoDateOrNull('not a date')).toBeNull()
    expect(isoDateOrNull(1_700_000_000)).toBeNull()
    expect(isoDateOrNull(undefined)).toBeNull()
  })

  it('refuses negative counts and ratios', () => {
    const m = buildDarkPoolMetrics({ sharesShort: -1, shortRatio: -2 }, { averageDailyVolume10Day: -3 })
    expect(m).toMatchObject({ sharesShorted: null, daysToCover: null, avgDailyVolume: null })
  })
})
