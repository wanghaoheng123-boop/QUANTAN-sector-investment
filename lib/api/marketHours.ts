/**
 * US equities market-hours helper — timezone-aware via the Intl API.
 *
 * Phase 13 S2 fix (F-NEW): the previous implementation in
 * `app/api/stream/[ticker]/route.ts` used `Date.prototype.getTimezoneOffset()`
 * to detect DST, which returns the *server's* offset. On Vercel / AWS Lambda
 * the server runs UTC, so both January and July offsets are 0 and `isDST`
 * is always false — the market-open window was off by one hour for ~7
 * months a year (mid-March through early November).
 *
 * This implementation uses the standard `Intl.DateTimeFormat` API with the
 * IANA timezone "America/New_York" so the runtime timezone is irrelevant.
 *
 * Reference: NYSE & NASDAQ regular session is Mon–Fri 09:30–16:00 ET.
 *   https://www.nyse.com/markets/hours-calendars
 */

const NY_TIMEZONE = 'America/New_York'

const NY_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIMEZONE,
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
})

interface MarketTime {
  /** Day of week in NY ('Mon', 'Tue', …, 'Sun'). */
  weekday: string
  /** Hour of day in NY local time (0-23). */
  hour: number
  /** Minute of hour (0-59). */
  minute: number
}

function nyMarketTime(now: Date): MarketTime {
  // formatToParts is well-supported in modern Node runtimes.
  const parts = NY_PARTS_FORMATTER.formatToParts(now)
  let weekday = ''
  let hour = 0
  let minute = 0
  for (const p of parts) {
    if (p.type === 'weekday') weekday = p.value
    else if (p.type === 'hour') hour = parseInt(p.value, 10)
    else if (p.type === 'minute') minute = parseInt(p.value, 10)
  }
  // Intl returns "24" at midnight on some runtimes; normalize.
  if (hour === 24) hour = 0
  return { weekday, hour, minute }
}

/**
 * True if NYSE/NASDAQ regular session is currently open.
 * Does NOT account for half-day holidays or full-market closures (Christmas,
 * Thanksgiving, etc.) — use a calendar API for precise scheduling.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const t = nyMarketTime(now)
  if (t.weekday === 'Sat' || t.weekday === 'Sun') return false
  const minutes = t.hour * 60 + t.minute
  const open = 9 * 60 + 30   // 09:30 ET
  const close = 16 * 60      // 16:00 ET
  return minutes >= open && minutes < close
}

/**
 * Minutes until next market open (or 0 if currently open).
 * Useful for SSE heartbeat scheduling and stale-data badges.
 */
export function minutesUntilNextOpen(now: Date = new Date()): number {
  if (isMarketOpen(now)) return 0
  // Up to 7 days lookahead.
  for (let i = 0; i < 7 * 24 * 60; i += 5) {
    const probe = new Date(now.getTime() + i * 60 * 1000)
    if (isMarketOpen(probe)) return i
  }
  return -1  // never opens? unreachable for live calendar.
}

/* ------------------------------------------------------------------------- *
 * Session boundaries (Q-101, 2026-09-13)
 *
 * WHY THIS EXISTS. `DataFreshnessIndicator` classified a quote by wall-clock
 * age alone, so it rendered red "Stale — refresh" for every hour the market was
 * shut. Measured on production 2026-09-13 (a Sunday), /desk carried
 * `aria-label="Data is stale, 151223 seconds old; consider refreshing"` — 42
 * hours — beside the site's own MarketStatus pill reading CLOSED. The feed was
 * healthy; Friday's close is the freshest datum that exists.
 *
 * The regular session is 32.5h of a 168h week, so that alarm was on for ~80% of
 * wall-clock time with nothing wrong, and the "next action" it named (refresh)
 * could not help. `alertDecision`'s own docstring in this repo already states
 * the cost: alert fatigue is how the next real outage goes unread.
 *
 * These helpers answer the question that distinguishes the two cases: is this
 * quote from the most recent session, or did the feed miss a whole session?
 *
 * NO GRACE CONSTANT. An earlier sketch compared the quote against 16:00 ET
 * minus a tolerance, which needs a tuned threshold. Anchoring on the session
 * OPEN removes the tuning entirely: any stamp from 09:30 ET of the latest
 * session onward is current-as-of-close, and anything earlier means a session
 * went by without a tick. Measured against the live desk basket (28
 * instruments, 2026-09-11 session): 27 stamp exactly 16:00 ET and ^VIX stamps
 * 16:15 ET, so stamps after the close are normal and the window must stay open
 * forward — which anchoring on the open does for free.
 *
 * KNOWN GAP, stated rather than hidden: `isMarketOpen` has no holiday calendar,
 * so on a weekday market holiday the nominal session is "open" and the old
 * cry-wolf behaviour returns for that day (~9 days/year). Asserted as a passing
 * test in __tests__/lib/freshness.test.ts rather than claimed closed.
 * ------------------------------------------------------------------------- */

