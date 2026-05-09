import { describe, it, expect } from 'vitest'
import { classicPivots, priorSessionBar, todayInMarketTimezone } from '@/lib/quant/pivots'

/**
 * Tests for lib/quant/pivots.ts
 *
 * Covers:
 *  - classicPivots: formula correctness against a hand-computed reference
 *    from Murphy (1999, *Technical Analysis of the Financial Markets*, p. 290).
 *  - todayInMarketTimezone: stable YYYY-MM-DD in America/New_York,
 *    correct around the 8pm ET / midnight UTC boundary.
 *  - priorSessionBar: the regression fix for the buildFundamentalsPayload
 *    pivots-bar-selection bug. Previously the call site always used
 *    `ohlc[length - 2]`, which is correct only when the last bar is
 *    today's intraday bar. On weekends / pre-market, the last bar IS
 *    the previous complete session — taking length-2 returns 2-day-old
 *    data, producing pivot levels for the wrong session.
 */

describe('classicPivots', () => {
  // Reference example: H=110, L=95, C=105
  // P  = (110 + 95 + 105) / 3 = 103.333...
  // R1 = 2*P - L = 206.666... - 95 = 111.666...
  // S1 = 2*P - H = 206.666... - 110 = 96.666...
  // R2 = P + (H-L) = 103.333... + 15 = 118.333...
  // S2 = P - (H-L) = 103.333... - 15 = 88.333...
  // R3 = H + 2*(P - L) = 110 + 2 * (103.333... - 95) = 110 + 16.666... = 126.666...
  // S3 = L - 2*(H - P) = 95 - 2 * (110 - 103.333...) = 95 - 13.333... = 81.666...
  it('matches hand-computed reference values', () => {
    const r = classicPivots(110, 95, 105)
    expect(r.pivot).toBeCloseTo(103.3333, 3)
    expect(r.r1).toBeCloseTo(111.6667, 3)
    expect(r.s1).toBeCloseTo(96.6667, 3)
    expect(r.r2).toBeCloseTo(118.3333, 3)
    expect(r.s2).toBeCloseTo(88.3333, 3)
    expect(r.r3).toBeCloseTo(126.6667, 3)
    expect(r.s3).toBeCloseTo(81.6667, 3)
  })

  it('preserves pivot ordering: S3 < S2 < S1 < P < R1 < R2 < R3', () => {
    const r = classicPivots(120, 80, 100)
    expect(r.s3).toBeLessThan(r.s2)
    expect(r.s2).toBeLessThan(r.s1)
    expect(r.s1).toBeLessThan(r.pivot)
    expect(r.pivot).toBeLessThan(r.r1)
    expect(r.r1).toBeLessThan(r.r2)
    expect(r.r2).toBeLessThan(r.r3)
  })

  it('symmetric range: H-L=range, R2-S2 = 2*range', () => {
    const r = classicPivots(110, 90, 100)
    expect(r.r2 - r.s2).toBeCloseTo(2 * (110 - 90), 6)
  })

  it('handles inside-day with H = L (degenerate but legal)', () => {
    const r = classicPivots(100, 100, 100)
    expect(r.pivot).toBe(100)
    expect(r.r1).toBe(100)
    expect(r.s1).toBe(100)
    expect(r.r2).toBe(100)
    expect(r.s2).toBe(100)
  })
})

describe('todayInMarketTimezone', () => {
  it('returns YYYY-MM-DD format', () => {
    const t = todayInMarketTimezone(new Date('2025-06-15T16:00:00Z'))
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns the Eastern-time date for midday UTC (= morning ET)', () => {
    // 2025-06-15 12:00 UTC = 08:00 EDT — same calendar date in ET
    expect(todayInMarketTimezone(new Date('2025-06-15T12:00:00Z'))).toBe('2025-06-15')
  })

  it('returns the PRIOR ET calendar date during late-night UTC = late-evening ET', () => {
    // 2025-06-16 03:00 UTC = 23:00 EDT 2025-06-15 — should yield 2025-06-15 in ET
    expect(todayInMarketTimezone(new Date('2025-06-16T03:00:00Z'))).toBe('2025-06-15')
  })

  it('respects DST transition (winter EST = UTC-5)', () => {
    // 2025-01-15 03:00 UTC = 22:00 EST 2025-01-14 — should yield 2025-01-14 in ET
    expect(todayInMarketTimezone(new Date('2025-01-15T03:00:00Z'))).toBe('2025-01-14')
  })

  it('respects DST transition (summer EDT = UTC-4)', () => {
    // 2025-07-15 03:00 UTC = 23:00 EDT 2025-07-14 — should yield 2025-07-14
    expect(todayInMarketTimezone(new Date('2025-07-15T03:00:00Z'))).toBe('2025-07-14')
  })
})

