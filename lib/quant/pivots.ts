/** Classic floor-trader pivots from prior session H/L/C. */

export function classicPivots(high: number, low: number, close: number) {
  const p = (high + low + close) / 3
  const r1 = 2 * p - low
  const s1 = 2 * p - high
  const r2 = p + (high - low)
  const s2 = p - (high - low)
  const r3 = high + 2 * (p - low)
  const s3 = low - 2 * (high - p)
  return { pivot: p, r1, r2, r3, s1, s2, s3 }
}

/**
 * Returns "YYYY-MM-DD" in the US Eastern (market) timezone.
 * Used to align with Yahoo daily-bar dates, which represent Eastern-time
 * trading sessions. Comparing in UTC misaligns by ~5 hours every day,
 * landing on the wrong calendar date during pre-market hours.
 */
export function todayInMarketTimezone(now: Date = new Date()): string {
  // 'en-CA' yields YYYY-MM-DD; 'America/New_York' covers both EST and EDT.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Picks the most-recent COMPLETED daily bar from a parallel ohlc/dates
 * dataset. Floor-trader pivot calculation (Murphy 1999, *Technical
 * Analysis of the Financial Markets*, p. 290) defines pivots as derived
 * from the previous complete session's H/L/C.
 *
 * Yahoo Finance's daily chart includes the current day's intraday bar
 * once the market opens. So:
 *   • Intraday: last bar IS today (still forming) → prior bar is at index length-2
 *   • Pre-market / weekend / holiday: last bar IS the previous complete
 *     session → return it directly (index length-1)
 *
 * Prior implementation in buildFundamentalsPayload always used length-2,
 * which silently returned 2-day-old data on weekends and during the
 * pre-market window — producing pivot levels for the wrong session.
 *
 * Returns null when the dataset is empty or shorter than the required
 * lookback for the chosen branch.
 */
export function priorSessionBar<T>(
  ohlc: readonly T[],
  dates: readonly string[],
  now: Date = new Date(),
): T | null {
  if (ohlc.length === 0 || ohlc.length !== dates.length) return null
  const last = ohlc.length - 1
  const lastDate = dates[last]
  const today = todayInMarketTimezone(now)
  const idx = lastDate === today ? last - 1 : last
  if (idx < 0) return null
  return ohlc[idx]
}
