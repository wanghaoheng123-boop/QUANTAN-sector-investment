/**
 * Q-149 — the dark-pool metrics read only fields yahoo-finance2 declares, in the
 * units the UI prints, and say why a figure is absent.
 *
 * Every number below is invented. The probe that informed these rules
 * (2026-10-17) recorded only field presence and RATIOS between fields; no vendor
 * figure is committed (design invariant I8). Shapes are named for what they are
 * ("a dual-class shape"), not for an issuer.
 */
import { describe, expect, it } from 'vitest'
import {
  FLOAT_IDENTITY_TOLERANCE,
  FLOAT_SHARES_OUT_SLACK,
  NO_SHORT_INTEREST_NOTE,
  SHORT_INTEREST_STALE_DAYS,
  SHORT_PERCENT_OF_FLOAT_SCALE,
  buildDarkPoolMetrics,
  hasShortInterestData,
  isoDateOrNull,
} from '@/lib/darkpool'

const NOW = Date.parse('2026-10-17T12:00:00Z')
const build = (ks: Record<string, unknown>, q: Record<string, unknown> = {}, now = NOW) => buildDarkPoolMetrics(ks, q, now)

describe('buildDarkPoolMetrics', () => {
  it('scales the fraction Yahoo returns into percent units', () => {
    expect(SHORT_PERCENT_OF_FLOAT_SCALE).toBe(100)
    expect(build({ shortPercentOfFloat: 0.0071 }).shortFloatPct).toBeCloseTo(0.71, 10)
    // Over 100% is not invalid on its own: the vendor's denominator is not always the float.
    expect(build({ shortPercentOfFloat: 1.4 }).shortFloatPct).toBeCloseTo(140, 10)
    expect(build({ shortPercentOfFloat: -0.01 }).shortFloatPct).toBeNull()
  })

  it('keeps a real zero — zero short interest is a measurement (Q149-D10, M01-M04)', () => {
    const m = build({ shortPercentOfFloat: 0, sharesShort: 0, shortRatio: 0 })
    expect(m).toMatchObject({ shortFloatPct: 0, sharesShorted: 0, daysToCover: 0 })
    expect(hasShortInterestData(m)).toBe(true)
  })

  it('an ETF: no key statistics, so shares outstanding come from the quote (Q149-D1)', () => {
    const m = build({}, { sharesOutstanding: 3e8, averageDailyVolume10Day: 6e6 })
    expect(m.sharesOutstanding).toBe(3e8)
    expect(m.avgDailyVolume).toBe(6e6)
    // A share count is not short interest: the note about short interest still applies.
    expect(hasShortInterestData(m)).toBe(false)
    expect(NO_SHORT_INTEREST_NOTE).toBe('Yahoo Finance reports no short-interest figures for this ticker.')
    // The key statistic wins when both are present.
    expect(build({ sharesOutstanding: 5e8 }, { sharesOutstanding: 3e8 }).sharesOutstanding).toBe(5e8)
  })

  it('hasShortInterestData: each short-interest field counts on its own; share counts do not', () => {
    expect(hasShortInterestData(build({ sharesShort: 1 }))).toBe(true)
    expect(hasShortInterestData(build({ shortPercentOfFloat: 0.01 }))).toBe(true)
    expect(hasShortInterestData(build({ shortRatio: 2 }))).toBe(true)
    expect(hasShortInterestData(build({ sharesOutstanding: 1e9, floatShares: 9e8 }))).toBe(false)
  })

  it('reads the TEN-day volume, not the three-month one (Q149-D10, M25)', () => {
    expect(build({}, { averageDailyVolume3Month: 8e6 }).avgDailyVolume).toBeNull()
    expect(build({}, { averageDailyVolume10Day: 7e6, averageDailyVolume3Month: 8e6 }).avgDailyVolume).toBe(7e6)
  })

  it('does not read the untyped fields the route used to read', () => {
    const m = build(
      { ordinarySharesNumber: 1e9, offExchangeShares: 5e8, marketStore: 5e8, averageDailyVolume10Day: 7 },
      { averageDailyVolume: 8 },
    )
    expect(m).toMatchObject({
      sharesShorted: null, shortFloatPct: null, shortInterestAsOf: null, daysToCover: null,
      avgDailyVolume: null, sharesOutstanding: null, sharesFloat: null, floatWithheld: null,
    })
  })

  it('a float above shares outstanding beyond the slack is WITHHELD, and says so (Q149-D2, D15)', () => {
    expect(FLOAT_SHARES_OUT_SLACK).toBe(0.05)
    const f = (ratio: number) => build({ floatShares: 1e9 * ratio, sharesOutstanding: 1e9 })
    expect(f(1)).toMatchObject({ sharesFloat: 1e9, floatWithheld: null })
    expect(f(1.002)).toMatchObject({ sharesFloat: 1.002e9, floatWithheld: null }) // a different as-of date
    // Q149-R2-1: a correct float sat at 1.01-1.02 of shares outstanding one week
    // and was withheld at the 1% bound the next. 1.02 and 1.05 are kept.
    expect(f(1.02)).toMatchObject({ sharesFloat: 1.02e9, floatWithheld: null })
    expect(f(1.05)).toMatchObject({ sharesFloat: 1.05e9, floatWithheld: null })
    // The smallest ratio measured for a float in other units was 1.06.
    expect(f(1.06)).toMatchObject({ sharesFloat: null, floatWithheld: 'exceeds-shares-out' })
    expect(f(1.1)).toMatchObject({ sharesFloat: null, floatWithheld: 'exceeds-shares-out' })
    expect(f(2.5)).toMatchObject({ sharesFloat: null, floatWithheld: 'exceeds-shares-out' })
    expect(build({ floatShares: 1.2e6 }).sharesFloat).toBe(1.2e6) // no shares-out to compare against
    expect(build({ floatShares: 0, sharesOutstanding: 0 })).toMatchObject({ sharesFloat: null, sharesOutstanding: null, floatWithheld: null })
  })

  it('a float in other-class units fails the short-interest identity and is WITHHELD; the % stands', () => {
    expect(FLOAT_IDENTITY_TOLERANCE).toBe(2)
    // A dual-class shape: the float is 1/1000 of the class shares the short count is in.
    const dual = build({ floatShares: 1e6, sharesOutstanding: 1e9, sharesShort: 1e7, shortPercentOfFloat: 0.01 })
    expect(dual).toMatchObject({ sharesFloat: null, floatWithheld: 'inconsistent-with-short-interest', sharesOutstanding: 1e9 })
    expect(dual.shortFloatPct).toBeCloseTo(1, 10)
    // A consistent single-class shape keeps its float (identity ratio 1.0).
    expect(build({ floatShares: 1e9, sharesOutstanding: 1.01e9, sharesShort: 1e7, shortPercentOfFloat: 0.01 }).sharesFloat).toBe(1e9)
    // Inside the tolerance either way is kept; outside it either way is withheld.
    const f = (ratio: number) => build({ floatShares: 1e9, sharesShort: 1e7 * ratio, shortPercentOfFloat: 0.01 }).sharesFloat
    expect(f(1.9)).toBe(1e9)
    expect(f(1 / 1.9)).toBe(1e9)
    expect(f(2.1)).toBeNull()
    expect(f(1 / 2.1)).toBeNull()
  })

  it('carries the short-interest settlement date and its age, and calls it STALE past a missed cycle (Q149-D12)', () => {
    expect(SHORT_INTEREST_STALE_DAYS).toBe(35)
    const at = (date: string) => build({ dateShortInterest: new Date(`${date}T00:00:00Z`) })
    expect(at('2026-09-30')).toMatchObject({ shortInterestAsOf: '2026-09-30', shortInterestAgeDays: 17, shortInterestStale: false })
    expect(at('2026-09-12')).toMatchObject({ shortInterestAgeDays: 35, shortInterestStale: false })
    expect(at('2026-09-11')).toMatchObject({ shortInterestAgeDays: 36, shortInterestStale: true })
    expect(build({})).toMatchObject({ shortInterestAsOf: null, shortInterestAgeDays: null, shortInterestStale: false })
    expect(isoDateOrNull('2026-09-15T00:00:00.000Z')).toBe('2026-09-15')
    expect(isoDateOrNull('not a date')).toBeNull()
    expect(isoDateOrNull(1_700_000_000)).toBeNull()
    expect(isoDateOrNull(undefined)).toBeNull()
  })

  it('refuses negative counts and ratios', () => {
    expect(build({ sharesShort: -1, shortRatio: -2 }, { averageDailyVolume10Day: -3 })).toMatchObject({ sharesShorted: null, daysToCover: null, avgDailyVolume: null })
  })
})
