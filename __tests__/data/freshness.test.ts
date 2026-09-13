/**
 * Q-101 — the freshness classifier, including the things it CANNOT do.
 *
 * Every time is built from a UTC instant so the suite is timezone-independent;
 * the module under test must resolve New York itself.
 *
 * 2026-09-11 is a Friday, 2026-09-13 a Sunday, 2026-09-14 a Monday. NY is on
 * EDT (UTC-4) throughout, so 20:00Z = 16:00 ET.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyFreshness,
  parseDelayedMinutes,
  formatAge,
  LIVE_MAX_SEC,
  RECENT_MAX_SEC,
} from '@/lib/data/freshness'
import { lastSessionDateYmd, isFromLatestSession, formatNySessionStamp } from '@/lib/api/marketHours'

const ms = (iso: string) => Date.parse(iso)
const FRI_CLOSE = ms('2026-09-11T20:00:00Z')   // Fri 16:00 ET
const SUNDAY = ms('2026-09-13T14:00:00Z')      // Sun 10:00 ET
const MON_MIDDAY = ms('2026-09-14T15:00:00Z')  // Mon 11:00 ET, session open

describe('session boundaries', () => {
  it('the most recent session on a Sunday is the preceding Friday', () => {
    expect(lastSessionDateYmd(new Date(SUNDAY))).toBe(20260911)
  })

  it('before 09:30 ET the current weekday has not begun, so the session is the day before', () => {
    // Monday 08:00 ET = 12:00Z.
    expect(lastSessionDateYmd(new Date(ms('2026-09-14T12:00:00Z')))).toBe(20260911)
  })

  it('at 09:30 ET the current weekday IS the session', () => {
    expect(lastSessionDateYmd(new Date(ms('2026-09-14T13:30:00Z')))).toBe(20260914)
  })

  it('after the close the session is still today, not yesterday', () => {
    // Monday 18:00 ET = 22:00Z.
    expect(lastSessionDateYmd(new Date(ms('2026-09-14T22:00:00Z')))).toBe(20260914)
  })

  it('a Friday close counts as the latest session on the following Sunday', () => {
    expect(isFromLatestSession(new Date(FRI_CLOSE), new Date(SUNDAY))).toBe(true)
  })

  it('a stamp AFTER the close still counts — VIX stamps 16:15 ET in production', () => {
    const vix = ms('2026-09-11T20:15:01Z')
    expect(isFromLatestSession(new Date(vix), new Date(SUNDAY))).toBe(true)
  })

  it('a stamp from the session BEFORE the latest one does not count', () => {
    const thursday = ms('2026-09-10T20:00:00Z')
    expect(isFromLatestSession(new Date(thursday), new Date(SUNDAY))).toBe(false)
  })

  it('a stamp before 09:30 ET on the session date does not count', () => {
    // Friday 08:00 ET — pre-market on the session day is not the session.
    expect(isFromLatestSession(new Date(ms('2026-09-11T12:00:00Z')), new Date(SUNDAY))).toBe(false)
  })

  it('names the stamp in New York time so the number is never hidden', () => {
    // Asserted by parts, not as one literal: Intl's separator has moved between
    // ICU versions before, and a guard that breaks on a comma teaches people to
    // delete guards.
    const stamp = formatNySessionStamp(new Date(FRI_CLOSE))
    expect(stamp).toContain('Fri')
    expect(stamp).toContain('16:00')
    expect(stamp).toContain('ET')
  })
})

describe('precedence — the ordering IS the safety property', () => {
  it('cached outranks Live: a stored copy stamped one second ago is NOT live', () => {
    const now = MON_MIDDAY
    expect(classifyFreshness({ quoteTime: now - 1_000, now, cached: true }).kind).toBe('cached')
  })

  it('cached outranks a vendor delay too', () => {
    const now = MON_MIDDAY
    expect(
      classifyFreshness({ quoteTime: now - 1_000, now, cached: true, delayedMinutes: 15 }).kind,
    ).toBe('cached')
  })

  it('delayed outranks Live: a 15-minute-delayed quote fetched now is NOT live', () => {
    // The whole point. Age says 1s; the vendor says the price is 15 minutes old.
    const now = MON_MIDDAY
    const s = classifyFreshness({ quoteTime: now - 1_000, now, delayedMinutes: 15 })
    expect(s.kind).toBe('delayed')
    expect(s.delayedMinutes).toBe(15)
  })

  it('cached with no timestamp is still cached, not unknown', () => {
    expect(classifyFreshness({ quoteTime: null, now: MON_MIDDAY, cached: true }).kind).toBe('cached')
  })

  it('a delayed feed with no timestamp still discloses the delay', () => {
    expect(classifyFreshness({ quoteTime: null, now: MON_MIDDAY, delayedMinutes: 15 }).kind)
      .toBe('delayed')
  })
})

describe('age states during an open session', () => {
  const base = { now: MON_MIDDAY, calendar: 'us-equity' as const }

  it('under 10s is live', () => {
    expect(classifyFreshness({ ...base, quoteTime: MON_MIDDAY - 5_000 }).kind).toBe('live')
  })

  it('the live boundary is exclusive', () => {
    expect(classifyFreshness({ ...base, quoteTime: MON_MIDDAY - LIVE_MAX_SEC * 1000 }).kind)
      .toBe('recent')
  })

  it('the recent boundary is exclusive', () => {
    expect(classifyFreshness({ ...base, quoteTime: MON_MIDDAY - RECENT_MAX_SEC * 1000 }).kind)
      .toBe('stale')
  })

  it('a quote that skipped the session open is stale even in-session', () => {
    // Friday's close, judged at Monday midday: the feed has not ticked all day.
    expect(classifyFreshness({ ...base, quoteTime: FRI_CLOSE }).kind).toBe('stale')
  })
})

describe('the closed market is not a fault', () => {
  it('Friday close judged on Sunday reads atClose, not stale', () => {
    const s = classifyFreshness({ quoteTime: FRI_CLOSE, now: SUNDAY, calendar: 'us-equity' })
    expect(s.kind).toBe('atClose')
  })

  it('and it still carries the age — the fix is to the alarm, not the disclosure', () => {
    const s = classifyFreshness({ quoteTime: FRI_CLOSE, now: SUNDAY, calendar: 'us-equity' })
    // Fri 20:00Z -> Sun 14:00Z is 42 hours. This is the number production showed
    // on 2026-09-13 as "Data is stale, 151223 seconds old; consider refreshing".
    expect(s.ageSec).toBe(42 * 3600)
  })

  it('a feed that missed a whole session is stale even while the market is shut', () => {
    // Thursday's close judged on Sunday: Friday came and went with no tick.
    const thursday = ms('2026-09-10T20:00:00Z')
    expect(classifyFreshness({ quoteTime: thursday, now: SUNDAY, calendar: 'us-equity' }).kind)
      .toBe('stale')
  })

  it('THE DEGRADED-FEED CASE: no vendor stamp reads unknown, never atClose and never live', () => {
    // Q-101 review. Removing useLivePrices' fallback to our own fetch-completion
    // time means `quoteTime` is now null whenever NO quote in the batch carries
    // a vendor stamp — which is exactly when the feed is degraded. Nothing
    // pinned what the badge renders in that state, in the package whose whole
    // subject is that state. The `!hasTime` return sits BEFORE the calendar
    // branch, so `us-equity` must not turn an unknown age into "At close".
    const s = classifyFreshness({ quoteTime: null, now: SUNDAY, calendar: 'us-equity' })
    expect(s.kind).toBe('unknown')
    expect(s.ageSec).toBeNull()
  })

  it('and the same holds while the market is OPEN', () => {
    const s = classifyFreshness({ quoteTime: null, now: MON_MIDDAY, calendar: 'us-equity' })
    expect(s.kind).toBe('unknown')
  })

  it('WITHOUT the calendar the same input alarms — this is the bug being fixed', () => {
    // Regression lock. If this ever returns 'atClose', the default changed and
    // a 24/7 surface silently inherited the equity calendar.
    expect(classifyFreshness({ quoteTime: FRI_CLOSE, now: SUNDAY }).kind).toBe('stale')
  })

  it('pre-market reads as the previous close, not as a fault', () => {
    const monPreMarket = ms('2026-09-14T12:00:00Z') // Mon 08:00 ET
    expect(classifyFreshness({ quoteTime: FRI_CLOSE, now: monPreMarket, calendar: 'us-equity' }).kind)
      .toBe('atClose')
  })
})

describe('boundary parsing of dataProvenance', () => {
  it('reads a positive delay', () => {
    expect(parseDelayedMinutes({ provider: 'yahoo-finance2', delayedMinutes: 15, realtime: false }))
      .toBe(15)
  })

  it('a realtime feed has no delay to disclose', () => {
    expect(parseDelayedMinutes({ delayedMinutes: 15, realtime: true })).toBeNull()
  })

  it.each([null, undefined, 'fifteen', 42, {}, { delayedMinutes: 0 }, { delayedMinutes: -5 },
    { delayedMinutes: NaN }, { delayedMinutes: '15' }])('rejects %s', (raw) => {
    expect(parseDelayedMinutes(raw)).toBeNull()
  })
})

describe('age formatting', () => {
  it.each([
    [5, '5s'],
    [59, '59s'],
    [65, '1m 05s'],
    [3599, '59m 59s'],
    [3600, '1h 00m'],
    [151223, '42h 00m'],
  ])('%s seconds renders as %s', (sec, expected) => {
    expect(formatAge(sec as number)).toBe(expected)
  })
})

describe('what this classifier CANNOT do — each one is a real gap, not a caveat', () => {
  it('does not know market holidays, so a weekday holiday alarms as if in-session', () => {
    // 2026-12-25 is a Friday and the market is shut. `isMarketOpen` has no
    // holiday calendar (its own docstring says so), so the session looks open
    // and a Thursday-close quote is judged by wall clock. ~9 days a year.
    const xmasMidday = ms('2026-12-25T16:00:00Z') // 11:00 ET
    const prevClose = ms('2026-12-24T18:00:00Z')  // Thu 13:00 ET (early close)
    expect(classifyFreshness({ quoteTime: prevClose, now: xmasMidday, calendar: 'us-equity' }).kind)
      .toBe('stale')
  })

  it('cannot tell a halted instrument from a live one — both are atClose after hours', () => {
    // A name halted at 11:00 on the session day still reads atClose. The stamp
    // is rendered in the label so the user can see 11:00 is not 16:00, but the
    // classifier does not distinguish them.
    const haltedAt11 = ms('2026-09-11T15:00:00Z') // Fri 11:00 ET
    expect(classifyFreshness({ quoteTime: haltedAt11, now: SUNDAY, calendar: 'us-equity' }).kind)
      .toBe('atClose')
  })

  it('judges the timestamp it is GIVEN — it cannot tell a vendor stamp from our own fetch time', () => {
    // hooks/useLivePrices falls back to the response completion time when no
    // quote carries `quoteTime`, which would render our own fetch as the datum's
    // age. Measured 2026-09-13: 0 of 28 desk instruments lack `quoteTime`, so
    // the fallback is latent — but this classifier cannot detect it if it fires.
    const ourFetchTime = MON_MIDDAY - 1_000
    expect(classifyFreshness({ quoteTime: ourFetchTime, now: MON_MIDDAY, calendar: 'us-equity' }).kind)
      .toBe('live')
  })
})