/** NY wall-clock fields of an instant, as plain numbers. */
interface NyDateTime {
  ymd: number      // YYYYMMDD, comparable as an integer
  minutes: number  // minutes since NY midnight
  weekday: string
}

const NY_FULL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIMEZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function nyDateTime(d: Date): NyDateTime {
  const parts = NY_FULL_FORMATTER.formatToParts(d)
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, weekday = ''
  for (const p of parts) {
    if (p.type === 'year') year = parseInt(p.value, 10)
    else if (p.type === 'month') month = parseInt(p.value, 10)
    else if (p.type === 'day') day = parseInt(p.value, 10)
    else if (p.type === 'hour') hour = parseInt(p.value, 10)
    else if (p.type === 'minute') minute = parseInt(p.value, 10)
    else if (p.type === 'weekday') weekday = p.value
  }
  if (hour === 24) hour = 0
  return { ymd: year * 10000 + month * 100 + day, minutes: hour * 60 + minute, weekday }
}

/** 09:30 ET, in minutes since NY midnight. */
const SESSION_OPEN_MINUTES = 9 * 60 + 30

/**
 * NY calendar date (YYYYMMDD) of the most recent regular session that has
 * already begun — today if it is a weekday past 09:30 ET, else the previous
 * weekday.
 *
 * Calendar arithmetic only. The NY wall-clock date is stepped back through
 * `Date.UTC`, which manipulates a date *label* and never an instant, so the
 * walk is immune to DST — the bug this file's header was written about.
 */
export function lastSessionDateYmd(now: Date = new Date()): number {
  const t = nyDateTime(now)
  const startedToday = t.weekday !== 'Sat' && t.weekday !== 'Sun' && t.minutes >= SESSION_OPEN_MINUTES
  let y = Math.floor(t.ymd / 10000)
  let m = Math.floor((t.ymd % 10000) / 100)
  let d = t.ymd % 100
  let cursor = Date.UTC(y, m - 1, d)
  if (!startedToday) cursor -= 86_400_000
  // Walk back to the nearest weekday. 0 = Sunday, 6 = Saturday.
  for (let i = 0; i < 10; i++) {
    const probe = new Date(cursor)
    const dow = probe.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      return probe.getUTCFullYear() * 10000 + (probe.getUTCMonth() + 1) * 100 + probe.getUTCDate()
    }
    cursor -= 86_400_000
  }
  // Unreachable for a real calendar: any 10-day window contains a weekday.
  return t.ymd
}

/**
 * True when `quoteTime` is stamped at or after the open of the most recent
 * session — i.e. the value is current as of the latest close, not a value that
 * skipped a session.
 */
export function isFromLatestSession(quoteTime: Date, now: Date = new Date()): boolean {
  const q = nyDateTime(quoteTime)
  const sessionYmd = lastSessionDateYmd(now)
  if (q.ymd > sessionYmd) return true
  if (q.ymd < sessionYmd) return false
  return q.minutes >= SESSION_OPEN_MINUTES
}

const NY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIMEZONE,
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
})

/** "Fri 16:00 ET" — the stamp itself, so changing the alarm never hides the number. */
export function formatNySessionStamp(d: Date): string {
  return `${NY_LABEL_FORMATTER.format(d)} ET`
}
