/**
 * Q-101 — `formatFreshness` had zero tests while rendering on eight surfaces.
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

  it('under 30s reads live', () => {
    expect(formatFreshness(isoAgo(5))).toBe('live')
  })

  it('between 30s and 120s reads in seconds', () => {
    expect(formatFreshness(isoAgo(45))).toMatch(/^4[45]s ago$/)
  })

  it('minutes and hours round down', () => {
    expect(formatFreshness(isoAgo(3 * 60 + 5))).toBe('3m ago')
    expect(formatFreshness(isoAgo(2 * 3600 + 60))).toBe('2h ago')
  })

  it('a future timestamp clamps at zero rather than going negative', () => {
    expect(formatFreshness(new Date(Date.now() + 60_000).toISOString())).toBe('live')
  })

  it('CANNOT DO: it has no notion of caching, vendor delay or the market session', () => {
    // A Friday close read on a Sunday reads "42h ago" here, where
    // DataFreshnessIndicator reads "At close · Fri 16:00 ET". Two vocabularies
    // for one fact, live on overlapping surfaces. Q-114.
    expect(formatFreshness(isoAgo(42 * 3600))).toBe('42h ago')
  })
})
