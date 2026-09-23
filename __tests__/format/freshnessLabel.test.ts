/**
 * Q-101 — `formatFreshness` had zero tests while rendering on eight surfaces.
 *
 * Q-114 (2026-09-24) — it now DELEGATES to `classifyFreshness`, so four
 * assertions below changed. Three of them were pinning the second vocabulary
 * this ticket removed (the 30s "live" boundary, and `formatAge`'s finer
 * "3m 05s" wording); the fourth was an explicit "CANNOT DO" recording that the
 * function knew nothing about caching, delay or the market session.
 *
 * That last one is the good kind of failing test: it documented a limitation
 * and broke the moment the limitation was lifted, which is exactly what it was
 * for. It is replaced by assertions of the capability, not deleted.
 */
import { describe, it, expect } from 'vitest'
import { formatFreshness } from '@/lib/format'

describe('formatFreshness', () => {
  const isoAgo = (sec: number) => new Date(Date.now() - sec * 1000).toISOString()

  it.each([null, undefined, ''])('a missing timestamp is UNKNOWN, not stale (%s)', (v) => {
    // I2: "Stale data displays as STALE with age. Missing data displays as
    // MISSING." Returning 'stale' asserted an age nobody knew.
    expect(formatFreshness(v as string | null | undefined)).toBe('—')
  })

  it('an unparseable timestamp is also unknown, not stale', () => {
    expect(formatFreshness('not-a-date')).toBe('—')
  })

  it('a VENDOR stamp under the live threshold reads live', () => {
    // Q-114: the boundary is classifyFreshness's LIVE_MAX_SEC (10s), not the
    // 30s this file used to pin.
    expect(formatFreshness(isoAgo(5), { stamp: 'vendor' })).toBe('live')
    expect(formatFreshness(isoAgo(29), { stamp: 'vendor' })).not.toBe('live')
  })

  it('OUR OWN clock never reads live, however recent', () => {
    // fetchedAt/computedAt measure when we pulled or computed, not the data's
    // age — and 'ours' is the default, so forgetting the option is safe.
    expect(formatFreshness(isoAgo(1))).toBe('just now')
    expect(formatFreshness(isoAgo(1), { stamp: 'ours' })).toBe('just now')
  })

  it('between 30s and 120s reads in seconds', () => {
    expect(formatFreshness(isoAgo(45))).toMatch(/^4[45]s ago$/)
  })

  it('minutes and hours use the shared formatAge wording', () => {
    // Q-114: one wording across the product — formatAge's, which keeps the
    // seconds/minutes remainder the indicator's aria text already used.
    expect(formatFreshness(isoAgo(3 * 60 + 5))).toBe('3m 05s ago')
    expect(formatFreshness(isoAgo(2 * 3600 + 60))).toBe('2h 01m ago')
  })

  it('a future timestamp clamps at zero rather than going negative', () => {
    expect(formatFreshness(new Date(Date.now() + 60_000).toISOString(), { stamp: 'vendor' })).toBe('live')
    expect(formatFreshness(new Date(Date.now() + 60_000).toISOString())).toBe('just now')
  })

  it('Q-114: it now DOES know about caching, vendor delay and the session', () => {
    // This replaces a "CANNOT DO" assertion. A Friday close read on a Sunday
    // used to read "42h ago" here while DataFreshnessIndicator read
    // "At close · Fri 16:00 ET" — two vocabularies for one fact.
    const now = Date.UTC(2026, 5, 14, 15, 0, 0)          // Sunday
    const friClose = Date.UTC(2026, 5, 12, 20, 0, 0)     // Fri 16:00 ET
    expect(formatFreshness(new Date(friClose).toISOString(),
      { now, stamp: 'vendor', calendar: 'us-equity' })).toBe('at close')
    expect(formatFreshness(isoAgo(2), { stamp: 'vendor', cached: true })).toMatch(/^cached/)
    expect(formatFreshness(isoAgo(2), { stamp: 'vendor', delayedMinutes: 15 })).toBe('delayed 15m')
  })

  it('WHAT IT STILL CANNOT DO — asserted, so a green run is not a proof', () => {
    // Without a calendar it is wall-clock naive: the same Friday close on a
    // Sunday reads as an age, not "at close". That default is deliberate —
    // over-alarming is the safe thing to forget (see lib/data/freshness.ts).
    const now = Date.UTC(2026, 5, 14, 15, 0, 0)
    const friClose = Date.UTC(2026, 5, 12, 20, 0, 0)
    expect(formatFreshness(new Date(friClose).toISOString(), { now, stamp: 'vendor' })).toMatch(/ago$/)
  })
})
