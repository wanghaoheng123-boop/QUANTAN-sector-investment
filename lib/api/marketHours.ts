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