describe('priorSessionBar', () => {
  // Synthetic dataset: 5 trading days. Each bar's date is a YYYY-MM-DD
  // matching what app/api/fundamentals/[ticker]/route.ts emits via
  // `c.date.toISOString().slice(0, 10)`.
  const ohlc = [
    { open: 1, high: 1.1, low: 0.9, close: 1.0 }, // Mon  Jun 9
    { open: 1, high: 1.2, low: 0.8, close: 1.1 }, // Tue  Jun 10
    { open: 1, high: 1.3, low: 0.7, close: 1.2 }, // Wed  Jun 11
    { open: 1, high: 1.4, low: 0.6, close: 1.3 }, // Thu  Jun 12
    { open: 1, high: 1.5, low: 0.5, close: 1.4 }, // Fri  Jun 13
  ]
  const dates = ['2025-06-09', '2025-06-10', '2025-06-11', '2025-06-12', '2025-06-13']

  it('returns the LAST bar when last date is BEFORE today (post-close / weekend)', () => {
    // Saturday morning, market closed. Last completed session = Friday.
    const sat = new Date('2025-06-14T13:00:00Z') // Sat 09:00 EDT
    const bar = priorSessionBar(ohlc, dates, sat)
    expect(bar).toBe(ohlc[4]) // Friday's bar — the most recent COMPLETED session
    expect(bar?.high).toBe(1.5)
  })

  it('returns the PENULTIMATE bar when last date IS today (intraday)', () => {
    // Friday during market hours. Last bar (Fri) is still forming —
    // Thursday is the prior complete session.
    const fri = new Date('2025-06-13T18:00:00Z') // Fri 14:00 EDT
    const bar = priorSessionBar(ohlc, dates, fri)
    expect(bar).toBe(ohlc[3]) // Thursday
    expect(bar?.high).toBe(1.4)
  })

  it('returns the LAST bar on a Sunday (weekend, no fresh bar)', () => {
    const sun = new Date('2025-06-15T22:00:00Z') // Sun 18:00 EDT
    const bar = priorSessionBar(ohlc, dates, sun)
    expect(bar).toBe(ohlc[4])
  })

  it('returns the LAST bar on a Monday before market open (pre-market)', () => {
    // Monday Jun 16 04:00 EDT — before next session's bar exists.
    // Bug case: previous code took length-2 = Thursday Jun 12, missing
    // Friday Jun 13 entirely.
    const monPre = new Date('2025-06-16T08:00:00Z') // Mon 04:00 EDT
    const bar = priorSessionBar(ohlc, dates, monPre)
    expect(bar).toBe(ohlc[4]) // Friday — the actual prior session
    expect(bar?.high).toBe(1.5)
  })

  it('returns null for empty dataset', () => {
    expect(priorSessionBar([], [])).toBeNull()
  })

  it('returns null for length-mismatched ohlc / dates (defensive)', () => {
    expect(priorSessionBar(ohlc, ['2025-06-13'])).toBeNull()
  })

  it('returns null when length=1 and last bar is today (no prior session)', () => {
    const oneOhlc = [ohlc[0]]
    const oneDates = ['2025-06-13']
    const fri = new Date('2025-06-13T18:00:00Z') // 14:00 EDT — today
    expect(priorSessionBar(oneOhlc, oneDates, fri)).toBeNull()
  })

  it('returns the only bar when length=1 and last bar is in the past', () => {
    const oneOhlc = [ohlc[0]]
    const oneDates = ['2025-06-12']
    const fri = new Date('2025-06-13T18:00:00Z')
    expect(priorSessionBar(oneOhlc, oneDates, fri)).toBe(ohlc[0])
  })
})
